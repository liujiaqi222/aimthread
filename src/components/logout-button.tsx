"use client";

import { logoutAction } from "@/app/actions";
import { useSessionNavigation } from "@/components/session-navigation";
import { Button } from "@/components/ui/button";
import { onboardingDraftStorageKey } from "@/shared/onboarding";

export function LogoutButton({ userId }: { userId: string }) {
  const { request } = useSessionNavigation();
  return (
    <form
      action={async () => {
        await logoutAction();
        window.location.replace("/login");
      }}
      onSubmit={(event) => {
        const form = event.currentTarget;
        if (request(() => form.requestSubmit())) {
          event.preventDefault();
          return;
        }
        localStorage.removeItem(
          onboardingDraftStorageKey(window.location.origin, userId),
        );
      }}
    >
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="rounded-full text-stone-500"
      >
        退出
      </Button>
    </form>
  );
}
