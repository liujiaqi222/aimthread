#!/usr/bin/env node
/**
 * Build hygiene check (#64 D3 / #67): the production service bundle must not
 * contain the dev HTTP transport, and the renderer build must contain the
 * repair page. Run automatically as part of `pnpm build`.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const FAILURES = []

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    FAILURES.push(name)
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function readAll(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isFile()) out.push({ name, content: readFileSync(full, 'utf-8') })
  }
  return out
}

console.log('checking production build output…')

// 1. Dev HTTP transport markers must be absent from every main-process chunk.
const devMarkers = [
  ['dev-server module', 'startDevHttpServer'],
  ['HTTP rpc endpoint', '"/rpc"'],
  ['SSE endpoint', '"/events"'],
  ['SSE content type', 'text/event-stream'],
  ['dev entry', 'entry-dev']
]
const mainFiles = [...readAll('out/main'), ...readAll('out/preload')]
for (const [label, marker] of devMarkers) {
  const offender = mainFiles.find((f) => f.content.includes(marker))
  check(`main/preload bundles contain no ${label}`, !offender, offender?.name)
}

// 2. The dev service entry must not be built at all.
check('no dev entry emitted', !existsSync('out/main/entry-dev.js'))

// 3. The repair page must be in the renderer build.
const repairHtml = readAll('out/renderer').find((f) => f.name === 'repair.html')
check('repair page built', Boolean(repairHtml))

if (FAILURES.length > 0) {
  console.error(`\nbuild check failed: ${FAILURES.join('; ')}`)
  process.exit(1)
}
console.log('build check passed')
