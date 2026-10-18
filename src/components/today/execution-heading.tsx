import type { ReactNode } from "react";
import { ArrowUpRight, CornerDownRight } from "lucide-react";

export function ExecutionHeading({
  goal,
  task,
  description,
  resource,
  resumeHint,
  children,
}: {
  goal: string;
  task?: string | null;
  description?: string | null;
  resource?: string | null;
  resumeHint?: string | null;
  children?: ReactNode;
}) {
  let url: string | null = null;
  try {
    const parsed = new URL(resource ?? "");
    if (["https:", "http:"].includes(parsed.protocol)) url = parsed.href;
  } catch {}
  return (
    <div className="w-full max-w-[760px] text-left">
      {children ?? <p className="text-muted-foreground text-sm">{goal}</p>}
      <h2 className="mt-6 text-3xl leading-snug font-semibold tracking-tight break-words sm:text-4xl">
        {task ?? goal}
      </h2>
      {description && (
        <div className="text-muted-foreground mt-5 text-base leading-7 break-words whitespace-pre-wrap">
          {description.length > 280 ? (
            <>
              <p>{description.slice(0, 180)}…</p>
              <details className="mt-2">
                <summary className="text-primary cursor-pointer text-sm">
                  展开完整说明
                </summary>
                <p className="mt-3 max-h-60 overflow-y-auto">{description}</p>
              </details>
            </>
          ) : (
            <p>{description}</p>
          )}
        </div>
      )}
      {resource && (
        <div className="mt-4 text-sm break-all">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1 underline underline-offset-4"
            >
              {resource}
              <ArrowUpRight className="size-4 shrink-0" />
            </a>
          ) : (
            <p className="text-muted-foreground">资源：{resource}</p>
          )}
        </div>
      )}
      {resumeHint && (
        <div className="border-primary mt-6 flex gap-3 border-l-2 pl-4 text-sm leading-6">
          <CornerDownRight
            className="text-primary mt-1 size-4 shrink-0"
            aria-hidden="true"
          />
          <p>
            <span className="text-muted-foreground block text-xs">
              接续提示
            </span>
            {resumeHint}
          </p>
        </div>
      )}
    </div>
  );
}
