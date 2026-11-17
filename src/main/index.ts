/**
 * Main process glue (#64 startup order / #67): thin Electron wiring around
 * the pure Startup orchestrator. Main owns windows, the service launcher,
 * the host bridge, port issuing, and the repair page.
 */

import { app, BrowserWindow, ipcMain, MessageChannelMain, utilityProcess } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import os from 'node:os'
import { acquireDirLock } from '@shared/fs/dir-lock'
import { resolveDataDir } from '@shared/fs/data-dir'
import { resolveLocale } from '@shared/i18n'
import { ElectronHostBridge } from './host-electron'
import { Startup, type ServiceHandlers, type ServiceProcess, type StartupErrorInfo } from './startup'
import type { ServiceMessage } from '@service/host'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Tests (and anyone running several dev copies) can isolate the Chromium
// profile — and thus the single-instance lock — with this env var. Must run
// before anything touches app.getPath('userData').
if (process.env['AIMTHREAD_USER_DATA']) {
  app.setPath('userData', process.env['AIMTHREAD_USER_DATA'])
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null
let windowMode: 'app' | 'repair' | null = null
let serviceChild: Electron.UtilityProcess | null = null
let hostBridge: ElectronHostBridge | null = null
let startup: Startup | null = null
const portTargets = new Set<BrowserWindow['webContents']>()

const dataDir = app.isPackaged
  ? resolveDataDir({
      env: process.env,
      isPackaged: true,
      electronUserData: app.getPath('userData'),
      homedir: os.homedir(),
      platform: process.platform
    })
  : resolveDataDir({ env: process.env, isPackaged: false, homedir: os.homedir(), platform: process.platform })

const serviceModulePath = join(__dirname, 'service.js')
const rendererIndex = () =>
  process.env['ELECTRON_RENDERER_URL']
    ? process.env['ELECTRON_RENDERER_URL']
    : join(__dirname, '../renderer/index.html')
const repairPageUrl = (query: Record<string, string>) => {
  const search = new URLSearchParams(query).toString()
  return process.env['ELECTRON_RENDERER_URL']
    ? `${process.env['ELECTRON_RENDERER_URL']}/repair.html?${search}`
    : `file://${join(__dirname, '../renderer/repair.html')}?${search}`
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      windowMode = null
    }
  })
  win.webContents.on('destroyed', () => {
    portTargets.delete(win.webContents)
  })
  return win
}

function ensureWindow(): BrowserWindow {
  return mainWindow ?? (mainWindow = createWindow())
}

function showRepairPage(error: StartupErrorInfo): void {
  windowMode = 'repair'
  const win = ensureWindow()
  const locale = resolveLocale(app.getPreferredSystemLanguages())
  win.loadURL(repairPageUrl({ code: error.code, params: JSON.stringify(error.params), locale, dataDir }))
}

function showApp(): void {
  windowMode = 'app'
  const win = ensureWindow()
  const url = rendererIndex()
  if (url.startsWith('file://') || url.startsWith('http')) win.loadURL(url)
  else win.loadFile(url)
  win.focus()
}

// ---------------------------------------------------------------------------
// Port issuing (ADR 0001): one MessageChannelMain per client; the service
// side receives port1, the window receives port2 via preload.
// ---------------------------------------------------------------------------

function issuePort(target: BrowserWindow['webContents']): void {
  if (!serviceChild || startup?.state !== 'ready') return
  const { port1, port2 } = new MessageChannelMain()
  serviceChild.postMessage({ kind: 'connect' }, [port1])
  target.postMessage('aimthread:port', null, [port2])
}

ipcMain.handle('aimthread:request-port', (event) => {
  portTargets.add(event.sender)
  issuePort(event.sender)
})

// ---------------------------------------------------------------------------
// Service launcher
// ---------------------------------------------------------------------------

function forkService(_dataDir: string, handlers: ServiceHandlers): ServiceProcess {
  const child = utilityProcess.fork(serviceModulePath, [], {
    stdio: 'pipe',
    env: {
      ...process.env,
      AIMTHREAD_DATA_DIR: dataDir,
      AIMTHREAD_APP_VERSION: app.getVersion(),
      AIMTHREAD_VALIDATE_OUTPUT: app.isPackaged ? process.env['AIMTHREAD_VALIDATE_OUTPUT'] ?? '' : '1'
    }
  })
  serviceChild = child

  child.on('message', (message: ServiceMessage) => {
    switch (message.kind) {
      case 'ready':
        handlers.onReady(message.info)
        return
      case 'startup-error':
        handlers.onStartupError(message.error)
        return
      case 'host-call':
      case 'host-subscribe':
      case 'host-unsubscribe':
        hostBridge?.handleServiceMessage(message)
        return
      case 'v1-result':
        // V1 verify hook (#65): print and quit.
        console.log(`V1_RESULT:${JSON.stringify(message.result)}`)
        app.quit()
        return
      default:
        return
    }
  })
  child.on('exit', (code) => {
    if (serviceChild === child) serviceChild = null
    handlers.onExit(code)
  })
  child.stderr?.on('data', (d) => console.error(`[service:err] ${d}`))
  child.stdout?.on('data', (d) => console.log(`[service:out] ${d}`))

  return {
    kill: () => {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    },
    get pid() {
      return child.pid ?? null
    }
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  hostBridge = new ElectronHostBridge((msg) => {
    serviceChild?.postMessage(msg)
  })

  startup = new Startup({
    dataDir,
    requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    acquireLock(dir) {
      return acquireDirLock(dir)
    },
    forkService,
    onUiReady(info) {
      console.log(`[main] service ready (schema v${info.toVersion})`)
      if (windowMode !== 'app') showApp()
      // Re-issue ports: every attached window gets a fresh channel to the
      // (re)started service; the renderer also re-requests on reconnect.
      for (const target of portTargets) {
        if (!target.isDestroyed()) issuePort(target)
      }
    },
    onRepairPage(error) {
      console.error(`[main] startup error: ${error.code}`, error.params)
      showRepairPage(error)
    },
    log: (m) => console.log(`[main] ${m}`)
  })

  if (!startup.start()) {
    app.quit() // another instance owns the single-instance lock
    return
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else if (startup?.state === 'ready') {
      showApp()
    } else if (startup?.lastError) {
      showRepairPage(startup.lastError)
    }
  })
})

// Repair-page actions (main owns openPath/quit; retry goes through the
// orchestrator — the data-dir lock is still held).
ipcMain.on('aimthread:repair-retry', () => {
  startup?.retry()
})
ipcMain.on('aimthread:repair-open-data-dir', () => {
  void import('electron').then(({ shell }) => shell.openPath(dataDir))
})
ipcMain.on('aimthread:repair-quit', () => {
  app.quit()
})

app.on('window-all-closed', () => {
  // #67: keep running after the window closes; the tray lands in #69.
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && startup?.state === 'ready') showApp()
})

app.on('before-quit', () => {
  hostBridge?.dispose()
  startup?.shutdown()
})

// E2E hooks (#67): enabled only when the test runner sets this env var.
// Read-only diagnostics — the tests kill the service via its pid.
if (process.env['AIMTHREAD_E2E_HOOKS'] === '1') {
  app.whenReady().then(() => {
    ;(globalThis as Record<string, unknown>).__aimthreadE2E = {
      getServicePid: () => startup?.servicePid ?? null,
      getStartupState: () => startup?.state ?? 'idle'
    }
  })
}
