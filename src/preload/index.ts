import { contextBridge, ipcRenderer } from 'electron'

// preload 只做一件事：把主进程发来的 MessagePort 转交给页面（ADR 0001）。
// contextIsolation 下 MessagePort 不能直接过桥，因此经 window.postMessage
// 中转（Electron 文档的标准做法），页面在主世界监听 'message' 事件取 e.ports。
ipcRenderer.on('aimthread:port', (event) => {
  window.postMessage('aimthread:port', '*', event.ports)
})

contextBridge.exposeInMainWorld('aimthread', {
  requestPort(): void {
    ipcRenderer.send('aimthread:request-port')
  }
})
