import { HistoryView } from "@/components/history-view";
import { historyService, settingsService, statisticsService } from "@/services";
import { reportRange, type ReportPeriod } from "@/shared/report-period";
import { localDateKey, localDateStart } from "@/shared/timezone";

interface HistorySearchParams {
  goalId?: string;
  period?: string;
  date?: string;
  includeCancelled?: string;
  cursor?: string;
  taskCursor?: string;
}
export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: Promise<HistorySearchParams>;
}) {
  const query = (await searchParams) ?? {};
  const context = { actor: "web" } as const;
  const settings = await settingsService.get(context);
  const now = new Date();
  const todayKey = localDateKey(now, settings.timezone);
  const [y, m] = todayKey.split("-").map(Number);
  const firstMonth = new Date(Date.UTC(y!, m! - 12, 1));
  const lastMonth = new Date(Date.UTC(y!, m!, 1));
  const dateKey = (d: Date) => d.toISOString().slice(0, 10);
  const goalId = query.goalId;
  const common = {
    goalId,
    now: now.toISOString(),
    timezone: settings.timezone,
    weekStartsOn: settings.weekStartsOn,
  };
  const period: ReportPeriod = ["day", "week", "month", "year"].includes(
    query.period ?? "",
  )
    ? (query.period as ReportPeriod)
    : "week";
  let date = query.date ?? todayKey;
  try {
    localDateStart(date, settings.timezone);
  } catch {
    date = todayKey;
  }
  const range = reportRange(
    period,
    date,
    settings.timezone,
    settings.weekStartsOn as 0 | 1,
  );
  const bounds = {
    from: range.start.toISOString(),
    to: range.end.toISOString(),
  };
  const [all, week, calendar, page, targets, completed, report] =
    await Promise.all([
      statisticsService.getStatistics(context, { ...common, period: "all" }),
      statisticsService.getStatistics(context, { ...common, period: "week" }),
      statisticsService.getStatistics(context, {
        ...common,
        period: "custom",
        from: localDateStart(
          dateKey(firstMonth),
          settings.timezone,
        ).toISOString(),
        to: localDateStart(dateKey(lastMonth), settings.timezone).toISOString(),
        daily: true,
      }),
      historyService.listSessions(context, {
        goalId,
        ...bounds,
        dateMode: query.includeCancelled === "true" ? "started" : "focus",
        now: common.now,
        includeCancelled: query.includeCancelled === "true",
        cursor: query.cursor,
      }),
      historyService.listTargets(context),
      historyService.listCompletedTasks(context, {
        now: now.toISOString(),
        goalId,
        ...bounds,
        cursor: query.taskCursor,
      }),
      statisticsService.getStatistics(context, {
        ...common,
        ...bounds,
        period: "custom",
        daily: true,
      }),
    ]);
  return (
    <HistoryView
      key={`${goalId ?? "all"}:${now.toISOString()}`}
      report={report}
      period={period}
      date={date}
      all={all}
      week={week}
      calendar={calendar}
      page={page}
      targets={targets}
      completed={completed}
      selectedGoalId={goalId}
      includeCancelled={query.includeCancelled === "true"}
    />
  );
}
