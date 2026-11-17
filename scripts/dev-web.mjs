#!/usr/bin/env node
/**
 * Browser dev mode (#64 D4): the same renderer served by Vite, talking to the
 * service running as a plain Node process over loopback HTTP.
 *
 *   renderer      vite --config vite.web.config.ts   (default :5173)
 *   service       tsx watch src/service/entry-dev.ts  (default :8765)
 *
 * Both processes die on SIGINT; VITE_SERVICE_URL points the renderer at the
 * dev transport (see src/ui/client/create.ts).
 */

import { spawn } from 'node:child_process'

const children = []

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...env }
  })
  children.push(child)
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`[dev:web] ${name} exited with ${code}; shutting down`)
      shutdown()
    }
  })
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  // Give children a moment, then force-kill (tsx watch can ignore SIGTERM).
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL')
    }
    process.exit(0)
  }, 1500).unref()
}

const serviceUrl = process.env['VITE_SERVICE_URL'] ?? 'http://127.0.0.1:8765'

console.log(`[dev:web] renderer on http://localhost:5173, service at ${serviceUrl}`)
run('service', 'pnpm', ['exec', 'tsx', 'watch', '--tsconfig', 'tsconfig.node.json', 'src/service/entry-dev.ts'], {
  VITE_SERVICE_URL: serviceUrl
})
run('renderer', 'pnpm', ['exec', 'vite', '--config', 'vite.web.config.ts'], {
  VITE_SERVICE_URL: serviceUrl
})

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
