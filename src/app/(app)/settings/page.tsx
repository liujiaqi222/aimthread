import { headers } from "next/headers";
import { SettingsTimerPreferences } from "@/components/settings-timer-preferences";
import { SettingsForm } from "@/components/settings-form";
import { ProfileForm } from "@/components/profile-form";
import { redirect } from "next/navigation";
import { disconnectChatGptAction } from "@/app/settings/actions";
import { auth, MCP_RESOURCE } from "@/auth/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { settingsService } from "@/services";
import { timerModeLabel } from "@/shared/labels";
import Link from "next/link";

export default async function SettingsPage() {
  const requestHeaders = await headers();
  const [settings, consents, session] = await Promise.all([
    settingsService.get({ actor: "web" }),
    auth.api.getOAuthConsents({ headers: requestHeaders }),
    auth.api.getSession({ headers: requestHeaders }),
  ]);
  if (!session) redirect("/login?next=/settings");
  const chatGptConsents = consents.filter((consent) => {
    try {
      return new URL(consent.clientId).hostname === "chatgpt.com";
    } catch {
      return false;
    }
  });
  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-2">
        <p className="text-muted-foreground font-mono text-xs tracking-[0.18em] uppercase">
          实例
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">设置</h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>个人信息</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm name={session.user.name} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>时间偏好</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm
            mode="settings"
            timezone={settings.timezone}
            weekStartsOn={settings.weekStartsOn}
          />
          <p className="text-muted-foreground mt-4 text-xs">
            当前计时偏好：{timerModeLabel[settings.timerMode]}。
          </p>
          <div className="mt-3">
            <SettingsTimerPreferences value={settings.timerPreferences} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>目标与任务</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>完整的目标与任务管理入口。</p>
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href="/goals" />}
          >
            打开目标管理
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>ChatGPT 连接</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-4 text-sm">
          <p>
            在 ChatGPT 网页端的 Plugins 中添加这个 MCP 地址。连接时会回到
            AimThread 登录并显示授权确认；无需复制 API Token。
          </p>
          <code className="bg-muted text-foreground block overflow-x-auto rounded-lg px-3 py-2 text-xs">
            {MCP_RESOURCE}
          </code>
          {chatGptConsents.length === 0 ? (
            <p className="text-muted-foreground">
              当前没有已授权的 ChatGPT 连接。
            </p>
          ) : (
            <div className="space-y-2">
              {chatGptConsents.map((consent) => (
                <div
                  key={consent.id}
                  className="border-border bg-muted flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                >
                  <div>
                    <p className="text-foreground font-medium">ChatGPT</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      已授权读取与写入 AimThread
                    </p>
                  </div>
                  <form
                    action={disconnectChatGptAction.bind(
                      null,
                      consent.id,
                      consent.clientId,
                    )}
                  >
                    <Button type="submit" variant="outline" size="sm">
                      撤销连接
                    </Button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
