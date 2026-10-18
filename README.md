# AimThread

AimThread ([aimthread.com](https://aimthread.com)) 是一个 AI-native 的目标执行与时间管理工具。它记住目标的下一步，并记录你真正投入的时间；你也可以在 ChatGPT 网页端讨论计划，并通过 Plugin 写回个人账户。

> **AI is the planner. AimThread is the execution system.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fliujiaqi222%2Faimthread&project-name=aimthread&repository-name=aimthread&integration-ids=oac_3sK3gnG06emjIEVL09jjntDD&env=BETTER_AUTH_SECRET%2CNEXT_PUBLIC_APP_NAME&envDefaults=%7B%22NEXT_PUBLIC_APP_NAME%22%3A%22AimThread%22%7D&envDescription=Set%20one%20unique%20random%20authentication%20secret.%20Neon%20provides%20DATABASE_URL%20automatically.)

一键部署会克隆仓库、创建并连接 Neon、收集认证 Secret，并在构建阶段自动执行 committed Drizzle migrations。公开使用前，须在 Vercel Production 配置下列 Google / GitHub OAuth 凭证与 `BETTER_AUTH_URL=https://aimthread.com`，完成提供商回调登记后重新部署。首次社交登录自动建立个人账户；目标、执行记录、偏好和 AI 授权按 User 隔离。

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

`pnpm db:migrate` 使用已提交的 Drizzle migrations 建库；`pnpm db:seed` 仅允许连接 localhost/127.0.0.1，必须显式传入已存在 User 的 ID，并在该用户已有目标时默认跳过。v0.3 使用全新的 Goal → Task/Session 数据结构，不会自动转换旧版 Track 数据；用户归属迁移 `0004_user_ownership` 要求空数据库，发现旧用户或业务数据会拒绝执行，不回填，也不使用默认用户。

项目尚未上线，旧测试数据无需保留，可以清空现有开发库后运行 `pnpm db:migrate`，无需另建数据库。若重建全部应用表，也需同时清空 Drizzle 迁移记录，让初始化从第一条迁移开始。清空会移除旧用户、业务数据、登录会话、签名密钥和 AI 授权；普通 `db:migrate` 不会自动执行清理。

环境变量：

- `DATABASE_URL`：Neon 或兼容 PostgreSQL 连接串；
- `BETTER_AUTH_SECRET`：Web Session 与 OAuth 令牌使用的服务端 Secret，至少 32 个字符；
- `BETTER_AUTH_URL`：本地显式填写 `http://localhost:3000`，Production 填写 `https://aimthread.com`，不包含 `/api/auth`；
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：Google Web OAuth 客户端凭证；
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`：GitHub OAuth App 凭证；
- `NEXT_PUBLIC_APP_NAME`：公开应用名称，默认 `AimThread`。

OAuth 配置与回调：

| 环境 | Google Authorized redirect URI | GitHub Authorization callback URL |
| --- | --- | --- |
| 本地 | `http://localhost:3000/api/auth/callback/google` | `http://localhost:3000/api/auth/callback/github` |
| Production | `https://aimthread.com/api/auth/callback/google` | `https://aimthread.com/api/auth/callback/github` |

Google 创建 Web application 类型的 OAuth 客户端，配置对应站点 origin 与上表回调；测试模式需将验收账号加入测试用户。GitHub 为本地、正式分别创建 OAuth App（各自一个 callback URL），Homepage URL 填对应站点。服务器使用 GitHub 的 `read:user`、`user:email` 权限读取身份及邮箱验证状态；Google 使用 `openid`、`email`、`profile`。不支持为每个 Vercel Preview 地址登记真实登录。

四个 OAuth 值只放本地 `.env.local` 或 Vercel 服务端环境变量，不能加 `NEXT_PUBLIC_`。未配置的入口会禁用并提示配置缺失，没有密码或共享用户回退。两个邮箱均已验证时，相同邮箱的 Google/GitHub 身份才自动进入同一 User；任一未验证则拒绝关联，用户可改用原登录方式。不同邮箱为独立账户，本轮不提供手动绑定、解绑或合并。访问/刷新令牌由 Better Auth 加密保存，ID token 验证完成后丢弃；`BETTER_AUTH_SECRET` 应在同一数据库的部署间保持一致。

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

用户隔离实现与验收说明见 [docs/implementation/issue-39-user-isolation.md](docs/implementation/issue-39-user-isolation.md)。社交登录实现和真实验收状态见 [docs/implementation/issue-40-social-login.md](docs/implementation/issue-40-social-login.md)。

详细产品规格见 [docs/prd.md](docs/prd.md)，MVP tickets 见 [docs/tickets/README.md](docs/tickets/README.md)。
