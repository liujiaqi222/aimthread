"use client";

import { Check, Link2, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { authClient } from "@/auth/auth-client";
import { Button } from "@/components/ui/button";

const scopeCopy: Record<string, string> = {
  "aimthread:read": "读取你的目标、任务和执行记录",
  "aimthread:write": "创建和更新目标、任务与执行记录",
  offline_access: "在连接有效期内保持授权，不必每次重新登录",
};

export function OAuthConsentCard({
  clientName,
  scopes,
}: {
  clientName: string;
  scopes: string[];
}) {
  const [pending, setPending] = useState<"accept" | "deny">();
  const [error, setError] = useState<string>();

  async function decide(accept: boolean) {
    setPending(accept ? "accept" : "deny");
    setError(undefined);
    const result = await authClient.oauth2.consent({
      accept,
      ...(accept && scopes.length > 0 ? { scope: scopes.join(" ") } : {}),
    });
    if (result.error) {
      setError("授权没有完成，请回到 ChatGPT 后重试。");
      setPending(undefined);
    }
  }

  return (
    <section className="border-border bg-card w-full max-w-lg rounded-2xl border p-7 shadow-sm sm:p-9">
      <div className="text-muted-foreground flex items-center gap-3">
        <div className="bg-primary text-primary-foreground grid size-11 place-items-center rounded-2xl">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="font-mono text-xs tracking-[0.16em] uppercase">
            AimThread · 安全连接
          </p>
          <p className="mt-1 text-sm">由你决定是否允许这次访问</p>
        </div>
      </div>

      <h1 className="text-foreground mt-8 text-3xl font-semibold tracking-tight">
        连接 {clientName}
      </h1>
      <p className="text-muted-foreground mt-3 leading-7">
        授权后，你可以在 ChatGPT 对话中讨论目标，并在确认后让它写入当前
        AimThread 实例。
      </p>

      <div className="bg-muted mt-7 rounded-2xl p-5">
        <p className="text-foreground flex items-center gap-2 text-sm font-medium">
          <Link2 className="size-4" aria-hidden="true" />
          此连接将能够
        </p>
        <ul className="mt-4 space-y-3">
          {scopes.map((scope) => (
            <li
              key={scope}
              className="text-muted-foreground flex items-start gap-2 text-sm"
            >
              <Check
                className="mt-0.5 size-4 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              <span>{scopeCopy[scope] ?? scope}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-muted-foreground mt-5 text-sm leading-6">
        ChatGPT
        不会获得你的实例密码。你可以稍后在设置中撤销连接；写入操作仍会在对话中由你确认。
      </p>

      {error && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {error}
        </p>
      )}

      <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={Boolean(pending)}
          onClick={() => void decide(false)}
        >
          {pending === "deny" ? "正在取消…" : "取消"}
        </Button>
        <Button
          type="button"
          disabled={Boolean(pending)}
          onClick={() => void decide(true)}
        >
          {pending === "accept" ? "正在连接…" : "允许连接"}
        </Button>
      </div>
    </section>
  );
}
