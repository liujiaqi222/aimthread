"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  X,
  Circle,
  CircleDot,
  ListTodo,
  Loader2,
  Play,
  Plus,
} from "lucide-react";

import {
  listTasksAction,
  quickAddTaskAction,
  selectionSetAction,
} from "@/app/(app)/session-actions";
import { TimerPreferences } from "./timer-preferences";
import { SoundToggle } from "./sound-toggle";
import { configOf } from "@/shared/pomodoro";
import { Modal } from "@/components/focus/modal";
import { unlockTimerSound } from "./timer-sound";

import { ExecutionHeading } from "./execution-heading";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [picker, setPicker] = useState<"goal" | "task" | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [intent, setIntent] = useState("");
  const [showIntent, setShowIntent] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  // Fetched full pending list for the switcher, tagged with the goal it
  // belongs to so a goal switch immediately falls back to the dashboard
  // todos until the fetch lands (no sync setState inside the effect).
  const [fetched, setFetched] = useState<{
    goalId: string;
    tasks: Task[];
  } | null>(null);
  const taskOptions =
    selection && fetched?.goalId === selection.goal.id ? fetched.tasks : todos;

  // Full pending list for the switcher whenever the selected Goal changes.
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
    if (!result.ok) {
      onError(result.error.message);
      setPickerError(result.error.message);
      return false;
    }
    await onRefresh();
    return true;
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
        setPickerError(result.error.message);
        return false;
      } else {
        // Background sync without blocking UI
        void onRefresh();
        return true;
      }
    } catch {
      onOptimisticSelectTask?.(
        previousSelection.goal.id,
        previousSelection.task,
      );
      setPickerError("切换任务失败，请稍后重试");
      onError("切换任务失败，请稍后重试");
      return false;
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
      initialEstimatedMinutes: null,
      resourceType: null,
      resourceValue: null,
      note: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    onOptimisticTaskAdd?.(optimisticTask);

    try {
      const result = await quickAddTaskAction({
        goalId,
        title,
      });

      if (result.ok && result.data[0]) {
        const createdTask = result.data[0];
        onOptimisticTaskResolve?.(tempId, createdTask);
        setFetched((prev) =>
          prev && prev.goalId === goalId
            ? { ...prev, tasks: [...prev.tasks, createdTask] }
            : prev,
        );
        // Non-blocking background sync for final consistency.
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

  const choose = async (id: string | null) => {
    if (choosing) return;
    setChoosing(true);
    setPickerError(null);
    try {
      const saved =
        picker === "goal" && id
          ? await handleSelectGoal(id)
          : await handleSelectTask(selection.goal.id, id);
      if (saved) setPicker(null);
    } catch {
      setPickerError("选择未保存，请重试。");
      onError("选择未保存，请重试。");
    } finally {
      setChoosing(false);
    }
  };

  return (
    <div className="mx-auto max-w-[760px] space-y-10">
      <ExecutionHeading
        goal={selection.goal.title}
        task={selection.task?.title}
        description={selection.task?.description ?? selection.goal.description}
        resource={selection.task?.resourceValue}
        resumeHint={resumeHint}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="outline"
            aria-label="选择目标"
            onClick={() => {
              setSearch("");
              setPicker("goal");
            }}
            className="max-w-full"
          >
            <span className="truncate">{selection.goal.title}</span>
            <ChevronDown className="size-4 shrink-0" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setPicker("task");
            }}
          >
            更换任务
          </Button>
        </div>
      </ExecutionHeading>
      <section
        className="border-border flex flex-col gap-5 border-y py-6 sm:flex-row sm:items-center sm:justify-between"
        aria-label="准备专注"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="计时模式"
            className="bg-muted flex rounded-lg p-1"
          >
            {(["pomodoro", "stopwatch"] as const).map((value) => (
              <button
                key={value}
                aria-label={value === "pomodoro" ? "番茄钟" : "正计时"}
                type="button"
                disabled={busy !== "none"}
                aria-pressed={mode === value}
                className={`min-h-10 rounded-md px-3 text-sm ${mode === value ? "bg-card text-primary font-medium shadow-sm" : "text-muted-foreground"}`}
                onClick={() => {
                  if (value === mode) return;
                  const version = ++modeVersion.current;
                  setMode(value);
                  modeSaveQueue.current = modeSaveQueue.current.then(
                    async () => {
                      try {
                        const response = await fetch(
                          "/api/settings/timer-mode",
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ timerMode: value }),
                          },
                        );
                        const result = await response.json();
                        if (!response.ok || !result.ok)
                          throw new Error("Save failed");
                        persistedMode.current = value;
                      } catch {
                        if (version === modeVersion.current) {
                          setMode(persistedMode.current);
                          onError("切换模式未保存，请重试。");
                        }
                      }
                    },
                  );
                }}
              >
                {value === "pomodoro"
                  ? `番茄 · ${config.focusMinutes} 分钟`
                  : "正计时"}
              </button>
            ))}
          </div>
          {mode === "pomodoro" && (
            <>
              <TimerPreferences
                value={dashboard.timerSettings?.timerPreferences}
                onSaved={() => void onRefresh()}
              />
              <SoundToggle
                value={dashboard.timerSettings?.timerPreferences}
                onSaved={() => void onRefresh()}
              />
            </>
          )}
        </div>
        <Button
          size="lg"
          disabled={busy !== "none"}
          onClick={() => {
            unlockTimerSound();
            onStart({ intent: intent.trim() || null, timerMode: mode });
          }}
          className="h-12 shrink-0 px-7"
        >
          <Play className="size-4 fill-current" />
          {busy === "start"
            ? "开始中…"
            : firstRun
              ? "开始第一次执行"
              : "开始专注"}
        </Button>
      </section>
      {selection.goalOnly &&
        (showIntent ? (
          <div>
            <label htmlFor="session-intent" className="text-sm">
              本次说明（可选）
            </label>
            <Input
              id="session-intent"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="这次准备推进什么？"
              className="mt-2"
            />
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setShowIntent(true)}>
            <Plus className="size-4" />
            添加本次说明
          </Button>
        ))}
      <section>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground flex min-h-11 w-full items-center justify-between text-sm"
        >
          <span>目标下的其他任务 · {taskOptions.length}</span>
          <ChevronDown className={`size-4 ${expanded ? "rotate-180" : ""}`} />
        </button>
        {expanded && (
          <div className="mt-3 space-y-4">
            <form onSubmit={handleQuickAddTask} className="flex gap-2">
              <Input
                aria-label="新任务标题"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="添加一项任务"
                maxLength={500}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={!newTaskTitle.trim()}
              >
                <Plus className="size-4" />
                创建
              </Button>
            </form>
            <ul className="divide-border divide-y">
              {todos.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    disabled={task.id.startsWith("temp-")}
                    aria-pressed={selection.task?.id === task.id}
                    onClick={() =>
                      void handleSelectTask(selection.goal.id, task.id)
                    }
                    className="flex min-h-12 w-full items-center gap-3 py-3 text-left text-sm"
                  >
                    {task.id.startsWith("temp-") ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : selection.task?.id === task.id ? (
                      <CircleDot className="text-primary size-4" />
                    ) : (
                      <Circle className="text-muted-foreground size-4" />
                    )}
                    <span className="min-w-0 break-words">{task.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!todos.length && (
              <p className="text-muted-foreground text-sm">
                <ListTodo className="mr-2 inline size-4" />
                可以直接围绕目标开始。
              </p>
            )}
            <Link href="/goals" className="text-primary text-sm underline">
              管理全部目标和任务
            </Link>
          </div>
        )}
      </section>
      {picker && (
        <Modal
          labelledBy="work-picker-title"
          onClose={() => {
            if (!choosing) setPicker(null);
          }}
          panelClassName="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
        >
          <div className="flex items-center justify-between">
            <h2 id="work-picker-title" className="text-xl font-semibold">
              {picker === "goal" ? "选择目标" : "更换任务"}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭选择"
              disabled={choosing}
              onClick={() => setPicker(null)}
            >
              <X />
            </Button>
          </div>
          <Input
            aria-label="查找工作"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={picker === "goal" ? "查找目标" : "查找任务"}
            className="my-5"
          />
          {pickerError && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {pickerError}
            </p>
          )}
          <div className="space-y-2">
            {picker === "goal" ? (
              goals
                .filter((item) =>
                  item.goal.title.toLowerCase().includes(search.toLowerCase()),
                )
                .map((item) => (
                  <button
                    type="button"
                    key={item.goal.id}
                    disabled={choosing}
                    onClick={() => void choose(item.goal.id)}
                    aria-pressed={item.goal.id === selection.goal.id}
                    className="border-border hover:bg-accent flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left text-sm"
                  >
                    <span className="min-w-0 break-words">
                      {item.goal.title}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {item.pendingTaskCount} 项任务
                    </span>
                  </button>
                ))
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={choosing}
                  onClick={() => void choose(null)}
                  className="w-full"
                >
                  只围绕目标执行
                </Button>
                {taskOptions
                  .filter(
                    (task) =>
                      !task.id.startsWith("temp-") &&
                      task.title.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((task) => (
                    <button
                      type="button"
                      key={task.id}
                      disabled={choosing}
                      aria-pressed={selection.task?.id === task.id}
                      onClick={() => void choose(task.id)}
                      className="border-border hover:bg-accent min-h-12 w-full rounded-lg border p-3 text-left text-sm"
                    >
                      {task.title}
                    </button>
                  ))}
              </>
            )}
          </div>
          <Link
            href="/goals"
            className="text-primary mt-6 inline-block text-sm underline"
          >
            管理或新增目标
          </Link>
        </Modal>
      )}
    </div>
  );
}
