import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'

/**
 * #67 acceptance, browser leg: the same renderer, served by plain Vite, run
 * as a pure web page — a sample query and a changed push over the dev HTTP
 * transport, no AimThread preload/main anywhere.
 *
 * The page runs in Chromium via Electron's bundled binary (`args: []` = the
 * default app; its window is navigated to the Vite URL like any web page). A
 * plain-Chromium download isn't available on every dev network, and this
 * exercises exactly the browser code path: no `window.aimthread` bridge, so
 * src/ui/client/create.ts picks the HTTP transport. For a real-browser
 * check, run `pnpm dev:web` and open http://localhost:5173 manually.
 */

const SERVICE_PORT = 8899
const RENDERER_PORT = 5188
const SERVICE_URL = `http://127.0.0.1:${SERVICE_PORT}`
const RENDERER_URL = `http://localhost:${RENDERER_PORT}`

let service: ChildProcess | undefined
let renderer: ChildProcess | undefined
let dataDir: string | undefined
const output: string[] = []

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}\n${output.slice(-10).join('\n')}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aimthread-browser-e2e-'))
  service = spawn('pnpm', ['exec', 'tsx', '--tsconfig', 'tsconfig.node.json', 'src/service/entry-dev.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AIMTHREAD_DATA_DIR: dataDir,
      AIMTHREAD_DEV_PORT: String(SERVICE_PORT),
      AIMTHREAD_DEV_ORIGINS: RENDERER_URL,
      VITE_SERVICE_URL: SERVICE_URL
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  service.stdout?.on('data', (d) => output.push(`[service] ${d}`))
  service.stderr?.on('data', (d) => output.push(`[service:err] ${d}`))

  renderer = spawn(
    'pnpm',
    ['exec', 'vite', '--config', 'vite.web.config.ts', '--port', String(RENDERER_PORT), '--strictPort'],
    {
      cwd: process.cwd(),
      env: { ...process.env, VITE_SERVICE_URL: SERVICE_URL },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  renderer.stdout?.on('data', (d) => output.push(`[renderer] ${d}`))
  renderer.stderr?.on('data', (d) => output.push(`[renderer:err] ${d}`))

  await waitForHttp(`${SERVICE_URL}/health`)
  await waitForHttp(RENDERER_URL)
})

test.afterAll(() => {
  service?.kill('SIGTERM')
  renderer?.kill('SIGTERM')
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('browser dev mode: sample query and changed push over loopback HTTP', async () => {
  const app = await electron.launch({ args: [] })
  try {
    const page = await app.firstWindow()
    await page.goto(RENDERER_URL)

    // A pure web page: no preload bridge, so the HTTP transport is in play.
    expect(await page.evaluate(() => (window as { aimthread?: unknown }).aimthread)).toBeUndefined()

    // The sample query round-trips through POST /rpc.
    await expect(page.getByTestId('app-info-name')).toHaveText('AimThread', { timeout: 20_000 })
    await expect(page.getByTestId('client-status-value')).toHaveText('connected')

    // The push path: SSE /events delivers the changed event.
    await page.getByTestId('emit-button').click()
    await expect(page.getByTestId('changed-log')).toHaveText(/app/, { timeout: 10_000 })
  } finally {
    await app.close()
  }
})
