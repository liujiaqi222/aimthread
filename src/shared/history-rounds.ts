import type { FocusInterval, SessionPhase } from "@/db/schema";

export interface FocusRoundRecord {
  id: string;
  round: number;
  startedAt: Date;
  endedAt: Date;
  focusSeconds: number;
  intervals: { startedAt: Date; endedAt: Date }[];
}

/** One phase is one round; cumulative rounding conserves seconds across rounds/days. */
export function focusRoundRecords(
  phases: SessionPhase[],
  intervals: FocusInterval[],
  now: Date,
  range?: { start: Date; end: Date },
): FocusRoundRecord[] {
  let cumulativeMs = 0;
  const pieces = intervals
    .filter((i) => i.phase === "focus")
    .sort(
      (a, b) =>
        new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((i) => {
      const rawStart = new Date(i.startedAt).getTime();
      const rawEnd = Math.max(
        rawStart,
        Math.min(
          new Date(i.endedAt ?? i.deadlineAt ?? now).getTime(),
          now.getTime(),
          i.deadlineAt ? new Date(i.deadlineAt).getTime() : Infinity,
        ),
      );
      const start = Math.min(
        rawEnd,
        Math.max(rawStart, range?.start.getTime() ?? -Infinity),
      );
      const end = Math.max(
        start,
        Math.min(rawEnd, range?.end.getTime() ?? Infinity),
      );
      const seconds =
        Math.floor((cumulativeMs + end - rawStart) / 1000) -
        Math.floor((cumulativeMs + start - rawStart) / 1000);
      cumulativeMs += rawEnd - rawStart;
      return {
        phaseId: i.phaseId,
        startedAt: new Date(start),
        endedAt: new Date(end),
        seconds,
      };
    })
    .filter((i) => i.endedAt > i.startedAt);
  return phases
    .filter((p) => p.kind === "focus")
    .map((phase, index) => {
      const matching = pieces.filter((i) => i.phaseId === phase.id);
      return {
        id: phase.id,
        round: index + 1,
        startedAt: matching[0]?.startedAt ?? new Date(phase.startedAt),
        endedAt: matching.at(-1)?.endedAt ?? new Date(phase.startedAt),
        focusSeconds: matching.reduce((sum, i) => sum + i.seconds, 0),
        intervals: matching.map(({ startedAt, endedAt }) => ({
          startedAt,
          endedAt,
        })),
      };
    })
    .filter((r) => r.focusSeconds > 0);
}
