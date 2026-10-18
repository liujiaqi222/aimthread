import type { Metadata } from "next";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
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
        <Card className="border-input bg-card/90 shadow-sm">
          <CardHeader>
            <CardTitle>账户登录升级中</CardTitle>
            <p className="text-muted-foreground text-sm leading-6">
              Google / GitHub 登录即将开放。已有登录会话可继续使用。
            </p>
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}
