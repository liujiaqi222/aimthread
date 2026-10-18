"use client";
import { useRouter } from "next/navigation";
import { TimerPreferences } from "@/components/today/timer-preferences";
export function SettingsTimerPreferences({ value }: { value: unknown }) {
  const router = useRouter();
  return <TimerPreferences value={value} onSaved={() => router.refresh()} />;
}
