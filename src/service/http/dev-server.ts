/**
 * Dev-only HTTP transport (#64 D3 / ADR 0001): POST /rpc + GET /events (SSE),
 * bound to 127.0.0.1 only, Origin-checked against the Vite dev server.
 *
 * This file must be referenced **only by entry-dev.ts** so it never reaches
 * the production service bundle; scripts/check-build.mjs verifies that at
 * build time.
 */

import http from 'node:http'
import type { Service } from '../index'

export const DEFAULT_DEV_PORT = 8765

export interface DevServerOptions {
  service: Service
  /** Defaults to AIMTHREAD_DEV_PORT, then 8765. */
  port?: number
  /** Origins allowed for browser requests. Empty Origin (curl, tests) is always allowed. */
  allowedOrigins?: string[]
}

export interface DevServer {
  port: number
  close(): Promise<void>
}

const MAX_BODY_BYTES = 1_000_000

function defaultOrigins(env: Record<string, string | undefined>): string[] {
  if (env['AIMTHREAD_DEV_ORIGINS']) {
    return env['AIMTHREAD_DEV_ORIGINS'].split(',').map((s) => s.trim()).filter(Boolean)
  }
  return ['http://localhost:5173', 'http://127.0.0.1:5173']
}

export function startDevHttpServer(opts: DevServerOptions): Promise<DevServer> {
  const service = opts.service
  const allowedOrigins = opts.allowedOrigins ?? defaultOrigins(process.env)

  const server = http.createServer((req, res) => {
    const origin = req.headers['origin']
    // Non-browser clients send no Origin and are local by construction
    // (loopback bind); browsers must come from the Vite dev server.
    const corsOrigin = origin && allowedOrigins.includes(origin) ? origin : null
    if (origin && !corsOrigin) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('origin not allowed')
      return
    }
    // The dev page is cross-origin (Vite :5173 → service :8765), so the
    // browser needs CORS; echo the exact allowed origin, never `*`.
    const corsHeaders: Record<string, string> = corsOrigin
      ? {
          'access-control-allow-origin': corsOrigin,
          'access-control-allow-methods': 'POST, GET, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'vary': 'Origin'
        }
      : {}

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders)
      res.end()
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain', ...corsHeaders })
      res.end('ok')
      return
    }

    if (req.method === 'POST' && req.url === '/rpc') {
      handleRpc(req, res, service, corsHeaders)
      return
    }

    if (req.method === 'GET' && req.url === '/events') {
      handleEvents(req, res, service, corsHeaders)
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain', ...corsHeaders })
    res.end('not found')
  })

  const port = opts.port ?? Number(process.env['AIMTHREAD_DEV_PORT'] ?? DEFAULT_DEV_PORT)
  const sockets = new Set<import('node:net').Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  return new Promise<DevServer>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({
        get port() {
          const addr = server.address()
          return typeof addr === 'object' && addr ? addr.port : port
        },
        close() {
          return new Promise((resolveClose) => {
            // SSE connections keep the server otherwise un-closable.
            for (const socket of sockets) socket.destroy()
            server.close(() => resolveClose(undefined))
          })
        }
      })
    })
  })
}

function handleRpc(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  service: Service,
  corsHeaders: Record<string, string>
): void {
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: '', ok: false, error: { code: 'rpc.invalidInput', params: { detail: 'body too large' } } }))
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', async () => {
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || 'null')
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: '', ok: false, error: { code: 'rpc.invalidInput', params: { detail: 'invalid JSON' } } }))
      return
    }
    const response = await service.handleRequest(body)
    res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders })
    res.end(JSON.stringify(response))
  })
}

function handleEvents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  service: Service,
  corsHeaders: Record<string, string>
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    ...corsHeaders
  })
  res.write('retry: 1000\n\n')

  const unsubscribe = service.hub.subscribe({
    send: (push) => {
      res.write(`data: ${JSON.stringify(push)}\n\n`)
    }
  })

  const heartbeat = setInterval(() => {
    res.write(': hb\n\n')
  }, 15_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}
