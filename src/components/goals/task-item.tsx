"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  Archive,
  Check,
  Circle,
  CircleCheck,
  CircleMinus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

import {
  updatePlanningStatusAction,
  updateTaskAction,
  type PlanningStatusState,
} from "@/app/(app)/planning-actions";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { PlanningStatusAction } from "@/components/planning-status-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Task } from "@/db/schema";
import { taskStatusLabel } from "@/shared/labels";
import { effortComparison } from "@/shared/execution-report";

function TaskEditor({
  task,
  onCancel,
}: {
  task: Pick<Task, "id" | "title" | "estimatedMinutes">;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [estimate, setEstimate] = useState(
    task.estimatedMinutes == null ? "" : String(task.estimatedMinutes),
  );
  const [state, formAction, pending] = useActionState<
    PlanningStatusState,
    FormData
  >(updateTaskAction, undefined);

  useEffect(() => {
    if (state?.status === "success") onCancel();
  }, [state, onCancel]);

  return (
    <form action={formAction} className="w-full space-y-2 py-1">
      <input type="hidden" name="id" value={task.id} />
      <label htmlFor={`edit-task-${task.id}`} className="sr-only">
        任务名称
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={`edit-task-${task.id}`}
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={500}
          autoFocus
          className="border-input bg-card h-9 flex-1"
        />
        <Button type="submit" size="sm" disabled={pending}>
          <Check aria-hidden="true" />
          {pending ? "保存中…" : "保存"}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="取消编辑"
          disabled={pending}
          onClick={onCancel}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <label
          htmlFor={`estimate-task-${task.id}`}
          className="text-muted-foreground text-xs"
        >
          预计分钟数
        </label>
        <Input
          id={`estimate-task-${task.id}`}
          name="estimatedMinutes"
          type="number"
          min={1}
          max={100_000}
          step={1}
          value={estimate}
          onChange={(event) => setEstimate(event.target.value)}
          placeholder="可不填"
          className="bg-card h-8 w-28"
        />
      </div>
      {state?.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

const statusIcon = {
  pending: Circle,
  completed: CircleCheck,
  skipped: CircleMinus,
  archived: Archive,
} as const;

export function TaskItem({
  task,
  focusSeconds = 0,
}: {
  task: Task;
  focusSeconds?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const removeTitleId = useId();
  const [removeState, removeAction, removePending] = useActionState<
    PlanningStatusState,
    FormData
  >(updatePlanningStatusAction, undefined);
  const StatusIcon = statusIcon[task.status];
  const statusLabel =
    task.status === "archived" ? "已移除" : taskStatusLabel[task.status];

  return (
    <li className="group/task border-border border-b last:border-b-0">
      <div className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-1 py-2.5 sm:flex sm:flex-wrap sm:px-2">
        <StatusIcon
          aria-hidden="true"
          className={`size-4 shrink-0 ${
            task.status === "pending"
              ? "text-muted-foreground"
              : "text-muted-foreground"
          }`}
        />

        <div className="min-w-0 flex-1">
          {editing ? (
            <TaskEditor task={task} onCancel={() => setEditing(false)} />
          ) : (
            <>
              <p
                className={`truncate text-sm font-medium ${
                  task.status === "pending"
                    ? "text-foreground"
                    : "text-muted-foreground decoration-border line-through"
                }`}
              >
                {task.title}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {statusLabel}
                {` · ${effortComparison({ ...task, focusSeconds, resumeHint: null })}`}
              </p>
            </>
          )}
        </div>

        {!editing && (
          <div className="col-start-2 flex flex-wrap items-center gap-1 sm:ml-auto">
            {task.status === "pending" ? (
              <>
                <PlanningStatusAction
                  entityType="task"
                  id={task.id}
                  action="complete"
                  label="完成"
                  icon="check"
                  variant="ghost"
                />
                <PlanningStatusAction
                  entityType="task"
                  id={task.id}
                  action="skip"
                  label="跳过"
                  icon="skip"
                  variant="ghost"
                />
                <span className="bg-accent mx-1 hidden h-4 w-px sm:block" />
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => setEditing(true)}
                >
                  <Pencil aria-hidden="true" />
                  编辑
                </Button>
                <form action={removeAction}>
                  <input type="hidden" name="entityType" value="task" />
                  <input type="hidden" name="id" value={task.id} />
                  <input type="hidden" name="action" value="archive" />
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setRemoveOpen(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    删除
                  </Button>
                  {removeOpen && (
                    <ConfirmationDialog
                      titleId={removeTitleId}
                      title="删除这个任务？"
                      description="它会从当前任务列表中移除，但不会抹掉已经留下的专注记录。你之后仍可在“全部”中找回并重新打开。"
                      confirmLabel="删除任务"
                      cancelLabel="保留"
                      confirmType="submit"
                      tone="danger"
                      pending={removePending}
                      error={
                        removeState?.status === "error"
                          ? removeState.message
                          : null
                      }
                      onClose={() => setRemoveOpen(false)}
                    />
                  )}
                </form>
              </>
            ) : (
              <PlanningStatusAction
                entityType="task"
                id={task.id}
                action="reopen"
                label={task.status === "archived" ? "恢复" : "重新打开"}
                icon="reactivate"
                variant="ghost"
              />
            )}
          </div>
        )}
      </div>
    </li>
  );
}
