# Issue #39：用户身份与业务数据隔离

对应 [Issue #39](https://github.com/liujiaqi222/aimthread/issues/39)，属于 #38 的第一步。Google / GitHub 注册、登录和真实提供商验收由后续子 Issue 完成。当前关闭旧密码 API 和固定 owner 初始化，不增加任何生产测试登录入口。

## 身份与服务

Web 从 Better Auth 的有效登录会话取得 `{ userId, actor: "web" }`，页面、Server Action 和 Route Handler 都传播该身份。MCP 在现有签名、issuer、resource、期限和 scope 校验后，从 `sub` 查找真实 User，并为本次请求创建服务上下文。空主体或不存在的 User 返回 401；服务端没有共享默认用户。客户端提供的所有者字段不参与身份解析，严格输入契约会拒绝额外字段。

Goal、Session、设置和幂等记录直接引用 User。Task 沿 Goal、阶段/Focus Interval/Distraction 沿 Session 取得归属。`ownedBy` 显式用于查询和更新条件，原始 SQL 同样包含用户条件。内部计时阶段模块只接收已校验归属的 Session/阶段，操作沿该 Session 限定，没有独立的 Web/MCP 入口。Session/Goal/User、设置/Goal/User、Session/Task/Goal、Focus Interval/阶段/Session 与下一阶段/Session 复合外键防止跨用户或跨 Session 拼接。

每用户最多一个 active/paused Session，由部分唯一索引保证。锁以 `[userId, scope]` 编码，快速 SQL 与事务路径使用相同编码；幂等主键是 `(userId, operation, key)`。排序、重叠、选择推进、统计、Footprint 和执行报告均按用户限定。计时快速通路保留单条 SQL 的写入方式。

引导草稿与到时提示缓存使用 origin + User ID 命名空间。AppShell 按用户重新挂载，退出成功后执行完整页面跳转，清除当前用户引导草稿并丢弃旧 Router/React 状态。

## 建库与本地样例

运行 `pnpm db:migrate` 可从空数据库初始化完整 schema。`0004_user_ownership` 发现旧用户、设置或业务数据会抛出错误并回滚，不回填或认领旧 owner，普通迁移也不会自动删除数据。

项目尚未上线，用户已明确允许清空现有开发库中的测试数据，因此可在原数据库内重建，无需另行准备新库。重建全部应用表时同步清空 Drizzle 迁移记录，再从第一条迁移初始化。旧用户、业务数据、登录会话、签名密钥和 AI 授权均会失效。

`pnpm db:seed --user-id=<existing-user-id>` 仅对本地数据库中的指定 User 追加样例，默认已有 Goal 时跳过；没有默认 User 或自动建号。

## 验收边界

- `tests/e2e/user-isolation.spec.ts`：两个真实 User、持久化 Better Auth Session 和签名 MCP token，通过现有 Web/MCP 入口和同用户独立设备会话验证业务隔离、已知 ID 攻击、跨用户拼接、设置、选择、笔记/资源/Resume Hint/Distraction、并发、幂等、补录与纠错、统计、Footprint、退出换号与草稿。
- `tests/integration/database.test.ts`：空库可重复初始化、数据库复合外键与每用户 Session 唯一性，及现有计时/规划/足迹回归。
- 每个浏览器用例使用独立 User，同一用例的 Web/MCP 共享身份。测试身份初始化只存在测试进程，检查隔离数据库边界；应用自身认证、共享领域服务和数据库不被 mock。MCP 测试 token 使用授权服务的真实测试签名密钥，主体对应真实 User。
- 隔离 runner 新建随机测试 schema，结束后仅清理本轮 schema。真实 Google/GitHub 回调、正式部署和 ChatGPT 客户端授权不在本票已验证范围。

## 合入基线

本实现基于已合入 UI #37 和规格 #42 的 `main`，直接向 `main` 提交。保留该分支的页面与交互；不引入旧分支独有的侧栏或报告界面；保留 #39 所需的 MCP 执行报告服务与其隔离验证。报告基于 `main` 当前的预估字段，不引入旧分支的首次预估功能。用户归属迁移从 `main` 的 `0003` 接续为 `0004_user_ownership`，不依赖旧分支的任务预估迁移。

## 本轮验证结果（2026-10-18）

- 单元测试：149 项通过；`pnpm typecheck` 通过。
- `.env.local` 所连的 Neon 开发库已与 `main` 的迁移链对齐，`0000` 到 `0004` 的全部 5 条迁移执行及重复运行通过。核对 20 张表、227 个字段与非空约束、30 个外键、snapshot 索引及迁移 hash 一致；用户与业务数据为空，仅保留初始化的 1 条本地 MCP resource。
- 浏览器首次运行发现旧 UI 定位不匹配、计时圆盘遮挡开始按钮；已适配当前文案，并将计时容器改为最小高度，让圆盘自然撑开。浏览器回归与隔离数据库回归正在验证。
- 保留未上线阶段的开发库清空授权；未执行应用部署，也未验收真实 Google/GitHub 回调和 ChatGPT 客户端授权。
