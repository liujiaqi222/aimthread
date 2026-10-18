"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/auth/auth-client";
import { Button } from "@/components/ui/button";

export function SocialLogin({
  callbackURL,
  errorCallbackURL,
  available,
  initialError,
}: {
  callbackURL: string;
  errorCallbackURL: string;
  available: { google: boolean; github: boolean };
  initialError?: string;
}) {
  const lock = useRef(false);
  const [pending, setPending] = useState<"google" | "github">();
  const [error, setError] = useState(initialError);

  useEffect(() => {
    // Browser Back can restore this page from bfcache after leaving a provider.
    function resume() {
      lock.current = false;
      setPending(undefined);
    }
    window.addEventListener("pageshow", resume);
    return () => window.removeEventListener("pageshow", resume);
  }, []);

  async function signIn(provider: "google" | "github") {
    if (lock.current) return;
    lock.current = true;
    setPending(provider);
    setError(undefined);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL,
        errorCallbackURL,
      });
      if (result.error || !result.data?.url) {
        setError("登录暂时未能开始，请重试或选择另一个登录方式。");
        lock.current = false;
        setPending(undefined);
      }
    } catch {
      setError("暂时无法连接，请检查网络后重试。");
      lock.current = false;
      setPending(undefined);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm leading-6 text-red-700">
          {error}
        </p>
      )}
      <div className="grid gap-3">
        {(["google", "github"] as const).map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            className="h-12 w-full"
            disabled={Boolean(pending) || !available[provider]}
            onClick={() => void signIn(provider)}
          >
            {pending === provider ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : provider === "github" ? (
              <span aria-hidden="true" className="font-mono font-semibold">
                GH
              </span>
            ) : (
              <span aria-hidden="true" className="font-semibold">
                G
              </span>
            )}
            {pending === provider
              ? "正在前往登录…"
              : `使用 ${provider === "google" ? "Google" : "GitHub"} 继续`}
          </Button>
        ))}
      </div>
      {(!available.google || !available.github) && (
        <p className="text-muted-foreground text-sm leading-6">
          {!available.google && !available.github
            ? "本站尚未配置 Google / GitHub 登录，请联系站点管理员完成 OAuth 配置。"
            : `${!available.google ? "Google" : "GitHub"} 登录尚未配置，请使用另一个入口。`}
        </p>
      )}
      <p className="text-muted-foreground text-sm leading-6">
        首次登录会自动创建你的个人账户。目标、执行记录与偏好仅属于你。
      </p>
    </div>
  );
}
