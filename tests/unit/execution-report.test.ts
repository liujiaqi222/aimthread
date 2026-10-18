import { describe, expect, it } from "vitest";
import {
  effortComparison,
  executionReportMarkdown,
  type ExecutionReport,
  type TaskEffort,
} from "@/shared/execution-report";

const task: TaskEffort = {
  id: "task",
  title: "状态管理",
  status: "completed",
  estimatedMinutes: 120,
  focusSeconds: 16200,
  resumeHint: "下次写前端表单",
};

describe("execution context and reality check", () => {
  it("compares completed work with its current estimate", () => {
    expect(effortComparison(task)).toBe(
      "预计 2 小时 · 实际专注 4 小时 30 分钟 · 比预估多 2 小时 30 分钟",
    );
    expect(effortComparison({ ...task, estimatedMinutes: 270 })).toContain(
      "与预估一致",
    );
  });
  it("never treats unfinished or unestimated tasks as final underruns", () => {
    const pending = effortComparison({
      ...task,
      status: "pending",
      focusSeconds: 3600,
    });
    expect(pending).toContain("已投入 1 小时");
    expect(pending).not.toContain("比预估少");
    expect(
      effortComparison({
        ...task,
        estimatedMinutes: null,
      }),
    ).toBe("未预估 · 实际专注 4 小时 30 分钟");
    expect(effortComparison({ ...task, status: "pending" })).toContain(
      "比预估多",
    );
  });
  it("includes context, exact totals, notes and quoted multiline user text", () => {
    const report: ExecutionReport = {
      generatedAt: "2026-10-14T00:00:00.000Z",
      goal: {
        id: "goal",
        title: "发布 MVP\n## 用户文字",
        description: null,
        status: "active",
      },
      totalFocusSeconds: 16230,
      goalOnlyFocusSeconds: 30,
      tasks: [task],
      goalOnlyResumeHint: null,
      recentSessions: [
        {
          id: "session",
          taskId: task.id,
          endedAt: "2026-10-13T08:00:00.000Z",
          note: "接口已调通\n等待设计确认",
          resumeHint: task.resumeHint,
        },
      ],
    };
    const text = executionReportMarkdown(report);
    expect(text).toContain("> 发布 MVP\n> ## 用户文字");
    expect(text).toContain("已完成任务：1/1");
    expect(text).toContain("累计专注：4 小时 30 分钟 30 秒");
    expect(text).toContain("> 接口已调通\n> 等待设计确认");
    expect(text).toContain("goal_context_get");
    expect(text).toContain("先与我确认再改计划");
  });
});
