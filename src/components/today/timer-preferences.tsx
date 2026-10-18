"use client";

import { useState } from "react";
import { SlidersHorizontal, X, Minus, Plus } from "lucide-react";
import { PhaseProgress } from "./phase-progress";
import { Modal } from "@/components/focus/modal";
import { Button } from "@/components/ui/button";
import { saveTimerPreferencesAction } from "@/app/(app)/session-actions";
import { configOf, plannedPhases } from "@/shared/pomodoro";
import { timerConfigSchema } from "@/shared/schemas/session";

export function TimerPreferences({
  value,
  running = false,
  onSaved,
}: {
  value: unknown;
  running?: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="计时设置"
        onClick={() => setOpen(true)}
        className="text-muted-foreground"
      >
        <SlidersHorizontal className="size-4" />
        计时设置
      </Button>
      {open && (
        <PreferencesDrawer
          value={value}
          running={running}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function PreferencesDrawer({
  value,
  running,
  onClose,
  onSaved,
}: {
  value: unknown;
  running: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(configOf(value));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      onClose={onClose}
      labelledBy="timer-preferences-title"
      overlayClassName="fixed inset-0 z-50 flex items-end justify-end bg-black/30 sm:items-stretch"
      panelClassName="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-6 shadow-xl sm:max-h-dvh sm:rounded-none sm:p-8"
    >
      <div className="flex items-center justify-between">
        <h2 id="timer-preferences-title" className="text-2xl font-semibold">
          给时间一点节奏
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭计时设置"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <p className="text-muted-foreground mt-3 text-left text-sm leading-6">
        {running
          ? "时长与轮数修改下次执行生效。当前过程继续使用开始时的配置。"
          : "安排这次想专注的轮数。阶段到时后，等你选择再继续。"}
      </p>
      <form
        className="mt-8 space-y-6"
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = timerConfigSchema.safeParse(draft);
          if (!parsed.success) {
            setError("时长请填 1–180 的整数分钟，轮数请填 1–12 的整数。");
            return;
          }
          setSaving(true);
          setError(null);
          try {
            const result = await saveTimerPreferencesAction({
              timerPreferences: parsed.data,
            });
            if (result.ok) {
              onSaved();
              onClose();
            } else setError(result.error.message);
          } catch {
            setError("设置未保存，请重试。");
          } finally {
            setSaving(false);
          }
        }}
      >
        {(
          [
            ["focusMinutes", "专注"],
            ["shortBreakMinutes", "短休息"],
            ["iterations", "专注轮数"],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className="border-border bg-muted flex items-center justify-between gap-4 rounded-2xl border p-4 text-sm"
          >
            <span>{label}</span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`减少${label}`}
                disabled={draft[key] <= 1}
                className="hover:bg-accent rounded-lg p-2 disabled:opacity-30"
                onClick={() =>
                  setDraft({
                    ...draft,
                    [key]: Math.max(1, (draft[key] || 1) - 1),
                  })
                }
              >
                <Minus className="size-4" />
              </button>
              <input
                aria-label={key === "iterations" ? "专注轮数" : `${label}分钟`}
                type="number"
                min={1}
                max={key === "iterations" ? 12 : 180}
                step={1}
                required
                value={draft[key]}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: e.target.valueAsNumber })
                }
                className="border-input focus-visible:outline-primary w-14 rounded-lg border p-2 text-center focus-visible:outline-2"
              />
              <button
                type="button"
                aria-label={`增加${label}`}
                disabled={draft[key] >= (key === "iterations" ? 12 : 180)}
                className="hover:bg-accent rounded-lg p-2 disabled:opacity-30"
                onClick={() =>
                  setDraft({
                    ...draft,
                    [key]: Math.min(
                      key === "iterations" ? 12 : 180,
                      (draft[key] || 1) + 1,
                    ),
                  })
                }
              >
                <Plus className="size-4" />
              </button>
            </span>
          </label>
        ))}
        <div className="bg-accent space-y-4 rounded-2xl p-4">
          <p className="text-muted-foreground text-sm">
            预计用时{" "}
            <span className="text-foreground font-medium">
              {timerConfigSchema.safeParse(draft).success
                ? plannedPhases(draft).reduce(
                    (sum, phase) => sum + phase.minutes,
                    0,
                  )
                : "—"}{" "}
              分钟
            </span>
          </p>
          {timerConfigSchema.safeParse(draft).success && (
            <PhaseProgress config={draft} />
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button
          disabled={saving}
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
        >
          {saving ? "保存中…" : "保存设置"}
        </Button>
      </form>
    </Modal>
  );
}
