import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth/auth";
import { verifySignedOAuthQuery } from "@/auth/oauth-query";
import { safeReturnPath } from "@/auth/secrets";
import { readWebSession } from "@/auth/web-session";
import { SocialLogin } from "@/components/social-login";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeReturnPath(
    typeof query.next === "string" ? query.next : undefined,
  );
  const params = new URLSearchParams();
  // The OAuth provider signs an explicit parameter set. Ignore UI-only error/next
  // fields when verifying a retried authorization request.
  const signedNames = new Set(
    Array.isArray(query.ba_param) ? query.ba_param : [query.ba_param],
  );
  for (const [key, value] of Object.entries(query)) {
    if (key !== "sig" && key !== "ba_param" && !signedNames.has(key)) continue;
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value])
      params.append(key, item);
  }
  const oauthQuery = params.toString();
  const hasOAuth = query.sig !== undefined || query.client_id !== undefined;
  const validOAuth =
    hasOAuth &&
    (await verifySignedOAuthQuery(oauthQuery, (await auth.$context).secret));
  const invalidOAuth = hasOAuth && !validOAuth;
  const callbackURL = validOAuth
    ? `/oauth/consent?${oauthQuery}`
    : `/auth/complete?${new URLSearchParams({ next })}`;
  if (!invalidOAuth && (await readWebSession())) redirect(callbackURL);
  const errorQuery = validOAuth
    ? oauthQuery
    : new URLSearchParams({ next }).toString();
  const initialError =
    query.error === undefined
      ? undefined
      : query.error === "access_denied"
        ? "登录已取消或未获授权。你可以重试，或选择另一个登录方式。"
        : "登录没有完成。请重试或选择另一个登录方式；从 ChatGPT 发起的连接也可以回到 ChatGPT 重新开始。";
  return (
    <main className="bg-background grid min-h-screen place-items-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 space-y-2">
          <p className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
            执行系统
          </p>
          <h1 className="text-foreground text-4xl font-semibold tracking-tight">
            AimThread
          </h1>
          <p className="text-muted-foreground">
            记住下一步，也记住你真正投入的时间。
          </p>
        </div>
        <Card className="border-border bg-card shadow-sm">
          <CardHeader>
            <CardTitle>
              {validOAuth ? "登录后继续连接 ChatGPT" : "登录或创建账户"}
            </CardTitle>
            <p className="text-muted-foreground text-sm leading-6">
              {validOAuth
                ? "登录后将返回授权页面，由你确认是否允许 ChatGPT 访问。"
                : "每次回来，接着往前。"}
            </p>
          </CardHeader>
          <CardContent>
            {invalidOAuth ? (
              <p role="alert" className="text-destructive text-sm leading-6">
                这次授权请求已失效或被修改，请回到 ChatGPT 重新连接。
              </p>
            ) : (
              <SocialLogin
                callbackURL={callbackURL}
                errorCallbackURL={`/login?${errorQuery}`}
                available={{
                  google: Boolean(
                    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
                  ),
                  github: Boolean(
                    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
                  ),
                }}
                initialError={initialError}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
