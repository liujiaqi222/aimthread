import { redirect } from "next/navigation";
import { Database } from "lucide-react";

import { readWebSession } from "@/auth/web-session";
import { SettingsForm } from "@/components/settings-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { settingsService } from "@/services";

// Setup inspects cookies and live database readiness; it has no static form.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const context = await readWebSession();
  if (!context) redirect("/login");

  let settings;
  try {
    await settingsService.checkSchema(context);
    settings = await settingsService.get(context);
  } catch {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-5 py-12">
        <Alert variant="destructive">
          <Database aria-hidden="true" />
          <AlertTitle>数据库结构尚未就绪</AlertTitle>
          <AlertDescription>
            确认 DATABASE_URL 可连接，然后执行 pnpm db:migrate。首次配置
            不会自行修改数据库结构。
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="bg-background min-h-screen px-5 py-12">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3">
          <p className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
            首次配置
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            确认时间设置
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            使用你所在的时区记录投入。之后可以在设置中调整。
          </p>
        </header>
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>时间设置</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingsForm
              mode="setup"
              timezone={settings.timezone}
              weekStartsOn={settings.weekStartsOn}
              suggestBrowserTimezone={!settings.setupCompletedAt}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
