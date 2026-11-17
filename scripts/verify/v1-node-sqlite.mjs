#!/usr/bin/env node
/**
 * V1: verify node:sqlite works inside an Electron utilityProcess.
 *
 * Per #64 "V1" and #65 acceptance:
 *   - Open a file DB with node:sqlite DatabaseSync.
 *   - Set journal_mode=WAL (read back), synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000.
 *   - Create a table, insert rows.
 *   - With WAL not yet checkpointed, run VACUUM INTO to a second file.
 *   - Open that second file read-only, verify row count, application_id, user_version.
 *
 * Runs in two modes:
 *   1. Plain Node (sanity baseline).
 *   2. Inside an Electron utilityProcess (the real target).
 *
 * Usage:
 *   node scripts/verify/v1-node-sqlite.mjs --node        # plain node baseline
 *   node scripts/verify/v1-node-sqlite.mjs --electron   # real Electron util process
 *
 * Output is printed to stdout AND appended to scripts/verify/v1-results.md.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS_FILE = join(__dirname, 'v1-results.md')

// Resolve the electron binary shipped in node_modules, not a global install.
const _require = createRequire(pathToFileURL(join(__dirname, 'stub.js')).href)
const ELECTRON_BIN = _require('electron')
const APP_ID = 0x41494d54 // 'AIMT'
const USER_VERSION = 1

function setupDb(dbPath) {
  const db = new DatabaseSync(dbPath)
  db.exec(`PRAGMA application_id = ${APP_ID}`)
  db.exec(`PRAGMA user_version = ${USER_VERSION}`)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)')
  const ins = db.prepare('INSERT INTO t (v) VALUES (?)')
  ins.run('a')
  ins.run('b')
  ins.run('c')
  return db
}

function readPragmas(db) {
  const journal = db.prepare('PRAGMA journal_mode').get()
  const fk = db.prepare('PRAGMA foreign_keys').get()
  const busy = db.prepare('PRAGMA busy_timeout').get()
  return { journal, fk, busy }
}

function verifyVacuumInto(db, backupPath) {
  // Force WAL to keep some un-checkpointed pages before VACUUM INTO.
  db.exec('PRAGMA wal_autocheckpoint = 0')
  const ins = db.prepare('INSERT INTO t (v) VALUES (?)')
  ins.run('d')
  ins.run('e')
  db.exec(`VACUUM INTO '${backupPath}'`)
  const ro = new DatabaseSync(backupPath, { readOnly: true })
  const count = ro.prepare('SELECT COUNT(*) AS n FROM t').get()
  const appId = ro.prepare('PRAGMA application_id').get()
  const ver = ro.prepare('PRAGMA user_version').get()
  ro.close()
  return { count, appId, ver }
}

async function runInElectronUtility(workDir) {
  // Write a helper script that Electron's utilityProcess will load.
  const helper = join(workDir, 'util-helper.mjs')
  writeFileSync(
    helper,
    `
// In utilityProcess the parent port is process.parentPort (not importable).
const parentPort = process.parentPort
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const APP_ID = ${APP_ID}
const USER_VERSION = ${USER_VERSION}

function run(workDir) {
  const dbPath = join(workDir, 'app.sqlite')
  const backupPath = join(workDir, 'backup.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA application_id = ' + APP_ID)
  db.exec('PRAGMA user_version = ' + USER_VERSION)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)')
  const ins = db.prepare('INSERT INTO t (v) VALUES (?)')
  ;['a','b','c'].forEach(v => ins.run(v))
  db.exec('PRAGMA wal_autocheckpoint = 0')
  ins.run('d'); ins.run('e')
  db.exec("VACUUM INTO '" + backupPath + "'")
  const journal = db.prepare('PRAGMA journal_mode').get()
  db.close()
  const ro = new DatabaseSync(backupPath, { readOnly: true })
  const count = ro.prepare('SELECT COUNT(*) AS n FROM t').get()
  const appId = ro.prepare('PRAGMA application_id').get()
  const ver = ro.prepare('PRAGMA user_version').get()
  ro.close()
  parentPort.postMessage({ ok: true, journal: journal.journal_mode, count: count.n, appId: appId.application_id, ver: ver.user_version })
}

parentPort.on('message', (ev) => {
  try {
    // utilityProcess 的 parentPort 消息回调收到的是事件对象（.data 载荷）。
    const m = ev?.data ?? ev
    if (m?.workDir) run(m.workDir)
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String(e) })
  }
})
`
  )
  // Build a tiny Electron main that forks the helper as a utilityProcess.
  const electronMain = join(workDir, 'main.mjs')
  writeFileSync(
    electronMain,
    `
import { app, utilityProcess } from 'electron'
app.whenReady().then(() => {
  const p = utilityProcess.fork(${JSON.stringify(helper)}, [], { stdio: 'pipe' })
  p.stdout?.on('data', (d) => process.stdout.write('UTIL_STDOUT:' + d))
  p.stderr?.on('data', (d) => process.stdout.write('UTIL_STDERR:' + d))
  p.on('spawn', () => p.postMessage({ workDir: ${JSON.stringify(workDir)} }))
  p.on('message', (m) => { process.stdout.write('UTIL_RESULT:' + JSON.stringify(m) + '\\n'); app.quit() })
  p.on('exit', (code) => { if (code !== 0) { process.stdout.write('UTIL_EXIT:' + code + '\\n'); app.quit() } })
})
`
  )
  return new Promise((resolve, reject) => {
    const child = spawn(ELECTRON_BIN, [electronMain], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('exit', (code) => {
      const match = out.match(/UTIL_RESULT:(\{.*\})/)
      if (match) resolve(JSON.parse(match[1]))
      else reject(new Error(`electron exited ${code}; stderr=${err}; stdout=${out}`))
    })
  })
}

function record(label, result) {
  const line = `\n## ${new Date().toISOString()} — ${label}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`
  appendFileSync(RESULTS_FILE, line)
  console.log(`\n=== ${label} ===`)
  console.log(JSON.stringify(result, null, 2))
}

async function main() {
  const mode = process.argv[2]
  const header = '# V1 results: node:sqlite in utilityProcess\n\nGenerated by `pnpm verify:v1` (#65).'
  if (!existsSync(RESULTS_FILE)) writeFileSync(RESULTS_FILE, header + '\n')

  if (mode === '--electron') {
    const workDir = mkdtempSync(join(tmpdir(), 'aimthread-v1-elec-'))
    const result = await runInElectronUtility(workDir)
    const verdict = result.count === 5 && result.appId === APP_ID && result.ver === USER_VERSION
    record('electron utilityProcess', { ...result, verdict, workDir })
    rmSync(workDir, { recursive: true, force: true })
    process.exit(verdict ? 0 : 1)
  }

  // --built / --packaged：走应用真实链路（main → utilityProcess service →
  // db/driver.ts），AIMTHREAD_V1_CHECK 门控，主进程把结果打到 stdout。
  // 与 --electron 的独立 helper 不同，这两种模式验证的是生产代码路径。
  if (mode === '--built' || mode === '--packaged') {
    const workDir = mkdtempSync(join(tmpdir(), 'aimthread-v1-app-'))
    const bin =
      mode === '--built'
        ? ELECTRON_BIN
        : 'release/mac-arm64/AimThread.app/Contents/MacOS/AimThread'
    const args = mode === '--built' ? ['.'] : []
    const result = await new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          AIMTHREAD_V1_CHECK: '1',
          AIMTHREAD_V1_DIR: workDir,
          AIMTHREAD_DATA_DIR: workDir
        }
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('timeout waiting for V1_RESULT'))
      }, 60_000)
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { err += d })
      child.on('error', reject)
      child.on('exit', (code) => {
        clearTimeout(timer)
        const match = out.match(/V1_RESULT:(\{.*\})/)
        if (match) resolve(JSON.parse(match[1]))
        else reject(new Error(`app exited ${code} without V1_RESULT; stdout=${out}; stderr=${err}`))
      })
    })
    const verdict =
      result.ok === true &&
      result.journal === 'wal' &&
      result.sync === 1 &&
      result.fk === 1 &&
      result.busy === 5000 &&
      result.rowCount === 5 &&
      result.appId === APP_ID &&
      result.userVersion === USER_VERSION
    record(mode === '--built' ? 'built app (electron-vite out/, dev binary)' : 'packaged app (electron-builder --dir)', {
      ...result,
      verdict,
      workDir
    })
    rmSync(workDir, { recursive: true, force: true })
    process.exit(verdict ? 0 : 1)
  }

  // Default: plain node baseline (also run by `pnpm verify:v1` without args)
  const workDir = mkdtempSync(join(tmpdir(), 'aimthread-v1-node-'))
  const dbPath = join(workDir, 'app.sqlite')
  const backupPath = join(workDir, 'backup.sqlite')
  const db = setupDb(dbPath)
  const pragmas = readPragmas(db)
  const vac = verifyVacuumInto(db, backupPath)
  const result = {
    mode: 'node',
    pragmas,
    vacuumInto: { rowCount: vac.count.n, appId: vac.appId.application_id, userVersion: vac.ver.user_version },
    node: process.version,
    verdict: pragmas.journal.journal_mode === 'wal' && vac.count.n === 5 && vac.appId.application_id === APP_ID && vac.ver.user_version === USER_VERSION
  }
  record('plain node baseline', result)
  db.close()
  rmSync(workDir, { recursive: true, force: true })
  process.exit(result.verdict ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
