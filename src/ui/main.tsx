import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/theme.css'

// M1-1 冒烟链路：页面经 preload 拿到 MessagePort，向服务发 ping，收回 pong。
// 覆盖 renderer -> preload -> main -> utilityProcess 全程（ADR 0001）。
function App() {
  const [reply, setReply] = useState('waiting…')

  useEffect(() => {
    const bridge = (window as unknown as {
      aimthread?: { requestPort(): void }
    }).aimthread
    if (!bridge) {
      setReply('preload bridge missing')
      return
    }

    let port: MessagePort | null = null
    const onWindowMessage = (e: MessageEvent) => {
      if (e.data !== 'aimthread:port' || !e.ports[0]) return
      window.removeEventListener('message', onWindowMessage)
      port = e.ports[0]
      const id = crypto.randomUUID()
      port.onmessage = (ev) => {
        const msg = ev.data as { id: string; ok: boolean; result?: { message: string } }
        if (msg?.id === id && msg.ok) setReply(`service: ${msg.result?.message ?? '(empty)'}`)
      }
      port.postMessage({ id, name: 'ping' })
    }
    window.addEventListener('message', onWindowMessage)
    bridge.requestPort()
    return () => {
      window.removeEventListener('message', onWindowMessage)
      port?.close()
    }
  }, [])

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>AimThread</h1>
      <p data-testid="ping-result">M1-1 smoke link: {reply}</p>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
