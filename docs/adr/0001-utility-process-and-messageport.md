# 本地服务运行在 utilityProcess，正式版经 MessagePort 通信

本地服务（业务规则、SQLite、计时、AI 回合、模型调用）运行在 Electron `utilityProcess` 中，而不是主进程内。这样同步写库和 AI 回合不会卡住窗口，服务崩溃也能被观测并重启。主进程只负责系统集成：窗口、托盘、休眠事件、凭据加解密、文件选择、通知。服务通过「宿主能力」接口使用这些能力，不直接依赖 Electron。正式版中界面与服务经主进程发放的 MessagePort 直连，不开任何回环端口，因此 PRD §10.2 要求的 token / Origin 等防护在正式版不需要。浏览器调试时，服务作为普通 Node 进程运行，使用开发宿主，另开一个仅绑定回环地址、只在开发构建启用的 HTTP 接口。两种传输共用一套消息格式。

决定来源：[本地服务承载、通信与单实例](https://github.com/liujiaqi222/aimthread/issues/52)。

## Considered Options

- **服务放在主进程内**：最简单，但同步 SQLite 与 AI 回合会阻塞主进程事件循环，服务崩溃等于整个应用崩溃。
- **正式版也走回环 HTTP + WebSocket**：只有一种传输，浏览器调试走真实路径；但正式版要承担全套防护（随机 token、Origin/Host 校验、WS 握手保护），且本机其他程序都能看到这个端口。为了一个开发手段扩大正式版的暴露面，不划算。
- **`child_process`**：需要自己管理退出和孤儿进程，也没有 MessagePort，相比 utilityProcess 没有优势。

## Consequences

- safeStorage 与 powerMonitor 只能在主进程调用，服务要经宿主接口请主进程代办。Key 的明文只存在于服务进程内存中。
- 窗口刷新或服务重启后，都要重新发放 MessagePort，界面需要支持自动重连。
- 将来接入 MCP 等外部客户端时，需要另行设计带权限的接入通道，不能直接把开发用的 HTTP 接口开放出去。
