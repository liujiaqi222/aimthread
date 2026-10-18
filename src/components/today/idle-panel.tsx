"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Circle,
  CircleDot,
  ListTodo,
  Loader2,
  Play,
  Plus,
  Sparkles,
} from "lucide-react";

import {
  listTasksAction,
  quickAddTaskAction,
  selectionSetAction,
} from "@/app/(app)/session-actions";
import { TimerPreferences } from "./timer-preferences";
import { SoundToggle } from "./sound-toggle";
import { configOf } from "@/shared/pomodoro";
import { formatTimeDigits } from "@/shared/session-timer";
import { unlockTimerSound } from "./timer-sound";
import { PhaseProgress } from "./phase-progress";
import { TimerControls, TimerStage } from "./timer-stage";
import { FocusClock } from "@/components/today/focus-clock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Task } from "@/db/schema";
import type { DashboardData } from "@/services/dashboard";

/**
 * Idle execution panel (PRD §5.1–5.3): resolved execution object with its
 * resume hint, one click to start, quick goal/task switching, optional
 * intent (never auto-created into a Task) and quick Task adding.
 */
export function IdlePanel({
  dashboard,
  firstRun = false,
  busy,
  onStart,
  onRefresh,
  onError,
  onOptimisticTaskAdd,
  onOptimisticTaskResolve,
  onOptimisticTaskRevert,
  onOptimisticSelectTask,
}: {
  dashboard: DashboardData;
  firstRun?: boolean;
  busy: "none" | "start";
  onStart: (input: {
    intent: string | null;
    timerMode: "stopwatch" | "pomodoro";
  }) => void;
  onRefresh: () => Promise<unknown>;
  onError: (message: string | null) => void;
  onOptimisticTaskAdd?: (task: Task) => void;
  onOptimisticTaskResolve?: (tempId: string, realTask: Task) => void;
  onOptimisticTaskRevert?: (tempId: string, goalId: string) => void;
  onOptimisticSelectTask?: (goalId: string, task: Task | null) => void;
}) {
  const { selection, resumeHint, goals, todos } = dashboard;
  const serverMode = dashboard.timerSettings?.timerMode ?? "pomodoro";
  const [lastServerMode, setLastServerMode] = useState(serverMode);
  const [mode, setMode] = useState(serverMode);
  const modeSaveQueue = useRef(Promise.resolve());
  const modeVersion = useRef(0);
  const persistedMode = useRef(serverMode);
  if (lastServerMode !== serverMode) {
    setLastServerMode(serverMode);
    setMode(serverMode);
  }
  useEffect(() => {
    persistedMode.current = serverMode;
  }, [serverMode]);
  const config = configOf(dashboard.timerSettings?.timerPreferences);
  const [intent, setIntent] = useState("");
  const [showIntent, setShowIntent] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [fetched, setFetched] = useState<{
    goalId: string;
    tasks: Task[];
  } | null>(null);
  const taskOptions =
    selection && fetched?.goalId === selection.goal.id ? fetched.tasks : todos;

  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    const goalId = selection.goal.id;
    void listTasksAction(goalId).then((result) => {
      if (!cancelled && result.ok) {
        setFetched({ goalId, tasks: result.data });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.goal.id, selection?.task?.id]);

  if (!selection) return null;

  const handleSelectGoal = async (goalId: string) => {
    onError(null);
    const result = await selectionSetAction({ goalId });
    if (!result.ok) onError(result.error.message);
    await onRefresh();
  };

  const handleSelectTask = async (goalId: string, taskId: string | null) => {
    onError(null);
    const previousSelection = selection;
    const nextTask = taskId
      ? (taskOptions.find((t) => t.id === taskId) ?? null)
      : null;
    onOptimisticSelectTask?.(goalId, nextTask);

    try {
      const result = await selectionSetAction({ goalId, taskId });
      if (!result.ok) {
        onOptimisticSelectTask?.(
          previousSelection.goal.id,
          previousSelection.task,
        );
        onError(result.error.message);
      } else {
        void onRefresh();
      }
    } catch {
      onOptimisticSelectTask?.(
        previousSelection.goal.id,
        previousSelection.task,
      );
      onError("切换任务失败，请稍后重试");
    }
  };

  const handleQuickAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;
    onError(null);
    setNewTaskTitle("");

    const goalId = selection.goal.id;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimisticTask: Task = {
      id: tempId,
      goalId,
      title,
      description: null,
      status: "pending",
      position: (todos[todos.length - 1]?.position ?? 0) + 1,
      estimatedMinutes: null,
      resourceType: null,
      resourceValue: null,
      note: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    onOptimisticTaskAdd?.(optimisticTask);

    try {
      const result = await quickAddTaskAction({ goalId, title });
      if (result.ok && result.data[0]) {
        const createdTask = result.data[0];
        onOptimisticTaskResolve?.(tempId, createdTask);
        setFetched((prev) =>
          prev && prev.goalId === goalId
            ? { ...prev, tasks: [...prev.tasks, createdTask] }
            : prev,
        );
        void onRefresh();
      } else {
        onOptimisticTaskRevert?.(tempId, goalId);
        setNewTaskTitle((prev) => (prev ? prev : title));
        onError(result.ok ? "创建任务失败" : result.error.message);
      }
    } catch {
      onOptimisticTaskRevert?.(tempId, goalId);
      setNewTaskTitle((prev) => (prev ? prev : title));
      onError("网络请求失败，请稍后重试");
    }
  };

  const pendingCount =
    goals.find((item) => item.goal.id === selection.goal.id)
      ?.pendingTaskCount ?? taskOptions.length;
  const visibleTodos = todos.slice(0, 3);
  const hiddenTodoCount = Math.max(0, pendingCount - visibleTodos.length);
  const clockValue =
    mode === "pomodoro"
      ? formatTimeDigits(config.focusMinutes * 60)
      : "00:00";
  const startLabel =
    busy === "start"
      ? "开始中…"
      : firstRun
        ? "开始第一次执行"
        : mode === "pomodoro"
          ? `开始 ${config.focusMinutes} 分钟专注`
          : "开始正计时";

  const persistMode = (value: "pomodoro" | "stopwatch") => {
    if (value === mode) return;
    const version = ++modeVersion.current;
    setMode(value);
    onError(null);
    modeSaveQueue.current = modeSaveQueue.current.then(async () => {
      try {
        const response = await fetch("/api/settings/timer-mode", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timerMode: value }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
          throw new Error("Mode preference was not saved");
        }
        persistedMode.current = value;
      } catch {
        if (version === modeVersion.current) {
          setMode(persistedMode.current);
          onError("切换模式未保存，请重试。");
        }
      }
    });
  };

  return (
    <div className="space-y-7 sm:space-y-9">
      <section className="mx-auto flex w-full max-w-2xl flex-col items-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f0ded7] bg-[#fff8f5] px-3 py-1.5 text-[11px] font-semibold tracking-[0.16em] text-[#a54b37] uppercase">
          <span className="size-1.5 rounded-full bg-[#d85c41]" aria-hidden="true" />
          Current thread
        </div>

        <div className="relative flex w-full flex-col items-center">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-7 bottom-24 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-[#e9c8bf] via-[#efd8d1] to-transparent"
          />

          <div className="relative z-10 w-full max-w-lg rounded-[22px] border border-stone-200/90 bg-white p-2 shadow-[0_10px_30px_rgba(44,37,31,0.06)]">
            <div className="grid gap-1 sm:grid-cols-2">
              <SwitchSelect
                label="目标"
                value={selection.goal.id}
                onChange={(goalId) => void handleSelectGoal(goalId)}
                options={goals.map((item) => ({
                  value: item.goal.id,
                  label: item.goal.title,
                }))}
              />
              <SwitchSelect
                label="正在做"
                value={selection.task?.id ?? ""}
                onChange={(taskId) =>
                  void handleSelectTask(selection.goal.id, taskId || null)
                }
                options={[
                  { value: "", label: "直接推进目标" },
                  ...taskOptions
                    .filter((task) => !task.id.startsWith("temp-"))
                    .map((task) => ({ value: task.id, label: task.title })),
                ]}
              />
            </div>
          </div>

          {resumeHint && (
            <div className="relative z-10 mt-3 flex max-w-lg items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50/90 px-3.5 py-2.5 text-left text-sm leading-6 text-amber-950 shadow-[0_6px_16px_rgba(120,80,20,0.04)]">
              <Sparkles
                className="mt-1 size-3.5 shrink-0 text-amber-700"
                aria-hidden="true"
              />
              <span>
                <span className="font-medium">接着上次：</span>
                {resumeHint}
              </span>
            </div>
          )}

          <TimerStage
            className="relative z-10"
            progress={
              <div
                aria-hidden={mode !== "pomodoro"}
                inert={mode !== "pomodoro"}
                className={mode === "pomodoro" ? "visible" : "invisible"}
              >
                <PhaseProgress config={config} />
              </div>
            }
          >
            <div className="focus-orbit relative grid size-64 place-items-center rounded-full border border-[#edd8d1] bg-[radial-gradient(circle_at_50%_42%,#ffffff_0%,#fffdfa_58%,#fff5f1_100%)] shadow-[0_20px_60px_rgba(87,61,48,0.08)] sm:size-72">
              <span
                aria-hidden="true"
                className="absolute top-[-5px] left-1/2 size-3 -translate-x-1/2 rounded-full border-[3px] border-white bg-[#d85c41] shadow-[0_0_0_1px_#e5b7aa]"
              />
              <div className="flex flex-col items-center gap-4">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-stone-400 uppercase">
                  准备开始
                </p>
                <FocusClock
                  value={clockValue}
                  tone="idle"
                  aria-hidden="true"
                  className="scale-[0.86] sm:scale-90"
                />
              </div>
            </div>
          </TimerStage>
        </div>

        <div className="mt-2 flex w-full max-w-lg flex-col items-center gap-3 sm:mt-4">
          <TimerControls>
            <Button
              size="lg"
              disabled={busy !== "none"}
              onClick={() => {
                unlockTimerSound();
                onStart({ intent: intent.trim() || null, timerMode: mode });
              }}
              className="focus-start-button h-13 w-full gap-2 rounded-2xl bg-[#d85c41] px-7 text-base font-semibold text-white shadow-[0_10px_24px_rgba(216,92,65,0.24)] transition-[transform,box-shadow,background-color] hover:-translate-y-0.5 hover:bg-[#c84f36] hover:shadow-[0_14px_30px_rgba(216,92,65,0.3)] active:translate-y-0 active:scale-[0.99]"
            >
              <Play className="size-4 fill-current" aria-hidden="true" />
              {startLabel}
            </Button>
          </TimerControls>

          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-stone-500">
            <div
              role="group"
              aria-label="计时模式"
              className="flex rounded-full border border-stone-200 bg-stone-50 p-1"
            >
              {(["pomodoro", "stopwatch"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  disabled={busy !== "none"}
                  onClick={() => persistMode(value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#d85c41] ${
                    mode === value
                      ? "bg-white text-[#b54b35] shadow-sm"
                      : "text-stone-500 hover:text-stone-800"
                  }`}
                >
                  {value === "pomodoro" ? "番茄钟" : "正计时"}
                </button>
              ))}
            </div>
            <div
              aria-hidden={mode !== "pomodoro"}
              inert={mode !== "pomodoro"}
              className={`items-center gap-1 ${mode === "pomodoro" ? "flex" : "hidden"}`}
            >
              <TimerPreferences
                value={dashboard.timerSettings?.timerPreferences}
                onSaved={() => void onRefresh()}
              />
              <SoundToggle
                value={dashboard.timerSettings?.timerPreferences}
                onSaved={() => void onRefresh()}
              />
            </div>
          </div>

          {showIntent ? (
            <div className="w-full rounded-2xl border border-stone-200 bg-stone-50/80 p-3.5 text-left">
              <div className="flex items-baseline justify-between gap-3">
                <label
                  htmlFor="session-intent"
                  className="text-sm font-medium text-stone-700"
                >
                  这次想推进什么？
                </label>
                <button
                  type="button"
                  className="text-xs text-stone-400 hover:text-stone-700"
                  onClick={() => {
                    setShowIntent(false);
                    setIntent("");
                  }}
                >
                  移除
                </button>
              </div>
              <Input
                id="session-intent"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="例如：先梳理首页结构"
                className="mt-2 h-10 border-stone-300 bg-white shadow-none"
                autoFocus
              />
              <p className="mt-2 text-xs leading-5 text-stone-500">
                只属于这次专注，不会自动创建任务。
              </p>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-full text-stone-500 hover:bg-[#fff4ef] hover:text-[#a94b36]"
              onClick={() => setShowIntent(true)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              写一句这次想做什么
            </Button>
          )}
        </div>
      </section>

      <section
        aria-labelledby="todos-title"
        className="mx-auto w-full max-w-2xl rounded-[22px] border border-stone-200 bg-[#faf9f6] p-4 sm:p-5"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="todos-title" className="text-sm font-semibold text-stone-900">
              接下来
            </h2>
            <p className="mt-1 text-xs text-stone-400">
              {pendingCount > 0 ? `${pendingCount} 项还在等待推进` : "当前目标暂时没有待办"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="xs"
            nativeButton={false}
            render={<Link href="/goals" />}
            className="gap-1 rounded-full text-stone-500"
          >
            查看全部
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </Button>
        </div>

        {visibleTodos.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {visibleTodos.map((task) => {
              const selected = selection.task?.id === task.id;
              const isOptimistic = task.id.startsWith("temp-");
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    disabled={isOptimistic}
                    aria-pressed={selected}
                    onClick={() =>
                      void handleSelectTask(
                        selection.goal.id,
                        selected ? null : task.id,
                      )
                    }
                    className={`group flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm transition-[border-color,background-color,transform] ${
                      selected
                        ? "border-[#efd0c6] bg-[#fff7f3]"
                        : "border-transparent bg-white hover:-translate-y-px hover:border-stone-200"
                    } ${isOptimistic ? "cursor-default opacity-75" : ""}`}
                  >
                    {isOptimistic ? (
                      <Loader2
                        className="size-4 shrink-0 animate-spin text-stone-400"
                        aria-hidden="true"
                      />
                    ) : selected ? (
                      <CircleDot
                        className="size-4 shrink-0 text-[#d85c41]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle
                        className="size-4 shrink-0 text-stone-300 transition-colors group-hover:text-stone-400"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        selected
                          ? "font-medium text-stone-950"
                          : "text-stone-700"
                      }`}
                    >
                      {task.title}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] font-medium ${
                        selected
                          ? "text-[#b54b35]"
                          : "text-stone-400 opacity-0 transition-opacity group-hover:opacity-100"
                      }`}
                    >
                      {isOptimistic
                        ? "创建中…"
                        : selected
                          ? "正在做"
                          : "设为当前"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-stone-200 bg-white/70 px-4 py-4">
            <ListTodo className="size-4 shrink-0 text-stone-300" aria-hidden="true" />
            <p className="text-sm text-stone-500">
              还没有任务，也可以直接围绕目标开始专注。
            </p>
          </div>
        )}

        {hiddenTodoCount > 0 && (
          <Link
            href="/goals"
            className="mt-3 flex items-center justify-center gap-1 rounded-xl py-2 text-xs text-stone-500 transition-colors hover:bg-white hover:text-stone-800"
          >
            还有 {hiddenTodoCount} 项
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </Link>
        )}

        <form
          onSubmit={handleQuickAddTask}
          className="mt-4 flex items-center gap-2 border-t border-stone-200/70 pt-4"
        >
          <Input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder="快速添加下一步"
            maxLength={500}
            className="h-10 border-stone-200 bg-white text-sm shadow-none"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-10 shrink-0 bg-white"
            disabled={!newTaskTitle.trim()}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            添加
          </Button>
        </form>
      </section>
    </div>
  );
}

function SwitchSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(nextValue) => onChange(nextValue ?? "")}
    >
      <SelectTrigger
        aria-label={label}
        className="h-auto min-h-14 w-full min-w-0 gap-2 rounded-2xl border-transparent bg-transparent px-3.5 py-2 text-stone-800 shadow-none transition-colors hover:bg-stone-50 data-[size=default]:h-auto"
      >
        <span className="shrink-0 text-[11px] font-medium tracking-wide text-stone-400">
          {label}
        </span>
        <SelectValue className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-stone-900" />
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="max-w-80 border-stone-200 bg-white"
      >
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
