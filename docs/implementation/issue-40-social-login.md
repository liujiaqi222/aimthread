# Issue #40：Google / GitHub 注册登录

对应 [Issue #40](https://github.com/liujiaqi222/aimthread/issues/40)，依赖已合入的 #39 用户隔离。参考 Transcriptly Web，但配置和测试基于本项目 Better Auth 1.7.6。

## 账户与登录

只启用 Google / GitHub；缺少某个提供商的完整凭证时禁用对应按钮并提供配置提示，不回退到密码或共享身份。首次成功回调自动创建 User，设置仍由按 User 的幂等初始化建立；普通登录先检查个人设置，再进入站内目的地。返回用户通过稳定的 `(providerId, accountId)` 找到原 User，不覆盖已编辑的名称、不重播已完成的引导。

邮箱不区分大小写；自动关联明确要求已有 User 的邮箱与新身份邮箱均已验证。`trustedProviders` 为空，`requireLocalEmailVerified=true`，不启用不同邮箱关联。相同邮箱且任一未验证时拒绝关联，不返回已有账户信息；可重试原身份。已有独立 User 不合并。主动绑定、解绑 API 被关闭。

迁移 `0005_social_login_identity` 为 `(provider_id, account_id)` 添加唯一索引。Better Auth Drizzle adapter 启用事务，创建 User 与身份原子提交；并发冲突可以重试，不留下重复身份或孤立 User。并发回调中允许一个请求得到可恢复错误，不保证所有竞争请求都成功。

访问与刷新令牌由框架使用 `BETTER_AUTH_SECRET` 加密；ID token 在完成提供商验证后，由创建/更新 account 的数据库 hook 丢弃。框架日志只保留失败级别，不输出提供商原始响应、回调参数或令牌；Next 开发请求日志也排除认证回调、登录和授权页 URL。提供商名称去控制字符、截断到 40 字符并提供空值默认名；用户主动编辑仍执行严格校验。

## 回跳与 AI 授权

普通 `next` 仅接受已有站内产品页面，拒绝站外地址、反斜线、控制字符、未知路由及认证 API。登录发起后禁用两个按钮，取消、拒绝或网络错误可重试。回调错误只显示固定说明，不渲染外部错误文本。

从 OAuth 授权服务器发起的请求保留其签名参数集合，登录页验证签名及期限，Better Auth OAuth provider 的 state/server context 在社交回调后恢复原授权请求。首次用户也先返回同意页面，由用户明确授权；登录本身不会创建 MCP 授权。签名无效或过期时提示回到 ChatGPT 重新连接，不能降级为普通回跳来授权。

## 配置

本地使用 `http://localhost:3000`，正式使用 `https://aimthread.com`。Google 为 Web application 客户端，GitHub 为 OAuth App；两个环境分别配置对应凭证。回调地址、变量清单和 Vercel 配置见 [README](../../README.md#local-development) 与 [环境变量模板](../../.env.example)。本轮不支持任意 Vercel Preview URL 的真实登录。

`.env.local` 保留现有 `DATABASE_URL`、`BETTER_AUTH_SECRET`、`NEXT_PUBLIC_APP_NAME`，将本地 origin 明确为 `http://localhost:3000`，添加四个 OAuth 空值供用户填写。移除旧 TIMEOS 密码/静态 Token/Session Secret、重复的 PG/POSTGRES/非池化连接变量、Neon project ID、NX/Turbo 缓存和 Vercel 导出的构建/身份元数据；当前代码均未消费这些值。标准隔离测试从 `DATABASE_URL` 新建随机 schema，无需另配 `TEST_DATABASE_URL`。密钥文件不提交。

## 验证边界

- 单元测试覆盖防重复提交、网络重试、配置缺失、名称初始化及安全回跳。
- `tests/integration/social-login.test.ts` 通过同一份生产认证工厂与真实数据库，覆盖 Google/GitHub 首登与返回、邮箱验证矩阵、身份优先于邮箱、并发与重放、令牌加密与 ID token 丢弃、错误恢复及关闭的密码/绑定接口。
- `tests/e2e/social-login.spec.ts` 通过真实登录页、认证回调、设置、引导、退出换号，以及授权服务器 → 社交登录 → 明确同意 → 换取 MCP token → 实际写入 Goal 验证完整应用链路；第三方网络由隔离测试进程替代，不证明 Google/GitHub 的真实站外回调成功。
- `tests/e2e/user-isolation.spec.ts` 继续覆盖两个独立 User 的 Web/MCP 隔离。没有新增生产测试登录入口。
- 提供商网络替身只在测试 preload 中安装，要求随机隔离 schema 或受保护的本地测试库。Playwright 使用专用测试凭证及端口 3010；这些不是用户需要登记的 OAuth 回调。

## 实际验收状态

2026-10-18 已验证：

- 153 项单元测试通过；类型检查、ESLint、变更文件格式检查与生产构建通过。
- 社交认证专项集成 10 项通过，包括未验证邮箱矩阵、稳定身份、并发/重放、加密与错误恢复。随后全量数据库集成 73 项通过（63 项原有回归 + 10 项社交认证回归）。
- 基础浏览器回归 3 项、两用户 Web/MCP 隔离回归 3 项，以及社交登录专项 3 项均通过。专项证明原授权上下文经过社交登录后仍保留，明确同意后能够换取 token 并通过真实 MCP 入口创建 Goal。
- 浏览器验证发现登录完成路由从 Request URL 推断主机时，可能把 `127.0.0.1` 改为 `localhost` 并丢失 Cookie；已使用配置的 `BETTER_AUTH_URL` 构造回跳，修正后通过。
- 开发数据库已执行并核对 `0005` 迁移，无数据清理；未部署应用。
- 本地真实 GitHub：凭证已配置，已在浏览器到达 GitHub 的 AimThread 登录页；尚未由用户完成 GitHub 登录和回调，因此不计为验收通过。
- 本地真实 Google：用户完成提供商授权并成功返回 AimThread，已进入受保护的 `/history`。数据库确认 1 个 Google User、邮箱已验证、ID token 未保留、独立设置与首次配置完成状态已建立。正式站点 Google/GitHub 回调、真实 ChatGPT 客户端均未验收；自动化第三方网络替身不代替这些结果。


## Vercel 配置与交付

项目为 `zoecole/time-os`，正式域名为 `https://aimthread.com`。2026-10-18 按用户确认，将本地同一组 Google/GitHub 凭证写入 Production 的四项 OAuth 环境变量，全部标为 sensitive；正式 `BETTER_AUTH_URL` 为 `https://aimthread.com`。提供商端是否接受正式回调仍需上线后实际验证，本轮不据此宣称正式登录已成功。

核对发现 Production 与本地共用数据库，但 `BETTER_AUTH_SECRET` 不同，当前 Google 访问令牌仅可用本地密钥解密。已将 Production 与 Preview 的认证密钥对齐至本地现用值；没有清空用户、令牌或签名密钥。此时数据库中尚无 JWKS。新部署使用一致密钥，旧部署仍使用原变量；旧正式站点 Cookie 在新密钥部署后失效。Preview 不配置社交凭证，不支持随机 Preview URL 的真实登录。

环境变量在下一次部署生效；本次 PR 提交与 Preview 构建不表示已经合并或发布正式站点。`.env.local` 和临时凭证文件均不提交。原有未跟踪的 `a.html` 保持原样。
