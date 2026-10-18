# Issue #39：用户身份与业务数据隔离

对应 [Issue #39](https://github.com/liujiaqi222/aimthread/issues/39)，属于 #38 的第一步。Google / GitHub 注册、登录和真实提供商验收由后续子 Issue 完成。当前关闭旧密码 API 和固定 owner 初始化，不增加任何生产测试登录入口。

## 身份与服务

Web 从 Better Auth 的有效登录会话取得 `{ userId, actor: "web" }`，页面、Server Action 和 Route Handler 都传播该身份。MCP 在现有签名、issuer、resource、期限和 scope 校验后，从 `sub` 查找真实 User，并为本次请求创建服务上下文。空主体或不存在的 User 返回 401；服务端没有共享默认用户。客户端提供的所有者字段不参与身份解析，严格输入契约会拒绝额外字段。

Goal、Session、设置和幂等记录直接引用 User。Task 沿 Goal、阶段/Focus Interval/Distraction 沿 Session 取得归属。`ownedBy` 显式用于查询和更新条件，原始 SQL 同样包含用户条件。内部计时阶段模块只接收已校验归属的 Session/阶段，操作沿该 Session 限定，没有独立的 Web/MCP 入口。Session/Goal/User、设置/Goal/User、Session/Task/Goal、Focus Interval/阶段/Session 与下一阶段/Session 复合外键防止跨用户或跨 Session 拼接。

每用户最多一个 active/paused Session，由部分唯一索引保证。锁以 `[userId, scope]` 编码，快速 SQL 与事务路径使用相同编码；幂等主键是 `(userId, operation, key)`。排序、重叠、选择推进、统计、Footprint 和执行报告均按用户限定。计时快速通路保留单条 SQL 的写入方式。

引导草稿与到时提示缓存使用 origin + User ID 命名空间。AppShell 按用户重新挂载，退出成功后执行完整页面跳转，清除当前用户引导草稿并丢弃旧 Router/React 状态。

## 建库与本地样例

运行 `pnpm db:migrate` 可从空数据库初始化完整 schema。`0005_user_ownership` 发现旧用户、设置或业务数据会抛出错误并回滚，不清理、回填或认领旧 owner。切换已有部署时需另行准备新数据库。本票不对开发或正式数据库执行迁移与清理。

`pnpm db:seed --user-id=<existing-user-id>` 仅对本地数据库中的指定 User 追加样例，默认已有 Goal 时跳过；没有默认 User 或自动建号。

## 验收边界

- `tests/e2e/user-isolation.spec.ts`：两个真实 User、持久化 Better Auth Session 和签名 MCP token，通过现有 Web/MCP 入口和同用户独立设备会话验证业务隔离、已知 ID 攻击、跨用户拼接、设置、选择、笔记/资源/Resume Hint/Distraction、并发、幂等、补录与纠错、统计、Footprint、退出换号与草稿。
- `tests/integration/database.test.ts`：空库可重复初始化、数据库复合外键与每用户 Session 唯一性，及现有计时/规划/足迹回归。
- 每个浏览器用例使用独立 User，同一用例的 Web/MCP 共享身份。测试身份初始化只存在测试进程，检查隔离数据库边界；应用自身认证、共享领域服务和数据库不被 mock。MCP 测试 token 使用授权服务的真实测试签名密钥，主体对应真实 User。
- 隔离 runner 新建随机测试 schema，结束后仅清理本轮 schema。真实 Google/GitHub 回调、正式部署和 ChatGPT 客户端授权不在本票已验证范围。

## 本轮自动化结果（2026-10-18）

- 单元测试：156 通过。
- 原有数据库集成回归：61 通过；新增用户归属约束：3 通过。
- 新增两用户 Playwright 验收：3 通过，包含同用户独立设备会话。完整浏览器运行 20 项通过；修正侧栏测试夹具的页面就绪等待后，侧栏与首页定向重跑 4 项通过，覆盖全部 21 项用例。
- `pnpm typecheck`、ESLint、变更文件 Prettier 检查通过；Drizzle schema 与提交的 snapshot 一致。
- 全库 `pnpm lint` 中，范围外 `a.html` 与已有 `drizzle/meta/0004_snapshot.json` 仍有格式提示，未修改这些文件。
- 未执行开发/正式库迁移、数据库清理或部署；未进行真实社交提供商登录与 ChatGPT 客户端授权验收。
