/**
 * Transport selection (#64 D3): preload bridge ⇒ MessagePort; browser dev ⇒
 * loopback HTTP (DEV-guarded dynamic import keeps it out of prod bundles);
 * anything else is a wiring bug.
 */

import type { ServiceClient } from './types'
import { createMessagePortClient, type PortLike } from './port-client'

interface ElectronBridge {
  requestPort(): Promise<void> | void
}

export async function createServiceClient(): Promise<ServiceClient> {
  const bridge = (window as unknown as { aimthread?: ElectronBridge }).aimthread

  if (bridge?.requestPort) {
    return createMessagePortClient({
      acquirePort: () =>
        new Promise<PortLike>((resolve) => {
          const onMessage = (e: MessageEvent) => {
            if (e.data === 'aimthread:port' && e.ports?.[0]) {
              window.removeEventListener('message', onMessage)
              resolve(e.ports[0] as unknown as PortLike)
            }
          }
          window.addEventListener('message', onMessage)
          void bridge.requestPort()
        })
    })
  }

  if (import.meta.env.DEV) {
    const { createHttpClient } = await import('./http-client')
    const baseUrl = (import.meta.env.VITE_SERVICE_URL as string | undefined) ?? 'http://127.0.0.1:8765'
    return createHttpClient({ baseUrl })
  }

  throw new Error('no service transport available')
}
