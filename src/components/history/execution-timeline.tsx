import type { HistorySession } from "@/services/history";
import { localDateStart, addLocalDays } from "@/shared/timezone";
import { durationLabel } from "@/shared/duration-label";

export function ExecutionTimeline({
  sessions,
  timezone,
  date,
  onOpen,
}: {
  sessions: HistorySession[];
  timezone: string;
  date: string;
  onOpen: (id: string) => void;
}) {
  const dayStart = localDateStart(date, timezone).getTime();
  const dayEnd = localDateStart(addLocalDays(date, 1), timezone).getTime();
  const clock = (value: number) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value));
  const pieces = sessions
    .filter((s) => s.status !== "cancelled")
    .flatMap((s) =>
      (s.focusTimeline ?? []).map((i, index) => ({
        id: `${s.id}:${index}`,
        recordId: s.id,
        start: Math.max(dayStart, new Date(i.startedAt).getTime()),
        end: Math.min(dayEnd, new Date(i.endedAt).getTime()),
        title: s.task?.title ?? s.intent ?? s.goal.title,
      })),
    )
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const firstHour = pieces.length
    ? Math.floor((pieces[0]!.start - dayStart) / 3600000)
    : 8;
  const lastHour = pieces.length
    ? Math.min(
        (dayEnd - dayStart) / 3600000,
        Math.max(
          firstHour + 2,
          Math.ceil(
            (Math.max(...pieces.map((p) => p.end)) - dayStart) / 3600000,
          ),
        ),
      )
    : 18;
  const offset = dayStart + firstHour * 3600000;
  const height = (lastHour - firstHour) * 72;
  const lanes: number[] = [];
  const laidOut = pieces.map((piece) => {
    let lane = lanes.findIndex((end) => end <= piece.start);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = piece.end;
    return { ...piece, lane };
  });
  return (
    <section
      aria-label="执行时间线"
      className="border-border bg-card rounded-xl border p-5"
    >
      <h2 className="mb-5 text-lg font-semibold">执行时间线</h2>
      {pieces.length ? (
        <div className="max-h-[480px] overflow-y-auto">
          <div className="relative min-w-0" style={{ height }}>
            {Array.from(
              { length: Math.ceil(lastHour - firstHour) },
              (_, index) => (
                <div
                  key={index}
                  className="absolute inset-x-0 flex items-center gap-3"
                  style={{ top: index * 72 }}
                >
                  <span className="text-muted-foreground w-11 shrink-0 font-mono text-xs">
                    {clock(offset + index * 3600000)}
                  </span>
                  <span className="bg-border h-px flex-1" />
                </div>
              ),
            )}
            <div className="absolute inset-y-0 right-0 left-14">
              {laidOut.map((piece) => (
                <button
                  type="button"
                  key={piece.id}
                  onClick={() => onOpen(piece.recordId)}
                  aria-label={`${clock(piece.start)} 至 ${clock(piece.end)}，${piece.title}，${durationLabel((piece.end - piece.start) / 1000)}`}
                  title={`${clock(piece.start)} — ${clock(piece.end)} · ${piece.title}`}
                  className="border-primary bg-accent hover:bg-muted focus-visible:outline-primary absolute overflow-hidden rounded-md border-l-2 px-2 py-1 text-left text-xs focus-visible:z-10 focus-visible:outline-2"
                  style={{
                    top: ((piece.start - offset) / 3600000) * 72,
                    height: Math.max(
                      24,
                      ((piece.end - piece.start) / 3600000) * 72 - 2,
                    ),
                    left: `${(piece.lane / lanes.length) * 100}%`,
                    width: `${100 / lanes.length}%`,
                  }}
                >
                  <span className="block truncate font-medium">
                    {piece.title}
                  </span>
                  <span className="text-muted-foreground block text-[10px]">
                    {clock(piece.start)} — {clock(piece.end)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          这一天还没有真实专注区间。
        </p>
      )}
      <p className="text-muted-foreground mt-4 text-xs leading-5">
        暂停、休息与等待留白；补录和更正记录见下方列表。
      </p>
    </section>
  );
}
