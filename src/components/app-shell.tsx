import {
  SessionLink as Link,
  SessionNavigationProvider,
} from "@/components/session-navigation";
import Image from "next/image";
import { Settings } from "lucide-react";

import { LogoutButton } from "@/components/logout-button";
import { PrimaryNav } from "@/components/primary-nav";
import { Button } from "@/components/ui/button";

export function AppShell({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  return (
    <SessionNavigationProvider>
      <div className="min-h-screen bg-[#f5f4f0] text-stone-950">
        <div className="sticky top-0 z-30">
          <header className="border-b border-stone-200 bg-[#f5f4f0]/95 backdrop-blur-sm">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-5 px-5">
              <Link
                href="/today"
                className="flex items-center gap-2 font-semibold tracking-[-0.025em]"
              >
                <Image src="/icon.svg" alt="" width={28} height={28} priority />
                <span>AimThread</span>
              </Link>
              <PrimaryNav variant="desktop" />
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="设置"
                  nativeButton={false}
                  render={<Link href="/settings" />}
                >
                  <Settings aria-hidden="true" />
                </Button>
                <LogoutButton userId={userId} />
              </div>
            </div>
          </header>
        </div>
        <PrimaryNav variant="mobile" />
        <main className="mx-auto w-full max-w-6xl px-4 pt-7 pb-28 sm:px-6 sm:py-10">
          {children}
        </main>
      </div>
    </SessionNavigationProvider>
  );
}
