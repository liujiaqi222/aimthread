# AimThread

AimThread ([aimthread.com](https://aimthread.com)) 是一个 AI-native 的目标执行与时间管理工具。它记住目标的下一步，并记录你真正投入的时间；你也可以在 ChatGPT 网页端讨论计划，并通过 Plugin 写回个人账户。

> **AI is the planner. AimThread is the execution system.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fliujiaqi222%2Faimthread&project-name=aimthread&repository-name=aimthread&integration-ids=oac_3sK3gnG06emjIEVL09jjntDD&env=BETTER_AUTH_SECRET%2CNEXT_PUBLIC_APP_NAME&envDefaults=%7B%22NEXT_PUBLIC_APP_NAME%22%3A%22AimThread%22%7D&envDescription=Set%20one%20unique%20random%20authentication%20secret.%20Neon%20provides%20DATABASE_URL%20automatically.)

一键部署会克隆仓库、创建并连接 Neon、收集认证 Secret，并在构建阶段自动执行 committed Drizzle migrations。当前分支已建立独立 User 的数据隔离，旧实例密码入口已关闭。Google / GitHub 注册和登录由后续子 Issue 交付；本阶段不适合直接部署为可公开注册的产品。已有有效会话可继续访问。

## Local development

要求 Node.js 20+、pnpm，以及 PostgreSQL。复制环境变量模板并填写本地值：

```bash
cp .env.example .env.local
pnpm install
pnpm db:migrate
# 可选：给本地数据库中指定的现有 User 写入示例
pnpm db:seed --user-id=YOUR_USER_ID
pnpm dev
```

`pnpm db:migrate` 使用已提交的 Drizzle migrations 建库；`pnpm db:seed` 仅允许连接 localhost/127.0.0.1，必须显式传入已存在 User 的 ID，并在该用户已有目标时默认跳过。v0.3 使用全新的 Goal → Task/Session 数据结构，不会自动转换旧版 Track 数据；用户归属迁移 `0005_user_ownership` 要求空数据库，发现旧用户或业务数据会拒绝执行，不回填，也不使用默认用户。

项目尚未上线，旧测试数据无需保留，可以清空现有开发库后运行 `pnpm db:migrate`，无需另建数据库。若重建全部应用表，也需同时清空 Drizzle 迁移记录，让初始化从第一条迁移开始。清空会移除旧用户、业务数据、登录会话、签名密钥和 AI 授权；普通 `db:migrate` 不会自动执行清理。

环境变量：

- `DATABASE_URL`：Neon 或兼容 PostgreSQL 连接串；
- `BETTER_AUTH_SECRET`：Web Session 与 OAuth 令牌使用的服务端 Secret，至少 32 个字符；
- `BETTER_AUTH_URL`：实例公开 origin；生产必须是 HTTPS（例如 `https://aimthread.com`）。Vercel Preview 自动使用稳定的分支 URL，Production 自动使用项目生产 URL；自定义域名时应显式填写；
- `NEXT_PUBLIC_APP_NAME`：公开应用名称，默认 `AimThread`。

ChatGPT 开发者测试时，在 Plugins 的 Add 菜单中选择 **Create MCP App**，再使用 OAuth 2.1 连接 `/mcp`。用户在 AimThread 登录并确认读写权限后，ChatGPT 才会获得限时 access token；网页不展示、复制或保存静态 MCP Token。

## Verification

```bash
pnpm test:unit
pnpm test:db:up
pnpm test:integration
pnpm test:e2e
pnpm lint
pnpm typecheck
```

`test:integration` / `test:e2e` 通过现有连接新建随机隔离 schema，迁移与测试后只删除本轮 schema；不清理开发或正式业务表。直接运行测试框架仅允许受保护的本地 `_test` 数据库或隔离 schema。测试 User、签名登录 Cookie 和 MCP token 只由测试进程初始化，没有生产登录后门。

用户隔离实现与验收说明见 [docs/implementation/issue-39-user-isolation.md](docs/implementation/issue-39-user-isolation.md)。

详细产品规格见 [docs/prd.md](docs/prd.md)，MVP tickets 见 [docs/tickets/README.md](docs/tickets/README.md)。
