"use client";

import { useState, useSyncExternalStore } from "react";
import { Menu, X, Orbit, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  SessionLink as Link,
  SessionNavigationProvider,
} from "@/components/session-navigation";
import { PrimaryNav } from "@/components/primary-nav";
import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/focus/modal";

// Follow the rendered execution scene, including recovery after refresh.
function subscribeToScene(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}
function isFocusScene() {
  return Boolean(document.querySelector(".focus-scene"));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState(false);
  const focusScene = useSyncExternalStore(
    subscribeToScene,
    isFocusScene,
    () => false,
  );
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(
    null,
  );
  const collapsed = sidebarPreference ?? focusScene;
  return (
    <SessionNavigationProvider>
      <div
        className="app-shell bg-background text-foreground min-h-dvh"
        data-sidebar-collapsed={collapsed}
      >
        <aside
          id="desktop-sidebar"
          aria-label="侧边栏"
          className="app-sidebar border-border bg-sidebar fixed inset-y-0 left-0 z-30 hidden w-[216px] flex-col border-r px-4 py-7 md:flex"
        >
          <div className="sidebar-header mb-12 flex min-h-10 items-center justify-between gap-1">
            <Link
              href="/today"
              aria-label="AimThread 首页"
              className="sidebar-brand flex min-h-10 min-w-0 items-center gap-2 px-1 font-semibold tracking-tight"
            >
              <Orbit
                className="text-primary size-6 shrink-0"
                aria-hidden="true"
              />
              {!collapsed && <span className="sidebar-label">AimThread</span>}
            </Link>
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
              title={collapsed ? "展开侧边栏" : "收起侧边栏"}
              aria-expanded={!collapsed}
              aria-controls="desktop-sidebar-navigation"
              onClick={() => setSidebarPreference(!collapsed)}
              className="sidebar-toggle group shrink-0"
            >
              {collapsed ? (
                <>
                  <Orbit
                    aria-hidden="true"
                    className="sidebar-toggle-brand text-primary size-6 group-hover:hidden group-focus-visible:hidden"
                  />
                  <PanelLeftOpen
                    aria-hidden="true"
                    className="sidebar-toggle-expand hidden group-hover:block group-focus-visible:block"
                  />
                </>
              ) : (
                <PanelLeftClose aria-hidden="true" />
              )}
            </Button>
          </div>
          <div id="desktop-sidebar-navigation">
            <PrimaryNav collapsed={collapsed} />
          </div>
          <div className="border-border mt-auto border-t pt-4">
            <LogoutButton collapsed={collapsed} />
          </div>
        </aside>
        <header className="border-border bg-card flex h-16 items-center justify-between border-b px-5 md:hidden">
          <Link href="/today" className="flex items-center gap-2 font-semibold">
            <Orbit className="text-primary size-5" />
            AimThread
          </Link>
          <Button
            variant="ghost"
            size="icon"
            aria-label="打开导航"
            onClick={() => setMenu(true)}
          >
            <Menu />
          </Button>
        </header>
        <main className="app-content px-5 py-8 md:ml-[216px] md:px-10 md:py-10 lg:px-14">
          {children}
        </main>
        {menu && (
          <Modal
            labelledBy="navigation-title"
            onClose={() => setMenu(false)}
            overlayClassName="fixed inset-0 z-50 flex bg-black/50"
            panelClassName="flex h-dvh w-72 max-w-[85vw] flex-col bg-card p-5 text-foreground"
          >
            <div className="mb-8 flex items-center justify-between">
              <h2 id="navigation-title" className="font-semibold">
                AimThread
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="关闭导航"
                onClick={() => setMenu(false)}
              >
                <X />
              </Button>
            </div>
            <PrimaryNav onNavigate={() => setMenu(false)} />
            <div className="mt-auto">
              <LogoutButton />
            </div>
          </Modal>
        )}
      </div>
    </SessionNavigationProvider>
  );
}
