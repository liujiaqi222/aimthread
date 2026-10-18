import { describe, expect, it } from "vitest";
import type { FocusInterval, SessionPhase } from "@/db/schema";
import { focusRoundRecords } from "@/shared/history-rounds";
import { reportRange, shiftReportDate } from "@/shared/report-period";
import { statsQuerySchema } from "@/shared/schemas/session";

const time = (minutes: number) => new Date(Date.UTC(2026, 9, 12, 23, minutes));
const phase = (id: string, start: number): SessionPhase => ({
  id,
  sessionId: "s",
  kind: "focus",
  sequence: start + 1,
  startedAt: time(start),
  endedAt: null,
  deadlineAt: time(start + 25),
  pausedAt: null,
  remainingMs: 1500000,
  complete: false,
  advanceAction: null,
  nextPhaseId: null,
});
const interval = (
  phaseId: string,
  start: number,
  end: number | null,
  deadline: number,
): FocusInterval => ({
  id: `${phaseId}:${start}`,
  sessionId: "s",
  phaseId,
  phase: "focus",
  startedAt: time(start),
  endedAt: end === null ? null : time(end),
  deadlineAt: time(deadline),
  createdAt: time(start),
  updatedAt: time(start),
});

describe("redesign time accounting", () => {
  it("groups paused intervals into one round and excludes breaks/waiting", () => {
    const rounds = focusRoundRecords(
      [phase("a", 0), phase("b", 40)],
      [
        interval("a", 0, 10, 25),
        interval("a", 15, 30, 30),
        interval("b", 40, null, 65),
        { ...interval("break", 30, 40, 40), phase: "short_break" },
      ],
      time(100),
    );
    expect(rounds.map((r) => r.focusSeconds)).toEqual([1500, 1500]);
    expect(rounds[0].intervals).toHaveLength(2);
    expect(rounds[1].endedAt).toEqual(time(65));
  });
  it("clips a cross-midnight round to the requested day without duplicating duration", () => {
    const phases = [phase("a", 50)];
    const intervals = [interval("a", 50, 75, 75)];
    const left = focusRoundRecords(phases, intervals, time(100), {
      start: time(0),
      end: time(60),
    });
    const right = focusRoundRecords(phases, intervals, time(100), {
      start: time(60),
      end: time(120),
    });
    expect(left[0].focusSeconds).toBe(600);
    expect(right[0].focusSeconds).toBe(900);
    expect(left[0].focusSeconds + right[0].focusSeconds).toBe(1500);
  });
  it("conserves fractional seconds instead of rounding every round down", () => {
    const intervals = [interval("a", 0, 1, 25), interval("b", 2, 3, 27)];
    intervals[0].endedAt = new Date(time(0).getTime() + 1600);
    intervals[1].endedAt = new Date(time(2).getTime() + 1600);
    const rounds = focusRoundRecords(
      [phase("a", 0), phase("b", 2)],
      intervals,
      time(10),
    );
    expect(rounds.map((r) => r.focusSeconds)).toEqual([1, 2]);
    expect(rounds.reduce((sum, r) => sum + r.focusSeconds, 0)).toBe(3);
  });
  it("does not invent a visible round for a zero-duration mis-start", () => {
    expect(
      focusRoundRecords([phase("a", 0)], [interval("a", 0, 0, 25)], time(10)),
    ).toEqual([]);
  });
  it("uses a full natural leap year with timezone boundaries", () => {
    const range = reportRange("year", "2024-06-15", "America/New_York", 1);
    expect(range.first).toBe("2024-01-01");
    expect(range.last).toBe("2025-01-01");
    expect((range.end.getTime() - range.start.getTime()) / 86400000).toBe(366);
    expect(
      statsQuerySchema.safeParse({
        period: "custom",
        from: range.start.toISOString(),
        to: range.end.toISOString(),
      }).success,
    ).toBe(true);
  });
  it("steps month and year without end-of-month overflow", () => {
    expect(shiftReportDate("2024-01-31", "month", 1)).toBe("2024-02-01");
    expect(shiftReportDate("2024-02-29", "year", 1)).toBe("2025-02-01");
    expect(shiftReportDate("2026-01-01", "week", -1)).toBe("2025-12-25");
  });
});
