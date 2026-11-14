# Electron 系统集成的能力与约束（研究 #47）

> 范围：macOS 优先。只列事实与取舍，不做决定（决定见 #52）。
> 基准版本：Electron **45.3.2**（2026-11-13，Node 24.22.2 / Chromium 156），即 npm 当前 `latest`。下列结论引自 `electronjs.org/docs/latest`（对应 45.x），另有说明的除外。
> 标注 **[未核实]** 的条目需要在 spike 里验证。

## 1. 本地 Node 服务放在哪里

| 选项 | 事实 | 取舍 |
| --- | --- | --- |
| **主进程内** | 能直接用所有主进程 API（safeStorage、powerMonitor、托盘）。 | 同步 SQLite / CPU 繁重的 AI 回合会阻塞主进程事件循环，进而拖慢窗口、菜单、IPC；服务崩溃 = 整个应用崩溃。无需进程间协议。 |
| **`utilityProcess.fork()`** | 基于 Chromium Services API 启动的子进程，开启 Node 与 MessagePort（≥ Electron 22）。父端通过 `child.postMessage(msg, [MessagePortMain])` 传端口，子端读 `process.parentPort`。可设置 `serviceName`（会出现在 `app.getAppMetrics()` 和 `child-process-gone` 中）、`env`、`execArgv`、`stdio`（stdin 只能用 `ignore`）、`cwd`；macOS 上还有 `allowLoadingUnsignedLibraries` 和 `disclaim`。事件：`spawn`、`exit`、`message`，以及实验性的 `error`。 | 与主进程隔离，崩溃可被观测并重启；生命周期由 Electron 管理，随应用退出。**不能**调用 safeStorage / powerMonitor 等主进程 API，需要主进程代为调用并转发。可以加载原生模块（Node 环境，ABI 与 Electron 一致，见 §5）。 |
| **`child_process.fork/spawn`** | 普通 Node 子进程；用 Electron 二进制配合 `ELECTRON_RUN_AS_NODE=1` 运行，或另带一个 Node。 | 没有 MessagePort，只能用 stdio/IPC 管道或回环网络；不出现在 `getAppMetrics`；退出和孤儿进程要自己管理；asar 内只有 `execFile` 能执行二进制（`spawn`/`exec` 不行）。另带 Node 时原生模块要按那个 Node 的 ABI 构建，不是 Electron 的。 |

来源：[utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)、[asar archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives)

## 2. 界面 ↔ 服务通信

### 2a. MessagePort（renderer ↔ utilityProcess 直连）
- 主进程用 `MessageChannelMain` 建一对端口：一端经 `webContents.postMessage(ch, msg, [port])` 交给窗口，另一端经 `child.postMessage` 交给 utilityProcess。之后数据不经过主进程。
- `send`/`invoke` **不能**转移端口，只能用 `postMessage`。`MessagePortMain` 在调用 `.start()` 之前会排队消息；对端关闭或被 GC 时触发 `close`。
- 开启 contextIsolation 时，端口先到达 preload 所在的隔离世界。官方示例用 `window.postMessage(..., '*', ports)` 转到主世界，并校验 `event.source === window`；文档同时更推荐用 contextBridge 只暴露具体方法，而不是把端口挂在 `window` 上。
- **安全面**：只有主进程能发放端口，所以没有网络暴露面，也不需要 token/origin 校验；信任边界就是“哪些 webContents 拿到了端口”。
- **代价**：窗口重载（PRD §8.3）或开新窗口时，必须重新协商端口；浏览器调试模式（PRD §10.1 “可在浏览器中调试同一套界面”）里没有端口，需要另一条传输通道或一层适配。

### 2b. contextBridge + ipcRenderer.invoke（经主进程中转）
- 最常见的做法。官方安全清单要求校验每条 IPC 的 `senderFrame`（按 origin 白名单），因为“所有 web frame 理论上都能发 IPC”。
- 多一跳主进程转发；流式事件（计时 tick、AI token 流）要么在主进程做扇出，要么仍然借助 MessagePort。

### 2c. 回环 HTTP + SSE/WebSocket
- 浏览器调试最方便，将来接 MCP 等外部客户端时边界也最统一（PRD §10.3）。
- **安全约束**（Electron 文档不涉及 localhost，以下为常规做法，PRD §10.2 已经要求）：
  - 只绑定 `127.0.0.1`，不绑定 `0.0.0.0`；端口随机，经主进程告诉界面。
  - **每次启动生成随机 token**：由主进程经 preload 注入，或作为端口信息一起下发；所有请求、**包括 SSE/WS 握手**都要校验。注意 `EventSource` 不能自定义 header，token 只能放 cookie 或 query；放 query 违反 PRD §6.3 的“不在 URL”精神（虽然这不是模型 Key，仍要防日志泄漏）。
  - **校验 `Origin`/`Host`**：拒绝非预期 origin，以挡住普通网页的 CSRF/WS 劫持；校验 `Host` 以防 DNS rebinding。对 WebSocket 尤其要检查，因为浏览器不对 WS 做 CORS。
  - 本机其他进程能连上端口，所以 token 是唯一屏障；token 不能落盘为明文，也不能出现在日志里。
- 官方安全清单要求“外部资源用安全协议”，并推荐用 `protocol.handle` 自定义协议代替 `file://` 加载界面；用自定义协议加载时，Origin 是固定的 `app://…`，便于白名单。

来源：[MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports)、[Security](https://www.electronjs.org/docs/latest/tutorial/security)

## 3. 单实例：`app.requestSingleInstanceLock([additionalData])`
- 返回 `true` 表示当前进程是主实例；`false` 时应立即 `app.quit()`。主实例收到 `second-instance(event, argv, workingDirectory, additionalData)`，并且**保证在 `ready` 之后**才触发，适合用来唤起窗口。
- macOS：从 Finder 打开时系统本身就强制单实例（这种情况发出 `open-file`/`open-url`）；**命令行启动会绕过系统机制**，所以仍然需要这个锁。
- macOS/Linux：argv 加 additionalData 超过 32 MB 的消息会被丢弃，此时返回 `false` 但不触发 `second-instance`。不同用户启动第二实例时 argv 为空。
- **与 PRD §10.1 的差距**：这个锁按“应用”而不是“数据目录”区分，没有数据目录维度。若允许改 `userData` / 多个 profile，或开发版与正式版同时运行，还需要在数据目录里加一个**文件锁**（如 SQLite 独占检查或 lockfile），作为真正的写入互斥。文档没有说明锁和 `setPath('userData')` 的先后关系。**[未核实]**：锁是否按 `userData` 路径做键（Chromium 实现里是 profile 目录的 socket/lock 文件）。

来源：[app API](https://www.electronjs.org/docs/latest/api/app)

## 4. powerMonitor、safeStorage（都只在主进程）

### powerMonitor
- 模块只能在主进程使用。`suspend`/`resume` 文档没有标平台（macOS 从 #24254 起支持）。macOS 另有 `lock-screen`/`unlock-screen`、`user-did-become-active`/`user-did-resign-active`、`shutdown`、`on-ac`/`on-battery`、`thermal-state-change`。方法 `getSystemIdleState(threshold)` 返回 `active`/`idle`/`locked`/`unknown`，另有 `getSystemIdleTime()`。
- **可靠性**：历史上出现过“不触发”（[#13066](https://github.com/electron/electron/issues/13066)）和“重复触发”（[#47162](https://releases.electronjs.org/pr/47162)，已回移到 35/37）。进程被强制终止、断电、合盖时间极短时，`suspend` 可能来不及送达；`resume` 晚到也很常见。这印证了 PRD §8.3 的做法：把事件当提示而不是事实，用**持久化心跳检查点加单调时钟/墙钟差**检测空洞，事件处理要幂等并做去重。
- 事件在主进程。服务放在 utilityProcess 时，主进程要转发给服务；转发中途服务若已暂停，也要依赖检查点。

### safeStorage
- **只在主进程可用。** macOS 的密钥存放在 Keychain，能防同机其他用户和其他应用；访问 Keychain 可能**阻塞调用线程并弹出提示**。**应用必须稳定签名**，否则每次升级都可能重新弹授权。
- 同步 API（`encryptString` 等）**已弃用，计划在 Electron 46 移除**；推荐用异步的 `isAsyncEncryptionAvailable`/`encryptStringAsync`/`decryptStringAsync`（支持密钥轮换，`decryptStringAsync` 返回 `shouldReEncrypt`），它们在 `ready` 后首次调用时懒初始化。
- 不可用时（Linux 的 `basic_text` 后端）等于明文。PRD §6.3 要求此时只允许会话内使用，可以检测 `getSelectedStorageBackend()`。
- 对架构的含义：服务在 utilityProcess 时，加解密要请求主进程代办（经 MessagePort/IPC）；密文可以由服务存在单独的文件里（与业务库分离），明文 Key 只在服务内存中。

来源：[powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor)、[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

## 5. 原生模块（SQLite）在 utilityProcess 中

- Electron 的 ABI 与官方 Node 不同（用的是 BoringSSL），NAN/V8 绑定的模块必须**针对 Electron 重编译**，否则报 `NODE_MODULE_VERSION` 不匹配。每次升级 Electron 都要重建。工具：`@electron/rebuild`（Forge 会自动执行），或设置 `npm_config_runtime=electron` 等环境变量。
- **better-sqlite3**（npm 当前 13.2.0）：同步 API、性能好，对“单写入服务”很合适；属于 V8 绑定，**必须 rebuild**。官方会提供部分 Electron 预编译包，但升级 Electron 时容易出现空窗期。
- **sqlite3**（node-sqlite3 v5+）：用 Node-API，预编译包不绑定 Node 版本；API 是异步回调，性能和人体工程不如前者。
- **`node:sqlite`**（Node 内置，Electron 45 自带 Node 24）：如果 Electron 构建里启用了，就**完全不需要原生模块、rebuild 和 asarUnpack**。**[未核实]**：Electron 是否暴露 `node:sqlite`、是否需要 flag，以及它在 Node 24 的稳定级别。只有二手来源（[RxDB](https://rxdb.info/articles/electron-sqlite.html)）称可用，需要 spike 验证。
- **打包**：`.node` 文件要从 asar 里 **unpack**（`asar --unpack *.node`，electron-builder 用 `asarUnpack`，Forge 用 `AutoUnpackNatives` 插件），放到 `app.asar.unpacked/`。否则 `dlopen` 每次都要解压到临时目录（慢，还会被杀软拦截）。不能把 `cwd` 设为 asar 内的目录（对 `utilityProcess.fork` 的 `cwd` 同样要注意）。传给原生 addon 的 asar 内 fd 会报 `EBADF`。
- macOS 签名/公证：unpacked 的 `.node` 必须一起签名；`allowLoadingUnsignedLibraries` 只用于确有需要的场景。
- **[未核实]**：asar 内的 `utilityProcess.fork(modulePath)` 能否直接用（文档没写；社区普遍可用，需在打包 spike 里确认）。

来源：[Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)、[asar archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives)、[node-sqlite3 README](https://www.npmjs.com/package/sqlite3)

## 6. 取舍速览

| 维度 | 主进程内 | utilityProcess | child_process |
| --- | --- | --- | --- |
| 隔离 / 崩溃恢复 | 无 | 有，Electron 管理 | 有，自行管理 |
| 主进程 API（safeStorage、powerMonitor） | 直接用 | 需代理 | 需代理 |
| 与界面直连 | IPC | MessagePort | 只有网络/管道 |
| 原生模块 ABI | Electron | Electron | 取决于运行时 |
| 浏览器调试 | 需另开 HTTP | 需另开 HTTP | 需另开 HTTP |

| 维度 | MessagePort | IPC 经主进程 | 回环 HTTP + SSE/WS |
| --- | --- | --- | --- |
| 暴露面 | 无 | 无 | 本机所有进程 + 网页 |
| 必需的防护 | 控制端口发放 | senderFrame 校验 | 回环绑定 + token + Origin/Host 校验 |
| 重载 / 多窗口 | 需重新协商 | 自然支持 | 自然支持 |
| 浏览器调试 / 未来 MCP | 不支持 | 不支持 | 支持 |
| 流式 | 原生 | 需扇出 | SSE/WS |
