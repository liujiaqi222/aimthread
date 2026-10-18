"use client";

import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { useSessionNavigation } from "@/components/session-navigation";
import { Button } from "@/components/ui/button";
import { onboardingDraftStorageKey } from "@/shared/onboarding";

export function LogoutButton({ collapsed = false }: { collapsed?: boolean }) {
  const { request } = useSessionNavigation();
  return (
    <form
      action={logoutAction}
      onSubmit={(event) => {
        const form = event.currentTarget;
        if (request(() => form.requestSubmit())) {
          event.preventDefault();
          return;
        }
        localStorage.removeItem(
          onboardingDraftStorageKey(window.location.origin),
        );
      }}
    >
      <Button
        type="submit"
        aria-label="退出"
        title="退出"
        variant="ghost"
        size="sm"
        className="text-muted-foreground rounded-full"
      >
        <LogOut className="size-4 shrink-0" aria-hidden="true" />
        {!collapsed && <span className="sidebar-label">退出</span>}
      </Button>
    </form>
  );
}
