import { contextBridge, ipcRenderer } from 'electron'

// Preload stays minimal (#64 D1): hand MessagePorts to the page, and expose
// the repair-page action bridge. Everything else goes through the service
// protocol.

// contextIsolation 下 MessagePort 不能直接过桥，因此经 window.postMessage
// 中转（Electron 文档的标准做法），页面在主世界监听 'message' 事件取 e.ports。
ipcRenderer.on('aimthread:port', (event) => {
  window.postMessage('aimthread:port', '*', event.ports)
})

contextBridge.exposeInMainWorld('aimthread', {
  /** Ask main for a fresh MessagePort connected to the service. */
  async requestPort(): Promise<void> {
    await ipcRenderer.invoke('aimthread:request-port')
  },
  /** Repair/fatal page actions; main owns openPath and quit. */
  repair: {
    retry(): void {
      ipcRenderer.send('aimthread:repair-retry')
    },
    openDataDir(): void {
      ipcRenderer.send('aimthread:repair-open-data-dir')
    },
    quit(): void {
      ipcRenderer.send('aimthread:repair-quit')
    }
  }
})
