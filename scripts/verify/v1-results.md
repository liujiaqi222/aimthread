# V1 结果：node:sqlite 在 utilityProcess 中是否可用

由 `pnpm verify:v1` 生成（#65 / #64）。驱动决策：**node:sqlite 可用，按原方案采用，无需退回 better-sqlite3。**

## 环境

- Electron **45.2.1**（spec 指定的大版本；45.3.3 发布于 2026-11-16，不满足本机 pnpm minimumReleaseAge 两周策略，取 45.2.1）
- Electron 内嵌 Node **24.22.1**（`process.versions`），与本机 pnpm/Node 24.14 同为 ABI 150
- macOS 15 (darwin 25.6, arm64)

## 检查项（两种模式各跑一次）

脚本：`scripts/verify/v1-node-sqlite.mjs`（`--node` 纯 Node 基线；`--electron` utilityProcess 真实目标）

1. `DatabaseSync` 打开文件库
2. 依次执行 `journal_mode=WAL`（读回确认 `wal`）、`synchronous=NORMAL`、`foreign_keys=ON`、`busy_timeout=5000`
3. 建表写入 3 行
4. `wal_autocheckpoint=0` 保持 WAL 未 checkpoint，再写入 2 行，`VACUUM INTO` 到另一文件
5. 只读打开该文件，核对行数（5）、`application_id`（0x41494d54 = 'AIMT'）、`user_version`（1）

## 结果

### 纯 Node 基线（Node v24.14.0）— 通过

```json
{
  "mode": "node",
  "pragmas": { "journal": "wal", "fk": 1, "busy_timeout": 5000 },
  "vacuumInto": { "rowCount": 5, "appId": 1095322964, "userVersion": 1 },
  "verdict": true
}
```

### Electron utilityProcess（45.2.1 / Node 24.22.1）— 通过

```json
{
  "ok": true,
  "journal": "wal",
  "count": 5,
  "appId": 1095322964,
  "ver": 1,
  "verdict": true
}
```

（完整 JSON 由脚本追加在本节下方。）

### 打包产物（electron-builder --dir）— 见文末

## 过程记录（为什么中间一度失败）

首次验证时脚手架误装了 **Electron 34**（Node 20.19.1），`node:sqlite` 报
`ERR_UNKNOWN_BUILTIN_MODULE`，按 #53 退回条款试了 better-sqlite3 13 备选，随即发现：

- better-sqlite3 13.2.0 的 npm prebuild 在 Node 24 正常，但在 **纯 Node 20.19.1 下也段错误**
  （exit 139，与 Electron 无关），意味着该 prebuild 在 Node 20 运行时整体不可用；
- 现有 lockfile/工具链照旧用 electron-rebuild 也无法解决（其 prebuild 布局硬编码
  `prebuilds/<platform>-<arch>.node`，`electron-rebuild` 会被 binding.gyp 的
  `prebuild_exists` 守卫静默 no-op）。

再核对 spec 发现 V1 的前提是 **Electron 45**。升级到 45.2.1（Node 24.22.1）后：

- `node:sqlite` 模块在 utilityProcess 中可正常 import、打开 `:memory:` 与文件库；
- 期间一次「unable to open database file」是脚本自身的 bug：utilityProcess 的
  `process.parentPort` 消息回调收到的是带 `.data` 的事件对象，不是消息本身；
  修正后全部检查项通过。

结论：失败根因是 Electron 大版本装错，不是 node:sqlite 的问题。better-sqlite3 依赖
与验证脚本已移除，退回方案无需启用。

## 注意事项（给 #67）

- `node:sqlite` 仍带 ExperimentalWarning（Node 24）；Electron 45 内嵌 Node 24.22.1 同样如此。
  正式处理（日志卫生）待 #67 再定。
- utilityProcess 中 `process.parentPort.on('message')` 的事件形状是 `{ data, ports }`，
  与 worker_threads 不同（实测确认）。
- **经 MessageChannelMain 转发到 utilityProcess 的 MessagePort 在服务侧是
  MessagePortMain 语义**：EventEmitter 风格 `port.on('message', ev => ev.data)`，
  且需显式 `port.start()`；给 `port.onmessage` 赋值不会收到消息。e2e ping
  链路（`test/e2e/smoke.spec.ts`）覆盖此路径。

## 2026-11-16T12:57:53.455Z — built app (electron-vite out/, dev binary)

```json
{
  "ok": true,
  "journal": "wal",
  "sync": 1,
  "fk": 1,
  "busy": 5000,
  "rowCount": 5,
  "appId": 1095322964,
  "userVersion": 1,
  "node": "24.22.1",
  "electron": "45.2.1",
  "verdict": true,
  "workDir": "/var/folders/gx/m61tmlf15p3_jqg12p_zvm1w0000gn/T/aimthread-v1-app-8mNSDY"
}
```

## 2026-11-16T12:57:57.757Z — packaged app (electron-builder --dir)

```json
{
  "ok": true,
  "journal": "wal",
  "sync": 1,
  "fk": 1,
  "busy": 5000,
  "rowCount": 5,
  "appId": 1095322964,
  "userVersion": 1,
  "node": "24.22.1",
  "electron": "45.2.1",
  "verdict": true,
  "workDir": "/var/folders/gx/m61tmlf15p3_jqg12p_zvm1w0000gn/T/aimthread-v1-app-ki3Sis"
}
```
