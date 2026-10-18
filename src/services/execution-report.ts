import { ownedBy } from "@/services/ownership";
import { and, asc, desc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { requireUserId, type AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import { goals, sessions, tasks } from "@/db/schema";
import { focusSecondsSql } from "@/services/focus-query";
import { parsed } from "@/services/service-kit";
import { DomainError } from "@/shared/domain-error";
import {
  executionReportMarkdown,
  type ExecutionReport,
} from "@/shared/execution-report";

export const goalContextQuerySchema = z
  .object({ goalId: z.string().uuid() })
  .strict();
export interface ExecutionReportService {
  getTaskFocusSeconds(
    context: AuthenticatedContext,
    goalIds: string[],
  ): Promise<Record<string, number>>;
  getGoalContext(
    context: AuthenticatedContext,
    input: { goalId: string },
  ): Promise<{ report: ExecutionReport; markdown: string }>;
}

export function createExecutionReportService(
  database: Database,
): ExecutionReportService {
  return {
    async getTaskFocusSeconds(context, input) {
      requireUserId(context);
      const goalIds = parsed(
        z.array(z.string().uuid()).max(100).safeParse(input),
      );
      if (!goalIds.length) return {};
      const now = new Date();
      const result = await database.execute<{
        task_id: string;
        focus_seconds: string;
      }>(sql`
        select s.task_id, coalesce(sum(${focusSecondsSql(sql`s`, sql`'-infinity'::timestamptz`, sql`${now}::timestamptz`, now)}), 0)::text as focus_seconds
        from sessions s where s.user_id = ${context.userId} and s.goal_id in (${sql.join(
          goalIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) and s.task_id is not null group by s.task_id
      `);
      return Object.fromEntries(
        result.rows.map((row) => [row.task_id, Number(row.focus_seconds)]),
      );
    },
    async getGoalContext(context, input) {
      requireUserId(context);
      const { goalId } = parsed(goalContextQuerySchema.safeParse(input));
      return database.transaction(
        async (tx) => {
          const now = new Date();
          const [goal] = await tx
            .select()
            .from(goals)
            .where(and(ownedBy(context, goals), eq(goals.id, goalId)));
          if (!goal)
            throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", {
              goalId,
            });
          const taskRows = await tx
            .select()
            .from(tasks)
            .where(and(ownedBy(context, tasks), eq(tasks.goalId, goalId)))
            .orderBy(asc(tasks.position));
          const effort = await tx.execute<{
            task_id: string | null;
            focus_seconds: string;
          }>(sql`
          select s.task_id, coalesce(sum(${focusSecondsSql(sql`s`, sql`'-infinity'::timestamptz`, sql`${now}::timestamptz`, now)}), 0)::text as focus_seconds
          from sessions s where s.user_id = ${context.userId} and s.goal_id = ${goalId} group by s.task_id
        `);
          const byTask = new Map(
            effort.rows.map((row) => [row.task_id, Number(row.focus_seconds)]),
          );
          const effectiveCompleted = and(
            eq(sessions.goalId, goalId),
            eq(sessions.status, "completed"),
            gt(sessions.durationSeconds, 0),
            isNotNull(sessions.endedAt),
            lte(sessions.endedAt, now),
          );
          const latest = await tx
            .selectDistinctOn([sessions.taskId], {
              taskId: sessions.taskId,
              resumeHint: sessions.resumeHint,
            })
            .from(sessions)
            .where(and(ownedBy(context, sessions), effectiveCompleted))
            .orderBy(
              sessions.taskId,
              desc(sessions.endedAt),
              desc(sessions.startedAt),
              desc(sessions.id),
            );
          const hints = new Map(
            latest.map((row) => [row.taskId, row.resumeHint]),
          );
          const recent = await tx
            .select({
              id: sessions.id,
              taskId: sessions.taskId,
              endedAt: sessions.endedAt,
              note: sessions.note,
              resumeHint: sessions.resumeHint,
            })
            .from(sessions)
            .where(and(ownedBy(context, sessions), effectiveCompleted))
            .orderBy(
              desc(sessions.endedAt),
              desc(sessions.startedAt),
              desc(sessions.id),
            )
            .limit(10);
          const report: ExecutionReport = {
            generatedAt: now.toISOString(),
            goal: {
              id: goal.id,
              title: goal.title,
              description: goal.description,
              status: goal.status,
            },
            totalFocusSeconds: [...byTask.values()].reduce(
              (sum, seconds) => sum + seconds,
              0,
            ),
            goalOnlyFocusSeconds: byTask.get(null) ?? 0,
            goalOnlyResumeHint: hints.get(null) ?? null,
            tasks: taskRows.map((task) => ({
              id: task.id,
              title: task.title,
              description: task.description,
              note: task.note,
              resourceType: task.resourceType,
              resourceValue: task.resourceValue,
              status: task.status,
              estimatedMinutes: task.estimatedMinutes,
              focusSeconds: byTask.get(task.id) ?? 0,
              resumeHint: hints.get(task.id) ?? null,
            })),
            recentSessions: recent.map((session) => ({
              ...session,
              endedAt: session.endedAt!.toISOString(),
            })),
          };
          return { report, markdown: executionReportMarkdown(report) };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
