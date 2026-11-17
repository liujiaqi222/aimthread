/**
 * utilityProcess 入口。由 main 经 `utilityProcess.fork(modulePath)` 启动。
 *
 * M1-1 只搭最小 ping 链路（#65 验收）：主进程发 `{ kind: 'connect' }` 并
 * 附带一个 MessagePort；本入口把端口接到 createService 上，页面即可直连。
 * 数据库、迁移与协议在 #67 接入。
 *
 * 注意：utilityProcess 里 `process.parentPort` 的 'message' 回调收到的是
 * 带 `.data` / `.ports` 的事件对象（与 worker_threads 不同，见
 * scripts/verify/v1-results.md）。
 */
import { createService } from './index'
import { RealClock } from './clock'
import type { Host, Unsubscribe } from './host'
import { openDatabase } from './db/driver'

const parentPort = process.parentPort as unknown as {
  on(event: 'message', cb: (ev: { data: unknown; ports: unknown[] }) => void): void
  postMessage(msg: unknown): void
  once(event: 'message', cb: (ev: { data: unknown; ports: unknown[] }) => void): void
}

// 开发占位宿主：真实宿主桥接（powerMonitor / 通知 / openPath）在 #67 接入。
const devHost: Host = {
  onSuspend(_cb): Unsubscribe {
    return () => {}
  },
  onResume(_cb): Unsubscribe {
    return () => {}
  },
  async preferredSystemLanguages(): Promise<string[]> {
    return ['en']
  },
  async notify(_n): Promise<{ shown: boolean }> {
    return { shown: true }
  },
  async openPath(_p): Promise<void> {},
  localeChanged(_locale): void {}
}

const service = createService({ clock: new RealClock(), host: devHost })

// utilityProcess 中收到的转交 MessagePort 是 MessagePortMain 语义：
// EventEmitter 风格 `.on('message')`，回调收到带 `.data` 的事件对象
// （实测确认，非 worker_threads 的 `.onmessage` 属性，见 v1-results.md）。
type MessagePortLike = {
  on(event: 'message', cb: (ev: { data: unknown }) => void): void
  postMessage(m: unknown): void
  start(): void
}

function connect(portLike: unknown): void {
  const port = portLike as MessagePortLike
  port.on('message', (ev) => {
    const msg = ev.data as { id: string; name: string; input?: unknown }
    if (!msg?.id) return
    service
      .handleRequest(msg)
      .then((reply) => {
        port.postMessage(reply)
      })
      .catch(() => {
        port.postMessage({ id: msg.id, ok: false, error: { code: 'rpc.internal' } })
      })
  })
  port.start()
}

parentPort.on('message', (ev) => {
  const [port] = ev.ports
  if (port) connect(port)
})

parentPort.postMessage({ kind: 'ready' })

/**
 * V1 自检（#65）：AIMTHREAD_V1_CHECK=1 时在当前进程（开发或打包产物）里
 * 用真实驱动执行 #64 V1 的检查项，结果经 parentPort 回给主进程打印。
 * 仅验证用，正常启动路径不执行。
 */
if (process.env.AIMTHREAD_V1_CHECK === '1') {
  const dir = process.env.AIMTHREAD_V1_DIR ?? '.'
  const result = v1Check(`${dir}/v1-app.sqlite`, `${dir}/v1-backup.sqlite`)
  parentPort.postMessage({ kind: 'v1-result', result })
}

function v1Check(dbPath: string, backupPath: string): unknown {
  try {
    const APP_ID = 0x41494d54
    const db = openDatabase(dbPath)
    db.exec(`PRAGMA application_id = ${APP_ID}`)
    db.exec('PRAGMA user_version = 1')
    db.exec('CREATE TABLE v1 (id INTEGER PRIMARY KEY, v TEXT NOT NULL)')
    const ins = db.prepare('INSERT INTO v1 (v) VALUES (?)')
    for (const v of ['a', 'b', 'c']) ins.run(v)
    db.exec('PRAGMA wal_autocheckpoint = 0')
    ins.run('d')
    ins.run('e')
    db.exec(`VACUUM INTO '${backupPath}'`)
    const journal = db.get('PRAGMA journal_mode')
    const sync = db.get('PRAGMA synchronous')
    const fk = db.get('PRAGMA foreign_keys')
    const busy = db.get('PRAGMA busy_timeout')
    db.close()
    const ro = openDatabase(backupPath, { readOnly: true })
    const count = ro.get('SELECT COUNT(*) AS n FROM v1')
    const appId = ro.get('PRAGMA application_id')
    const ver = ro.get('PRAGMA user_version')
    ro.close()
    return {
      ok: true,
      journal: (journal as { journal_mode?: string })?.journal_mode,
      sync: (sync as { synchronous?: number })?.synchronous,
      fk: (fk as { foreign_keys?: number })?.foreign_keys,
      busy: (busy as { timeout?: number })?.timeout,
      rowCount: (count as { n?: number })?.n,
      appId: (appId as { application_id?: number })?.application_id,
      userVersion: (ver as { user_version?: number })?.user_version,
      node: process.versions.node,
      electron: process.versions.electron
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
