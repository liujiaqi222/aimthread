import { app, BrowserWindow, utilityProcess, MessageChannelMain, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let serviceProcess: Electron.UtilityProcess | null = null

function resolveServiceModulePath(): string {
  // electron-vite 把服务作为 main 目标的第二个入口，产物与主入口同目录。
  // 开发与打包产物中均为 out/main/service.js。
  return join(__dirname, 'service.js')
}

function spawnService(): Promise<Electron.UtilityProcess> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(resolveServiceModulePath(), [], {
      stdio: 'pipe',
      env: {
        ...process.env,
        AIMTHREAD_DATA_DIR: app.getPath('userData')
      }
    })
    const timer = setTimeout(() => reject(new Error('service spawn timeout')), 10_000)
    child.on('spawn', () => {
      clearTimeout(timer)
      resolve(child)
    })
    child.on('exit', (code) => {
      console.error(`[service] exited with code ${code}`)
      if (serviceProcess === child) serviceProcess = null
    })
    child.stderr?.on('data', (d) => console.error(`[service:err] ${d}`))
    child.stdout?.on('data', (d) => console.log(`[service:out] ${d}`))
    // V1 自检（#65）：把服务的 V1 结果打到 stdout，便于脚本核对。
    child.on('message', (msg) => {
      const m = msg as { kind?: string; result?: unknown }
      if (m?.kind === 'v1-result') {
        console.log(`V1_RESULT:${JSON.stringify(m.result)}`)
        app.quit()
      }
    })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 给一个目标（窗口或未来的托盘）发放一个连到服务的 MessagePort。 */
function issuePort(target: { postMessage(channel: string, msg: unknown, transfer?: unknown[]): void }) {
  if (!serviceProcess) return
  const { port1, port2 } = new MessageChannelMain()
  serviceProcess.postMessage({ kind: 'connect' }, [port1])
  // WebContents.postMessage 发给 preload 的 ipcRenderer（文档标准做法）；
  // preload 再经 window.postMessage 转交主世界。
  target.postMessage('aimthread:port', null, [port2])
}

ipcMain.on('aimthread:request-port', (event) => {
  issuePort(event.sender)
})

app.whenReady().then(async () => {
  // 单实例：拿不到锁就把本次启动视为唤起请求，直接退出。
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  try {
    serviceProcess = await spawnService()
  } catch (e) {
    console.error('failed to spawn service', e)
  }

  createWindow()
})

app.on('window-all-closed', () => {
  // M1 骨架：关窗即退出（托盘驻留在 #69）。
  if (!serviceProcess) app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  serviceProcess?.kill()
})
