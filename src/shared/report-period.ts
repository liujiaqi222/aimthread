import {
  addLocalDays,
  getLocalPeriodInterval,
  localDateStart,
  localDateKey,
} from "@/shared/timezone";
export type ReportPeriod = "day" | "week" | "month" | "year";
export function reportRange(
  period: ReportPeriod,
  date: string,
  timezone: string,
  weekStartsOn: 0 | 1,
) {
  const anchor = localDateStart(date, timezone);
  const range = getLocalPeriodInterval(
    period === "day" ? "today" : period,
    anchor,
    timezone,
    weekStartsOn,
  );
  return {
    ...range,
    first: localDateKey(range.start, timezone),
    last: localDateKey(range.end, timezone),
  };
}
export function shiftReportDate(
  date: string,
  period: ReportPeriod,
  direction: number,
) {
  if (period === "day" || period === "week")
    return addLocalDays(date, direction * (period === "day" ? 1 : 7));
  const [year, month] = date.split("-").map(Number);
  return new Date(
    Date.UTC(
      year! + (period === "year" ? direction : 0),
      month! - 1 + (period === "month" ? direction : 0),
      1,
    ),
  )
    .toISOString()
    .slice(0, 10);
}
