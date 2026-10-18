import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Statistics } from "@/services/statistics";
import { localDateKey } from "@/shared/timezone";
import { durationLabel } from "@/shared/duration-label";
import { shiftReportDate, type ReportPeriod } from "@/shared/report-period";

export function PeriodReport({
  stats,
  period,
  date,
  goalId,
}: {
  stats: Statistics;
  period: ReportPeriod;
  date: string;
  goalId?: string;
}) {
  const href = (
    nextPeriod: ReportPeriod,
    nextDate: string,
    targetGoal = goalId,
  ) => {
    const q = new URLSearchParams({ period: nextPeriod, date: nextDate });
    if (targetGoal) q.set("goalId", targetGoal);
    return `/history?${q}`;
  };
  const months = new Map<string, number>();
  for (const day of stats.daily)
    months.set(
      day.date.slice(0, 7),
      (months.get(day.date.slice(0, 7)) ?? 0) + day.focusSeconds,
    );
  const buckets =
    period === "year"
      ? [...months].map(([key, seconds]) => ({
          date: `${key}-01`,
          seconds,
          label: `${Number(key.slice(5))}月`,
        }))
      : stats.daily.map((d) => ({
          date: d.date,
          seconds: d.focusSeconds,
          label: `${Number(d.date.slice(8))}日`,
        }));
  const max = Math.max(1, ...buckets.map((d) => d.seconds));
  return (
    <section aria-label="周期分析" className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav aria-label="统计周期" className="bg-muted flex rounded-lg p-1">
          {(
            [
              ["day", "日"],
              ["week", "周"],
              ["month", "月"],
              ["year", "年"],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={href(value, date)}
              aria-current={period === value ? "page" : undefined}
              className={`min-w-12 rounded-md px-4 py-2 text-center text-sm ${period === value ? "bg-card text-primary font-semibold shadow-sm" : "text-muted-foreground"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            aria-label="上一个周期"
            href={href(period, shiftReportDate(date, period, -1))}
            className="border-border rounded-lg border p-2"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <span className="text-sm font-medium">
            {period === "year"
              ? `${date.slice(0, 4)} 年`
              : period === "month"
                ? date.slice(0, 7)
                : `${stats.daily[0]?.date ?? date}${period === "week" ? ` — ${stats.daily.at(-1)?.date ?? date}` : ""}`}
          </span>
          <Link
            aria-label="下一个周期"
            href={href(period, shiftReportDate(date, period, 1))}
            className="border-border rounded-lg border p-2"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>
      <form
        action="/history"
        method="get"
        className="flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="period" value={period} />
        {goalId && <input type="hidden" name="goalId" value={goalId} />}
        <label htmlFor="report-date" className="text-muted-foreground text-xs">
          查看日期
        </label>
        <input
          id="report-date"
          type="date"
          name="date"
          defaultValue={date}
          required
          className="border-input bg-card min-h-10 rounded-lg border px-3 text-sm"
        />
        <button
          type="submit"
          className="border-border min-h-10 rounded-lg border px-4 text-sm"
        >
          查看
        </button>
        <Link
          href={href(
            period,
            localDateKey(new Date(stats.serverNow), stats.timezone),
          )}
          className="text-primary text-sm"
        >
          回到当前周期
        </Link>
      </form>
      <div className="border-border grid grid-cols-2 gap-6 border-y py-6 sm:grid-cols-4">
        {[
          ["实际投入", durationLabel(stats.totalFocusSeconds)],
          ["完成任务", `${stats.completedTaskCount} 件`],
          ["执行次数", `${stats.sessionCount} 次`],
          ["有投入的日子", `${stats.focusDays ?? 0} 天`],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-muted-foreground text-xs">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      {period !== "day" && (
        <div>
          <h2 className="mb-4 text-sm font-medium">投入趋势</h2>
          <div
            className="border-border flex h-40 items-end gap-1 overflow-x-auto border-b pb-1"
            aria-label="投入趋势图"
          >
            {buckets.map((bucket) => (
              <Link
                key={bucket.date}
                href={href(period === "year" ? "month" : "day", bucket.date)}
                title={`${bucket.date} · ${durationLabel(bucket.seconds)}`}
                aria-label={`${bucket.date}，${durationLabel(bucket.seconds)}，查看详情`}
                className="group flex h-full min-w-5 flex-1 flex-col items-center justify-end gap-2"
              >
                <span
                  className="bg-primary/75 group-hover:bg-primary w-full max-w-12 rounded-t-sm"
                  style={{
                    height: `${Math.max(bucket.seconds > 0 ? 3 : 0, (bucket.seconds / max) * 100)}px`,
                  }}
                />
                <span className="text-muted-foreground text-[10px]">
                  {bucket.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {stats.byGoal.length > 0 && (
        <section aria-label="周期目标投入">
          <h2 className="mb-4 text-sm font-medium">目标投入</h2>
          <ul className="space-y-4">
            {stats.byGoal.map((goal) => (
              <li key={goal.goalId}>
                <Link
                  href={href(period, date, goal.goalId)}
                  className="flex justify-between gap-4 text-sm"
                >
                  <span className="min-w-0 break-words">{goal.title}</span>
                  <span className="shrink-0 tabular-nums">
                    {durationLabel(goal.focusSeconds)}
                  </span>
                </Link>
                <div className="bg-muted mt-2 h-1 rounded-full">
                  <div
                    className="bg-primary h-1 rounded-full"
                    style={{
                      width: `${stats.totalFocusSeconds ? (goal.focusSeconds / stats.totalFocusSeconds) * 100 : 0}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
