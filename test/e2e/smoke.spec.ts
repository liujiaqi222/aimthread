import { test, expect, _electron as electron } from '@playwright/test'

// M1-1 验收：pnpm dev 打开空窗口，渲染进程经 MessagePort 收到服务回的 ping。
// #68+ 的 e2e 冒烟（初始化、计时、双窗口等）在此基础上补（D4）。
test('app opens and renderer receives pong from the service over MessagePort', async () => {
  const app = await electron.launch({ args: ['.'] })
  const win = await app.firstWindow()
  await expect(win.getByTestId('ping-result')).toHaveText(/service: pong/, {
    timeout: 15_000
  })
  const windows = app.windows()
  expect(windows.length).toBeGreaterThanOrEqual(1)
  await app.close()
})
