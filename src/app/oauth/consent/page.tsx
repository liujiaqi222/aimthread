import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/auth/auth";
import { verifySignedOAuthQuery } from "@/auth/oauth-query";
import { OAuthConsentCard } from "@/components/oauth-consent-card";

export const metadata: Metadata = { title: "授权 ChatGPT" };

type Query = Record<string, string | string[] | undefined>;

function serializeQuery(query: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value !== undefined) {
      params.append(key, value);
    }
  }
  return params.toString();
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const query = await searchParams;
  const oauthQuery = serializeQuery(query);
  const { secret } = await auth.$context;
  const valid = await verifySignedOAuthQuery(oauthQuery, secret);

  if (!valid) {
    return (
      <ConsentError message="这次授权请求已失效或被修改，请回到 ChatGPT 重新连接。" />
    );
  }

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect(`/login?${oauthQuery}`);

  const params = new URLSearchParams(oauthQuery);
  const clientId = params.get("client_id");
  if (!clientId) {
    return (
      <ConsentError message="授权请求缺少客户端身份，请回到 ChatGPT 重新连接。" />
    );
  }

  let client: Awaited<ReturnType<typeof auth.api.getOAuthClientPublic>>;
  try {
    client = await auth.api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers: requestHeaders,
    });
  } catch {
    return (
      <ConsentError message="无法确认 ChatGPT 客户端身份，请稍后重新连接。" />
    );
  }

  const scopes = (params.get("scope") ?? "")
    .split(" ")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return (
    <main className="bg-background grid min-h-screen place-items-center px-5 py-12">
      <OAuthConsentCard
        clientName={client.client_name ?? "ChatGPT"}
        scopes={scopes}
      />
    </main>
  );
}

function ConsentError({ message }: { message: string }) {
  return (
    <main className="bg-background grid min-h-screen place-items-center px-5 py-12">
      <div className="border-border bg-card w-full max-w-md rounded-xl border p-8 shadow-sm">
        <p className="text-muted-foreground font-mono text-xs tracking-[0.18em] uppercase">
          AimThread · OAuth
        </p>
        <h1 className="text-foreground mt-3 text-2xl font-semibold">
          无法继续授权
        </h1>
        <p className="text-muted-foreground mt-3 leading-7">{message}</p>
      </div>
    </main>
  );
}
