import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { DB_FILE_NAME } from '@shared/app'

/**
 * #67 e2e: startup + init, duplicate launch, data-dir lock conflict, repair
 * page, crash → restart → reconnect, and the fatal page. Runs against the
 * built output (`pnpm test:e2e` builds first). Each test gets isolated data
 * and userData directories; AIMTHREAD_E2E_HOOKS exposes read-only diagnostics.
 */

const launched: ElectronApplication[] = []
const dirs: string[] = []

test.afterEach(async () => {
  for (const app of launched.splice(0)) {
    try {
      await app.close()
    } catch {
      // Already gone.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function freshDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `aimthread-e2e-${prefix}-`))
  dirs.push(dir)
  return dir
}

function launchOptions(dataDir: string, userDataDir: string): Parameters<typeof electron.launch>[0] {
  return {
    args: ['.'],
    env: {
      ...process.env,
      AIMTHREAD_DATA_DIR: dataDir,
      AIMTHREAD_USER_DATA: userDataDir,
      AIMTHREAD_E2E_HOOKS: '1'
    }
  }
}

async function launchApp(dataDir: string, userDataDir: string): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch(launchOptions(dataDir, userDataDir))
  launched.push(app)
  const win = await app.firstWindow()
  return { app, win }
}

/** Evaluated in the Electron main process. */
const hook = {
  pid: () =>
    (globalThis as { __aimthreadE2E?: { getServicePid(): number | null } }).__aimthreadE2E?.getServicePid() ??
    null,
  state: () =>
    (globalThis as { __aimthreadE2E?: { getStartupState(): string } }).__aimthreadE2E?.getStartupState() ?? 'idle'
}

/** Polls until check passes; returns the passing value. */
async function pollUntil<T>(probe: () => Promise<T> | T, check: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await probe()
    if (check(v)) return v
    if (Date.now() > deadline) throw new Error(`pollUntil timed out; last value: ${JSON.stringify(v)}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

test('starts, initializes the data directory, and serves query + push over MessagePort', async () => {
  const { app, win } = await launchApp(freshDir('smoke'), freshDir('smoke-ud'))

  // The sample query round-trips through the whole chain.
  await expect(win.getByTestId('app-info-name')).toHaveText('AimThread', { timeout: 15_000 })
  await expect(win.getByTestId('client-status-value')).toHaveText('connected')

  // The push path: emit → changed event arrives.
  await win.getByTestId('emit-button').click()
  await expect(win.getByTestId('changed-log')).toHaveText(/app/, { timeout: 10_000 })

  // Data directory was initialized for real.
  expect(String(await app.evaluate(hook.state))).toBe('ready')
})

test('corrupt database shows the repair page and leaves the file alone', async () => {
  const dataDir = freshDir('corrupt')
  const garbage = Buffer.from('definitely not a sqlite database')
  writeFileSync(join(dataDir, DB_FILE_NAME), garbage)

  const { app, win } = await launchApp(dataDir, freshDir('corrupt-ud'))

  await expect(win.getByTestId('repair-title')).toBeVisible({ timeout: 15_000 })
  await expect(win.getByTestId('repair-reason')).toBeVisible()
  // db.corrupt keeps retry available; the file was never replaced.
  await expect(win.getByTestId('repair-retry')).toBeVisible()
  const still = (await import('node:fs')).readFileSync(join(dataDir, DB_FILE_NAME))
  expect(still.equals(garbage)).toBe(true)
  expect(await app.evaluate(hook.state)).toBe('repair')
})

test('killing the service restarts it and the UI reconnects with a new pid', async () => {
  const { app, win } = await launchApp(freshDir('restart'), freshDir('restart-ud'))

  await expect(win.getByTestId('client-status-value')).toHaveText('connected', { timeout: 15_000 })
  const pidBefore = (await app.evaluate(hook.pid)) as number
  expect(pidBefore).toBeTruthy()

  process.kill(pidBefore, 'SIGKILL')

  // Service restarts; wait for a *new, live* pid (the brief null window
  // during restart must not pass the poll).
  const newPid = await pollUntil(
    async () => (await app.evaluate(hook.pid)) as number | null,
    (p): p is number => typeof p === 'number' && p !== pidBefore
  )
  // The UI reconnected and shows the new service.
  await expect
    .poll(async () => win.getByTestId('app-info-pid').textContent(), { timeout: 20_000 })
    .toContain(String(newPid))
  await expect(win.getByTestId('client-status-value')).toHaveText('connected')
})

test('crash loop within a minute exhausts restarts and shows the fatal page', async () => {
  const { app, win } = await launchApp(freshDir('loop'), freshDir('loop-ud'))

  await expect(win.getByTestId('client-status-value')).toHaveText('connected', { timeout: 15_000 })

  for (let i = 0; i < 3; i++) {
    const pid = (await app.evaluate(hook.pid)) as number
    process.kill(pid, 'SIGKILL')
    // Wait for the throttled restart: a *different, live* pid.
    await pollUntil(
      async () => (await app.evaluate(hook.pid)) as number | null,
      (p): p is number => typeof p === 'number' && p !== pid
    )
  }

  // The 4th crash gets no restart budget: fatal page, quit-only actions.
  const lastPid = (await app.evaluate(hook.pid)) as number
  process.kill(lastPid, 'SIGKILL')
  await expect
    .poll(async () => await app.evaluate(hook.state), { timeout: 20_000 })
    .toBe('fatal')
  await expect(win.getByTestId('repair-title')).toBeVisible({ timeout: 15_000 })
  await expect(win.getByTestId('repair-retry')).toBeHidden()
})

test('a second instance with the same userData exits and the first keeps running', async () => {
  const dataDir = freshDir('dup')
  const userDataDir = freshDir('dup-ud')
  const first = await launchApp(dataDir, userDataDir)
  await expect(first.win.getByTestId('client-status-value')).toHaveText('connected', { timeout: 15_000 })

  const second = await electron.launch(launchOptions(dataDir, userDataDir))
  try {
    if (second.process().exitCode === null) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('second instance did not exit')), 15_000)
        second.process().once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  } finally {
    await second.close().catch(() => {})
  }

  // The original instance is untouched.
  expect(await first.app.evaluate(hook.state)).toBe('ready')
  await expect(first.win.getByTestId('client-status-value')).toHaveText('connected')
})

test('a second instance on the same data directory (different userData) hits the file lock', async () => {
  const dataDir = freshDir('lock')
  const first = await launchApp(dataDir, freshDir('lock-ud-a'))
  await expect(first.win.getByTestId('client-status-value')).toHaveText('connected', { timeout: 15_000 })

  const second = await electron.launch(launchOptions(dataDir, freshDir('lock-ud-b')))
  launched.push(second)
  const winB = await second.firstWindow()

  // Passes the single-instance lock (different userData), fails the
  // data-dir file lock → repair page with app.lockFailed.
  await expect(winB.getByTestId('repair-title')).toBeVisible({ timeout: 15_000 })
  expect(await second.evaluate(hook.state)).toBe('repair')
  await expect(winB.getByTestId('repair-retry')).toBeVisible()

  // The first instance keeps serving.
  expect(await first.app.evaluate(hook.state)).toBe('ready')
})
