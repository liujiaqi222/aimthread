/**
 * 数据库驱动薄接口（M1 spec D2）。
 *
 * 同步 API；`node:sqlite` 实现只出现在本文件。V1 验证（#65，
 * scripts/verify/v1-results.md）：Electron 45.2.1 内嵌 Node 24.22.1，
 * utilityProcess 中 node:sqlite 可用，WAL 与 `VACUUM INTO` 均正常。
 *
 * 领域模块的 repo.ts 只依赖此接口，不感知具体驱动。
 */

import { DatabaseSync } from 'node:sqlite'

export interface StatementResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface Statement {
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Array<Record<string, unknown>>
  run(...params: unknown[]): StatementResult
}

export interface Database {
  prepare(sql: string): Statement
  exec(sql: string): void
  /** 取一行；无结果返回 undefined。 */
  get(sql: string, ...params: unknown[]): Record<string, unknown> | undefined
  /** 取多行。 */
  all(sql: string, ...params: unknown[]): Array<Record<string, unknown>>
  /** 事务：fn 内的所有写入要么全部提交，要么全部回滚。 */
  transaction<T>(fn: () => T): T
  close(): void
}

/** 连接参数（#53）：WAL、NORMAL、外键、busy_timeout。 */
export const CONNECTION_PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA foreign_keys = ON',
  'PRAGMA busy_timeout = 5000'
] as const

export function openDatabase(path: string, options: { readOnly?: boolean } = {}): Database {
  const raw = new DatabaseSync(path, options.readOnly ? { readOnly: true } : {})
  if (!options.readOnly) {
    for (const pragma of CONNECTION_PRAGMAS) raw.exec(pragma)
  }

  const prepare = (sql: string): Statement => {
    const stmt = raw.prepare(sql)
    return {
      get: (...p) => stmt.get(...(p as never[])) as Record<string, unknown> | undefined,
      all: (...p) => stmt.all(...(p as never[])) as Array<Record<string, unknown>>,
      run: (...p) => stmt.run(...(p as never[])) as unknown as StatementResult
    }
  }

  return {
    prepare,
    exec: (sql) => void raw.exec(sql),
    get: (sql, ...p) => prepare(sql).get(...p),
    all: (sql, ...p) => prepare(sql).all(...p),
    transaction: (fn) => {
      raw.exec('BEGIN')
      try {
        const result = fn()
        raw.exec('COMMIT')
        return result
      } catch (e) {
        raw.exec('ROLLBACK')
        throw e
      }
    },
    close: () => raw.close()
  }
}
