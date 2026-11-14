# SQLite 驱动选型调研（#48）

> 调研日期 2026-11-14。只列事实与权衡，不做最终决定（决定见 #53）。
> 对照 PRD §10.1（本地 Node 服务持有 SQLite）、§10.2（WAL 下一致性备份、schema 演进与失败保护）。

## 0. 版本基线

| 对象 | 当前版本 | 来源 |
|---|---|---|
| Electron stable | 45.3.2（2026-11-12），内置 **Node 24.22.2** | releases.electronjs.org/releases.json |
| better-sqlite3 | 13.2.0（2026-11-14）；13.0.0（2026-07）起改用 N-API | npm、GitHub releases |
| node:sqlite | 随 Node 内置；Node 24.15.0 起为 **Stability 1.2 Release candidate** | nodejs.org/docs/latest-v24.x/api/sqlite.html |
| libsql（libsql-js） | 0.5.29（2026-09）；`@libsql/client` 0.18.0 | npm |
| drizzle-orm / kysely / @electron/rebuild | 0.45.4 / 0.29.9 / 4.2.1 | npm |

## 1. 对比总表

| 维度 | better-sqlite3 13 | node:sqlite（Node 24.22） | libsql 0.5 |
|---|---|---|---|
| API | 同步 | 同步（"All APIs … execute synchronously"） | 默认同步，兼容 better-sqlite3 风格；`libsql/promise` 提供异步版本 |
| 在线备份 API | `db.backup(dest, {progress})` → Promise | `sqlite.backup(db, path, {rate, progress})` → Promise（v22.16 / v23.8 新增） | `backup()` 文档标注 **"currently not supported"** |
| serialize | `db.serialize()` → Buffer | 文档中无 | 不支持 |
| VACUUM INTO | 支持（SQL 层面） | 支持 | 支持（SQL 层面） |
| `:memory:` | 支持；还可以用 serialize 后的 Buffer 打开 | 支持 | 支持 |
| 自定义函数 / pragma helper | 有 | 有 `function()` / `aggregate()`；无 pragma helper | `function`、`aggregate`、`pragma` 均未支持 |
| 原生依赖 | N-API 预编译二进制，与包一起发布 | 无（随 Electron 自带） | napi-rs 按平台拆分的 optional 包（含 `@libsql/darwin-arm64` / `-x64`） |
| 稳定性 | 成熟，使用最广 | RC：API 基本冻结，仍可能有小改动 | 维护中，但官方称 "new features are being developed in Turso" |
| Drizzle | `drizzle-orm/better-sqlite3` | `drizzle-orm/node-sqlite` | `drizzle-orm/libsql` |

## 2. 同步与异步

- 三者底层都是同步调用 SQLite，在 JS 线程上执行。本地单用户、单写入方、小查询的场景下，同步 API 吞吐最高，事务写法也最简单（better-sqlite3 用 `db.transaction(fn)`；node:sqlite 用显式 `BEGIN/COMMIT` 或自己封装）。
- 代价是：慢查询会阻塞所在进程的事件循环。PRD 让本地服务同时负责计时、AI 流式输出和接口，所以把服务放进 **utilityProcess**（或至少不在主进程里）可以隔离阻塞，避免卡住窗口和托盘。utilityProcess 是带完整 Node 环境的子进程，可以加载原生模块和内置模块。
- libsql 的 `libsql/promise` 和 `@libsql/client` 是异步接口，但主要价值在远程 / embedded replica 同步（`syncUrl`）。首版不需要云同步，异步接口带来的收益有限。

## 3. 一致性备份（WAL）

PRD §10.2 要求"运行中导出不得只是随意复制一个可能依赖 WAL 的数据库文件"。可选做法：

1. **SQLite Online Backup API**（better-sqlite3、node:sqlite 有；libsql 无）
   - 按页增量复制，可以显示进度。
   - 两个实现的文档都说明：**同一连接**在备份期间的写入会自动反映到备份；**其他连接**写入会让备份重新开始。PRD 要求单写入实例，只要服务内只有一个写连接，这一点不成问题。
   - 产物是完整的独立 db 文件，包含已 checkpoint 和 WAL 中已提交的内容。
2. **`VACUUM INTO 'file'`**（SQLite ≥ 3.27，三者都能执行）
   - 在一个读事务内生成**压缩过的**一致快照。WAL 模式下读不阻塞写，所以不影响运行中的写入。
   - 一条 SQL 搞定，不依赖驱动的备份 API，libsql 也能用。代价是一次性占用 I/O 和 CPU，没有进度回调，大库期间会长时间持有读事务（WAL 无法 checkpoint 回收）。
   - 目标文件必须不存在，需要自己处理临时文件和原子 rename。
3. **`wal_checkpoint(TRUNCATE)` 后复制文件**：需要停写，还要处理竞态，不推荐。

无论选哪种，恢复前都要校验：可以对产物执行 `PRAGMA integrity_check`、读取 `user_version` 或迁移表来判断版本（PRD 要求"检查格式、版本和目标"）。在这一层三个驱动没有差异。

## 4. 迁移工具

| 方案 | 要点 | 与驱动的关系 |
|---|---|---|
| 手写 + `PRAGMA user_version` | 在代码里放有序的 SQL 数组；启动时在一个事务里执行 `version < N` 的那些，然后设置 `user_version`。零依赖，SQLite 的 DDL 可以放进事务回滚，符合"失败不清库" | 驱动无关 |
| drizzle-kit generate + `migrate()` | 由 schema 生成 SQL 迁移文件夹；运行时 `drizzle-orm/<driver>/migrator` 读取文件夹并应用 | 三个驱动都有官方 adapter。迁移文件夹要随应用打包（如 asar 内或 `extraResources`），运行时可读 |
| Kysely `Migrator` | `up/down` TS 函数，用 `kysely_migration` 表和锁；可以自定义 `MigrationProvider`（打包后不依赖文件系统扫描） | Kysely 内置的 SqliteDialect 面向 better-sqlite3 风格接口。node:sqlite 需要社区 dialect 或自己适配（未验证） |
| 失败保护（三者通用） | 迁移前先用备份 API 或 VACUUM INTO 生成 pre-migration 快照；"版本过高"（db 版本 > 代码版本）时拒绝打开并给出提示 | 驱动无关 |

注意：SQLite 的 `ALTER TABLE` 能力有限，复杂变更需要"建新表 → 拷贝 → 改名"。drizzle-kit 会自动生成这类步骤；手写方案需要自己写。

## 5. 与 Electron 一起打包

- **better-sqlite3 13**：改为 N-API 后，release 说明称预编译二进制 "should theoretically work across different versions of Node.js and Electron"，并移除了 `prebuild-install`，二进制随包发布；没有预编译的平台在安装时现场编译。理论上不再需要每次升级 Electron 都跑 `@electron/rebuild`，但官方用的是"theoretically"，**需要在 Electron 45 中实际验证**。仍需在 asar 中 unpack `.node` 文件（troubleshooting 文档：Electron Forge 用 auto-unpack-natives 插件；electron-builder 默认处理 `.node`）。macOS 签名 / 公证时，`.node` 也要纳入签名。v12 及之前是 V8 ABI，必须对 Electron 重新编译。
- **node:sqlite**：没有原生依赖，不需要 rebuild、unpack 或额外签名。Electron 35 起默认可用（electron#45532 的讨论）；Electron 38 修复了 `require('node:sqlite')` 失败的问题（electron#47706，backport #47757 到 38-x-y）。Electron 45 已包含该修复，但**未在 Electron 45 的 utilityProcess 中实测**（本次环境未允许安装 Electron）。SQLite 版本与编译选项跟随 Electron 内置的 Node，无法自行替换（例如无法换成 SQLCipher）。
- **libsql**：napi-rs 构建，N-API，按平台的 optional 依赖（darwin arm64 和 x64 都有）。同样需要 unpack 和签名。打 universal macOS 包时两个架构的 optional 包都要装上（需要额外配置 npm 的 `--os/--cpu` 或手动安装）。

## 6. 稳定性

- **node:sqlite** 历史：v22.5.0 加入（需 flag）→ v22.13 / v23.4 去掉 `--experimental-sqlite` flag，但仍为 experimental → **v24.15.0 升为 Release candidate (1.2)**（v25.7.0 同步）。Electron 45 的 Node 24.22.2 ≥ 24.15，所以**不需要 flag，处于 RC**，不会打印 experimental 警告（待实测确认）。注意 API 仍在演进：Node 26 文档里 `DatabaseSync` 已改名为 `Database`，v26.8 还调整了 `prepare()`/authorizer 的行为；升级 Electron（也就是升级 Node 大版本）时可能遇到这类小的不兼容改动。
- **better-sqlite3**：生态最成熟，Drizzle / Kysely 的一等公民；v13 是 N-API 重写后的第三个 minor，较新，可能有回归。
- **libsql**：上游战略重心已转向 Turso（Rust 重写，beta），libsql-js 处于维护状态；备份、自定义函数、pragma 等多项 better-sqlite3 API 未支持。

## 7. 测试体验

- 三者都支持 `new X(':memory:')`，可以每个测试建一个独立库，在 Vitest 中跑迁移后执行用例。
- **node:sqlite** 在普通 Node ≥ 22.13（建议 ≥ 24.15，与 Electron 对齐）下直接可用。测试运行环境（系统 Node）与生产（Electron 内 Node）只需保证大版本一致，不存在 ABI 问题。
- **better-sqlite3 v13**：N-API 二进制可以同时被系统 Node 和 Electron 加载，避免"测试要 Node ABI、运行要 Electron ABI 来回 rebuild"的老问题（v12 及之前常见）。`serialize()` 可以快速克隆一个已迁移的模板库，提速测试。
- **libsql**：内存库可用，但缺少 backup/serialize，测试备份流程时只能用 VACUUM INTO。

## 8. 主要权衡（供 #53 决策）

- **零原生依赖 vs 成熟生态**：node:sqlite 省掉打包、签名和 rebuild，但处于 RC 并且跟随 Electron 的 Node 节奏变化；better-sqlite3 v13 有 N-API 后打包成本明显下降，但仍是原生模块。
- **备份能力**：better-sqlite3 和 node:sqlite 都有 Online Backup API；libsql 只能靠 VACUUM INTO。VACUUM INTO 对三者通用，可以作为与驱动无关的导出实现。
- **可替换 SQLite 构建**：只有 better-sqlite3（自定义 amalgamation，v13.2 文档已重写）和 libsql 自带构建能做到；node:sqlite 不行。将来如果需要加密（PRD 目前不承诺），这一点很关键。
- **libsql 的主要卖点（远程同步）不在首版范围**，同时缺少多项 API。

## 来源

- Node.js sqlite 文档（v24）：https://nodejs.org/docs/latest-v24.x/api/sqlite.html ；最新版：https://nodejs.org/api/sqlite.html
- Electron releases（版本与 Node 对照）：https://releases.electronjs.org/releases.json
- electron/electron#45532（Electron 35 默认启用 node:sqlite 的讨论）、#47757（backport 修复 `require('node:sqlite')`）
- better-sqlite3 API：https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md ；troubleshooting：…/docs/troubleshooting.md ；v13.0.0 / v13.2.0 release notes
- libsql-js：https://github.com/tursodatabase/libsql-js 及 docs/api.md
- Drizzle：https://orm.drizzle.team/docs/get-started-sqlite 、/docs/migrations
- Kysely migrations：https://kysely.dev/docs/migrations
- SQLite：https://www.sqlite.org/backup.html 、https://www.sqlite.org/lang_vacuum.html#vacuuminto
