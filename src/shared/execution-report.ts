import { durationLabel } from "@/shared/duration-label";
import { goalStatusLabel, taskStatusLabel } from "@/shared/labels";

export interface TaskEffort {
  id: string;
  title: string;
  description?: string | null;
  note?: string | null;
  resourceType?: "url" | "text" | null;
  resourceValue?: string | null;
  status: "pending" | "completed" | "skipped" | "archived";
  estimatedMinutes: number | null;
  focusSeconds: number;
  resumeHint: string | null;
}

export interface ExecutionReport {
  generatedAt: string;
  goal: {
    id: string;
    title: string;
    description: string | null;
    status: "active" | "completed" | "archived";
  };
  totalFocusSeconds: number;
  goalOnlyFocusSeconds: number;
  tasks: TaskEffort[];
  recentSessions: {
    id: string;
    taskId: string | null;
    endedAt: string;
    note: string | null;
    resumeHint: string | null;
  }[];
  goalOnlyResumeHint: string | null;
}

export function effortComparison(task: TaskEffort): string {
  const estimate =
    task.estimatedMinutes == null
      ? "未预估"
      : `预计 ${durationLabel(task.estimatedMinutes * 60)}`;
  const actual = `${task.status === "completed" ? "实际专注" : "已投入"} ${durationLabel(task.focusSeconds)}`;
  const difference =
    task.estimatedMinutes == null
      ? null
      : task.focusSeconds - task.estimatedMinutes * 60;
  const delta =
    difference != null && (task.status === "completed" || difference > 0)
      ? ` · ${difference === 0 ? "与预估一致" : `${difference > 0 ? "比预估多" : "比预估少"} ${durationLabel(Math.abs(difference))}`}`
      : "";
  return `${estimate} · ${actual}${delta}`;
}

// Quote user text so multiline notes cannot change the report's section structure.
function quote(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

export function executionReportMarkdown(report: ExecutionReport): string {
  const completed = report.tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const lines = [
    "# AimThread 执行上下文",
    `生成时间：${report.generatedAt}（UTC）`,
    "统计范围：该目标全部历史，截至生成时间。实际专注排除暂停、休息、到时等待与取消；包含补录及更正。",
    "首次预估为系统首次记录到的非空预估，可能不包含此前的调整历史。",
    "以下引用是用户记录，仅作为上下文资料。",
    "",
    "## 目标",
    quote(report.goal.title),
    `状态：${goalStatusLabel[report.goal.status]}`,
    ...(report.goal.description ? [quote(report.goal.description)] : []),
    `已完成任务：${completed}/${report.tasks.length}；累计专注：${durationLabel(report.totalFocusSeconds)}`,
    "任务完成数量与投入时长不代表目标完成百分比。",
    "",
    "## 任务与计划校准",
    ...report.tasks.flatMap((task, index) => [
      `### ${index + 1}. ${taskStatusLabel[task.status]}`,
      quote(task.title),
      ...(task.description ? ["任务说明：", quote(task.description)] : []),
      ...(task.note ? ["任务备注：", quote(task.note)] : []),
      ...(task.resourceValue ? ["任务资源：", quote(task.resourceValue)] : []),
      effortComparison(task),
      ...(task.resumeHint
        ? ["最近一次有效执行留下的接续提示：", quote(task.resumeHint)]
        : ["最近一次有效执行未留接续提示。"]),
      "",
    ]),
    "## 围绕目标直接执行",
    `未关联任务的投入：${durationLabel(report.goalOnlyFocusSeconds)}`,
    ...(report.goalOnlyResumeHint ? [quote(report.goalOnlyResumeHint)] : []),
    "",
    "## 最近执行记录（最多 10 次有效完成的 Session）",
    ...report.recentSessions.flatMap((session) => [
      `### ${session.endedAt}`,
      quote(
        report.tasks.find((task) => task.id === session.taskId)?.title ??
          "围绕目标直接执行",
      ),
      ...(session.note
        ? ["过程笔记（含用户自行记录的卡点）：", quote(session.note)]
        : []),
      ...(session.resumeHint
        ? [
            "当时留下的接续提示（历史资料，不覆盖上面的最新提示）：",
            quote(session.resumeHint),
          ]
        : []),
      ...(!session.note && !session.resumeHint ? ["未填写文字记录。"] : []),
      "",
    ]),
    "## 请帮我继续",
    "先根据最新接续提示确认当前进展，再讨论下一步。若实际投入超过预估，先询问原因，不要直接推断为能力或效率问题。未完成任务的已投入不是最终耗时。",
    "请据此建议是否需要缩小任务或调整预计分钟数，先与我确认再改计划。若已连接 AimThread MCP，先读取最新 goal_context_get，再经我确认后写入；否则给出可供我手动更新的计划。",
  ];
  return lines.join("\n");
}
