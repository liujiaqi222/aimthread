import { ownedBy } from "@/services/ownership";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { requireUserId, type AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import { goals, sessions, tasks, type Goal, type Task } from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  goalCreateSchema,
  goalUpdateSchema,
  listSchema,
  parentStatusSchema,
  reorderSchema,
  taskStatusSchema,
  tasksCreateSchema,
  taskTransitionSchema,
  taskUpdateSchema,
  type GoalCreateInput,
  type GoalUpdateInput,
  type ListInput,
  type TaskUpdateInput,
  type TasksCreateInput,
} from "@/shared/schemas/planning";
import { advanceSelectionOnTaskTransition } from "@/services/selection";
import { requestHashOf, withIdempotency } from "@/services/idempotency";
import {
  listPositionPage,
  renumberPositions,
  type Page,
} from "@/services/positioned-list";
import { lockScope, parsed, type Transaction } from "@/services/service-kit";

export type { Goal, Task } from "@/db/schema";
export type { Page } from "@/services/positioned-list";

/**
 * Goal and Task planning (PRD §3.1–3.2). Sessions and Tasks both hang
 * directly off Goals; there is no Track. Task transitions that touch the
 * current selection or guard open Sessions follow the global lock order:
 * sessions:running → app:selection → goal:{goalId}.
 */

export interface PlanningService {
  listGoals(
    context: AuthenticatedContext,
    input?: ListInput,
  ): Promise<Page<Goal>>;
  getGoal(context: AuthenticatedContext, id: string): Promise<Goal>;
  createGoal(
    context: AuthenticatedContext,
    input: GoalCreateInput,
  ): Promise<Goal>;
  updateGoal(
    context: AuthenticatedContext,
    input: GoalUpdateInput,
  ): Promise<Goal>;
  reorderGoals(context: AuthenticatedContext, ids: string[]): Promise<Goal[]>;
  listTasks(
    context: AuthenticatedContext,
    goalId: string,
    input?: ListInput,
  ): Promise<Page<Task>>;
  createTasks(
    context: AuthenticatedContext,
    input: TasksCreateInput,
  ): Promise<Task[]>;
  updateTask(
    context: AuthenticatedContext,
    input: TaskUpdateInput,
  ): Promise<Task>;
  reorderTasks(
    context: AuthenticatedContext,
    goalId: string,
    ids: string[],
  ): Promise<Task[]>;
  completeTask(context: AuthenticatedContext, id: string): Promise<Task>;
  skipTask(context: AuthenticatedContext, id: string): Promise<Task>;
  archiveTask(context: AuthenticatedContext, id: string): Promise<Task>;
  reopenTask(context: AuthenticatedContext, id: string): Promise<Task>;
}

async function ensureNoOpenSessionUnderGoal(
  tx: Transaction,
  context: AuthenticatedContext,
  goalId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        ownedBy(context, sessions),
        eq(sessions.goalId, goalId),
        inArray(sessions.status, ["active", "paused"] as const),
      ),
    )
    .limit(1);
  if (row)
    throw new DomainError(
      "PARENT_HAS_ACTIVE_SESSION",
      "Finish or cancel the running Session first.",
      { sessionId: row.id },
    );
}

async function ensureNoOpenSessionOnTask(
  tx: Transaction,
  context: AuthenticatedContext,
  taskId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        ownedBy(context, sessions),
        eq(sessions.taskId, taskId),
        inArray(sessions.status, ["active", "paused"] as const),
      ),
    )
    .limit(1);
  if (row)
    throw new DomainError(
      "PARENT_HAS_ACTIVE_SESSION",
      "The Task has an unfinished Session. Finish it first.",
      { sessionId: row.id },
    );
}

/** Load a Task with its Goal's status for validation. */
async function requireTaskWithGoal(
  tx: Transaction,
  context: AuthenticatedContext,
  id: string,
): Promise<{ task: Task; goal: Goal }> {
  const rows = await tx
    .select({ task: tasks, goal: goals })
    .from(tasks)
    .innerJoin(goals, eq(tasks.goalId, goals.id))
    .where(and(ownedBy(context, tasks), eq(tasks.id, id)))
    .limit(1);
  const row = rows[0];
  if (!row)
    throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
      taskId: id,
    });
  return row;
}

export function createPlanningService(database: Database): PlanningService {
  async function transition(
    context: AuthenticatedContext,
    id: string,
    status: "completed" | "skipped" | "archived",
  ): Promise<Task> {
    parsed(taskTransitionSchema.safeParse({ id }));
    return database.transaction(async (tx) => {
      // Open-Session guard and selection advance must serialize against
      // session_start — hence sessions:running first.
      await lockScope(tx, context, "sessions:running");

      const { task, goal } = await requireTaskWithGoal(tx, context, id);
      if (goal.status !== "active")
        throw new DomainError(
          "GOAL_NOT_ACTIVE",
          "Reactivate the Goal before changing its Tasks.",
          { goalId: goal.id },
        );
      if (task.status !== "pending")
        throw new DomainError(
          "TASK_NOT_PENDING",
          "Reopen the Task before changing its status.",
          { taskId: id },
        );
      // A Task with an unfinished Session cannot transition (PRD §3.2).
      await ensureNoOpenSessionOnTask(tx, context, id);

      const now = new Date();
      const [affected] = await tx
        .update(tasks)
        .set({
          status,
          completedAt: status === "completed" ? now : null,
          updatedAt: now,
        })
        .where(and(ownedBy(context, tasks), eq(tasks.id, id)))
        .returning();
      if (!affected)
        throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
          taskId: id,
        });

      // Selection advance in the same transaction: same-Goal next pending
      // by position → first pending → goal-only (PRD §5.2 rule 3).
      const remaining = await tx
        .select({ id: tasks.id, position: tasks.position })
        .from(tasks)
        .where(
          and(
            ownedBy(context, tasks),
            eq(tasks.goalId, task.goalId),
            eq(tasks.status, "pending"),
            sql`${tasks.position} > ${task.position}`,
          ),
        )
        .orderBy(asc(tasks.position))
        .limit(1);
      let nextTaskId = remaining[0]?.id ?? null;
      if (!nextTaskId) {
        const [firstPending] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              ownedBy(context, tasks),
              eq(tasks.goalId, task.goalId),
              eq(tasks.status, "pending"),
              ne(tasks.id, id),
            ),
          )
          .orderBy(asc(tasks.position))
          .limit(1);
        nextTaskId = firstPending?.id ?? null;
      }
      await advanceSelectionOnTaskTransition(tx, context, {
        goalId: task.goalId,
        taskId: id,
        nextTaskId,
      });

      return affected;
    });
  }

  return {
    async listGoals(context, input = {}) {
      requireUserId(context);
      const query = parsed(listSchema.safeParse(input));
      const status = query.status
        ? parsed(parentStatusSchema.safeParse(query.status))
        : undefined;
      return listPositionPage(database, goals, {
        scope: [ownedBy(context, goals)],
        filters: [
          ...(status
            ? [eq(goals.status, status)]
            : query.includeArchived
              ? []
              : [eq(goals.status, "active" as const)]),
        ],
        cursor: query.cursor,
        limit: query.limit,
      });
    },

    async getGoal(context, id) {
      requireUserId(context);
      const [goal] = await database
        .select()
        .from(goals)
        .where(and(ownedBy(context, goals), eq(goals.id, id)))
        .limit(1);
      if (!goal)
        throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", {
          goalId: id,
        });
      return goal;
    },

    async createGoal(context, input) {
      requireUserId(context);
      const value = parsed(goalCreateSchema.safeParse(input));
      const requestHash = requestHashOf({
        title: value.title,
        description: value.description ?? null,
      });
      return database.transaction(async (tx) => {
        await lockScope(tx, context, "goals:order");
        return withIdempotency({
          context,
          tx,
          operation: "goal_create",
          key: value.idempotencyKey,
          requestHash,
          replay: async (recorded) => {
            const goalId = (recorded as { goalId?: string } | null)?.goalId;
            if (!goalId) return null;
            const [goal] = await tx
              .select()
              .from(goals)
              .where(and(ownedBy(context, goals), eq(goals.id, goalId)))
              .limit(1);
            return goal ?? null;
          },
          run: async () => {
            const [last] = await tx
              .select({ position: goals.position })
              .from(goals)
              .where(ownedBy(context, goals))
              .orderBy(sql`${goals.position} desc`)
              .limit(1);
            const [goal] = await tx
              .insert(goals)
              .values({
                userId: context.userId,
                title: value.title,
                description: value.description ?? null,
                position: (last?.position ?? 0) + 1,
              })
              .returning();
            return {
              value: goal!,
              result: { goalId: goal!.id },
              resultRef: goal!.id,
            };
          },
        });
      });
    },

    async updateGoal(context, input) {
      requireUserId(context);
      const value = parsed(goalUpdateSchema.safeParse(input));
      return database.transaction(async (tx) => {
        await lockScope(tx, context, "sessions:running");
        await lockScope(tx, context, `goal:${value.id}`);
        const [existing] = await tx
          .select()
          .from(goals)
          .where(and(ownedBy(context, goals), eq(goals.id, value.id)))
          .limit(1);
        if (!existing)
          throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", {
            goalId: value.id,
          });
        if (
          existing.status !== "active" &&
          (value.title !== undefined || value.description !== undefined)
        )
          throw new DomainError(
            "GOAL_NOT_ACTIVE",
            "Reactivate the Goal before editing it.",
            { goalId: value.id },
          );
        if (
          value.status &&
          value.status !== "active" &&
          value.status !== existing.status
        )
          await ensureNoOpenSessionUnderGoal(tx, context, value.id);
        const [goal] = await tx
          .update(goals)
          .set({ ...value, id: undefined, updatedAt: new Date() })
          .where(and(ownedBy(context, goals), eq(goals.id, value.id)))
          .returning();
        return goal!;
      });
    },

    async reorderGoals(context, ids) {
      requireUserId(context);
      const value = parsed(reorderSchema.safeParse({ ids }));
      return database.transaction(async (tx) => {
        await lockScope(tx, context, "goals:order");
        await renumberPositions(tx, goals, value.ids, ownedBy(context, goals));
        return tx
          .select()
          .from(goals)
          .where(ownedBy(context, goals))
          .orderBy(asc(goals.position));
      });
    },

    async listTasks(context, goalId, input = {}) {
      requireUserId(context);
      await this.getGoal(context, goalId);
      const query = parsed(listSchema.safeParse(input));
      const status = query.status
        ? parsed(taskStatusSchema.safeParse(query.status))
        : undefined;
      return listPositionPage(database, tasks, {
        scope: [ownedBy(context, tasks), eq(tasks.goalId, goalId)],
        filters: [
          ...(status
            ? [eq(tasks.status, status)]
            : query.includeArchived
              ? []
              : [ne(tasks.status, "archived" as const)]),
        ],
        cursor: query.cursor,
        limit: query.limit,
      });
    },

    async createTasks(context, input) {
      requireUserId(context);
      const value = parsed(tasksCreateSchema.safeParse(input));
      const requestHash = requestHashOf({
        goalId: value.goalId,
        tasks: value.tasks,
      });
      return database.transaction(async (tx) => {
        await lockScope(tx, context, `goal:${value.goalId}`);
        const [goal] = await tx
          .select()
          .from(goals)
          .where(and(ownedBy(context, goals), eq(goals.id, value.goalId)))
          .limit(1);
        if (!goal)
          throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", {
            goalId: value.goalId,
          });
        if (goal.status !== "active")
          throw new DomainError(
            "GOAL_NOT_ACTIVE",
            "Reactivate the Goal before adding Tasks.",
            { goalId: goal.id },
          );

        return withIdempotency({
          context,
          tx,
          operation: "tasks_create",
          key: value.idempotencyKey,
          requestHash,
          replay: async (recorded) => {
            const taskIds =
              (recorded as { taskIds?: string[] } | null)?.taskIds ?? [];
            if (!taskIds.length) return null;
            return tx
              .select()
              .from(tasks)
              .where(and(ownedBy(context, tasks), inArray(tasks.id, taskIds)))
              .orderBy(asc(tasks.position));
          },
          run: async () => {
            const [last] = await tx
              .select({ position: tasks.position })
              .from(tasks)
              .where(
                and(ownedBy(context, tasks), eq(tasks.goalId, value.goalId)),
              )
              .orderBy(sql`${tasks.position} desc`)
              .limit(1);
            const created = await tx
              .insert(tasks)
              .values(
                value.tasks.map((task, index) => ({
                  ...task,
                  description: task.description ?? null,
                  estimatedMinutes: task.estimatedMinutes ?? null,
                  initialEstimatedMinutes: task.estimatedMinutes ?? null,
                  resourceType: task.resourceType ?? null,
                  resourceValue: task.resourceValue ?? null,
                  note: task.note ?? null,
                  goalId: value.goalId,
                  position: (last?.position ?? 0) + index + 1,
                })),
              )
              .returning();
            // Creating Tasks never touches the selection (PRD §3.2 / §5.2):
            // a stored goal-only choice survives new Tasks.
            return {
              value: created,
              result: { taskIds: created.map((task) => task.id) },
              resultRef: created[0]?.id ?? null,
            };
          },
        });
      });
    },

    async updateTask(context, input) {
      requireUserId(context);
      const value = parsed(taskUpdateSchema.safeParse(input));
      return database.transaction(async (tx) => {
        const { task, goal } = await requireTaskWithGoal(tx, context, value.id);
        await lockScope(tx, context, `goal:${task.goalId}`);
        if (goal.status !== "active")
          throw new DomainError(
            "GOAL_NOT_ACTIVE",
            "Reactivate the Goal before editing its Tasks.",
            { goalId: goal.id },
          );
        if (task.status !== "pending")
          throw new DomainError(
            "TASK_NOT_PENDING",
            "Reopen the Task before editing it.",
            { taskId: value.id },
          );
        const [updated] = await tx
          .update(tasks)
          .set({
            ...value,
            id: undefined,
            ...(value.estimatedMinutes != null
              ? {
                  initialEstimatedMinutes: sql`coalesce(${tasks.initialEstimatedMinutes}, ${value.estimatedMinutes})`,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(and(ownedBy(context, tasks), eq(tasks.id, value.id)))
          .returning();
        return updated!;
      });
    },

    async reorderTasks(context, goalId, ids) {
      requireUserId(context);
      const value = parsed(reorderSchema.safeParse({ parentId: goalId, ids }));
      return database.transaction(async (tx) => {
        await lockScope(tx, context, `goal:${goalId}`);
        const [goal] = await tx
          .select()
          .from(goals)
          .where(and(ownedBy(context, goals), eq(goals.id, goalId)))
          .limit(1);
        if (!goal)
          throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", {
            goalId,
          });
        if (goal.status !== "active")
          throw new DomainError(
            "GOAL_NOT_ACTIVE",
            "Reactivate the Goal before reordering its Tasks.",
            { goalId },
          );
        await renumberPositions(
          tx,
          tasks,
          value.ids,
          and(ownedBy(context, tasks), eq(tasks.goalId, goalId)),
        );
        // Reordering keeps a still-valid explicit selection (PRD §3.2).
        return tx
          .select()
          .from(tasks)
          .where(and(ownedBy(context, tasks), eq(tasks.goalId, goalId)))
          .orderBy(asc(tasks.position));
      });
    },

    async completeTask(context, id) {
      requireUserId(context);
      return transition(context, id, "completed");
    },
    async skipTask(context, id) {
      requireUserId(context);
      return transition(context, id, "skipped");
    },
    async archiveTask(context, id) {
      requireUserId(context);
      return transition(context, id, "archived");
    },

    async reopenTask(context, id) {
      requireUserId(context);
      parsed(taskTransitionSchema.safeParse({ id }));
      return database.transaction(async (tx) => {
        const { task, goal } = await requireTaskWithGoal(tx, context, id);
        await lockScope(tx, context, `goal:${task.goalId}`);
        if (goal.status !== "active")
          throw new DomainError(
            "GOAL_NOT_ACTIVE",
            "Reactivate the Goal before reopening its Tasks.",
            { goalId: goal.id },
          );
        const [reopened] = await tx
          .update(tasks)
          .set({ status: "pending", completedAt: null, updatedAt: new Date() })
          .where(and(ownedBy(context, tasks), eq(tasks.id, id)))
          .returning();
        if (!reopened)
          throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
            taskId: id,
          });
        // Reopen never takes over the selection (PRD §3.2).
        return reopened;
      });
    },
  };
}

export { ensureNoOpenSessionUnderGoal };
