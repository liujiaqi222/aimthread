import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import './theme/theme.css'
import type { ServiceClient } from './client/types'
import type { ClientStatus } from './client/types'
import { createServiceClient } from './client/create'

/**
 * M1-3 骨架界面（#67）：示例查询（app.info）、changed 推送（debug.emitChange
 * 触发）、连接状态横幅。功能页面在 #68–#70 加入路由。
 */

const queryClient = new QueryClient()

function App({ client }: { client: ServiceClient }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<ClientStatus>('connecting')
  const [changeLog, setChangeLog] = useState<string[]>([])

  useEffect(() => {
    const unsub = client.onStatus(setStatus)
    return unsub
  }, [client])

  // Re-fetch after a reconnect: the service restarted, everything may be stale.
  useEffect(() => {
    if (status !== 'connected') return
    void qc.invalidateQueries()
  }, [status, qc])

  useEffect(
    () =>
      client.onEvent('changed', (payload) => {
        setChangeLog((log) => [...log.slice(-9), payload.topics.join(', ')])
        void qc.invalidateQueries({ queryKey: ['app-info'] })
      }),
    [client, qc]
  )

  const info = useQuery({
    queryKey: ['app-info'],
    queryFn: () => client.query('app.info', undefined)
  })

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 720 }}>
      {status === 'reconnecting' && (
        <div
          data-testid="reconnecting-banner"
          style={{ padding: '0.5rem 1rem', marginBottom: '1rem', border: '1px solid currentColor', borderRadius: 8 }}
        >
          服务重启中，正在重连…
        </div>
      )}

      <h1>AimThread</h1>
      <p data-testid="client-status">
        transport status: <strong data-testid="client-status-value">{status}</strong>
      </p>

      {info.isPending ? (
        <p data-testid="app-info-loading">loading…</p>
      ) : info.isError ? (
        <p data-testid="app-info-error">service error: {String(info.error)}</p>
      ) : (
        <ul data-testid="app-info">
          <li data-testid="app-info-name">{info.data.name}</li>
          <li data-testid="app-info-version">v{info.data.version}</li>
          <li data-testid="app-info-schema">schema v{info.data.schemaVersion}</li>
          <li data-testid="app-info-pid">service pid: {info.data.pid}</li>
        </ul>
      )}

      <button
        data-testid="emit-button"
        onClick={() => void client.command('debug.emitChange', { topics: ['app'] })}
      >
        emit change
      </button>

      <h2>changed events</h2>
      {changeLog.length === 0 ? (
        <p data-testid="changed-log-empty">(none yet)</p>
      ) : (
        <ol data-testid="changed-log">
          {changeLog.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

async function boot(): Promise<void> {
  const client = await createServiceClient()
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App client={client} />
      </QueryClientProvider>
    </React.StrictMode>
  )
}

void boot().catch((e) => {
  const root = document.getElementById('root')
  if (root) root.textContent = `failed to start: ${e instanceof Error ? e.message : e}`
})
