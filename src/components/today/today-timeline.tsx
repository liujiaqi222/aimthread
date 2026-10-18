"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getTodayTimelineAction } from "@/app/(app)/history/actions";
import { ExecutionTimeline } from "@/components/history/execution-timeline";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/focus/modal";
import { X, Clock3 } from "lucide-react";

export function TodayTimeline() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] =
    useState<
      Extract<
        Awaited<ReturnType<typeof getTodayTimelineAction>>,
        { ok: true }
      >["data"]
    >();
  async function load() {
    setBusy(true);
    setError(null);
    try {
      const result = await getTodayTimelineAction();
      if (result.ok) setData(result.data);
      else setError("今日记录读取失败，请重试。");
    } catch {
      setError("连接失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Clock3 className="size-4" />
        今日时间线
      </Button>
      {open && (
        <Modal
          labelledBy="today-timeline-title"
          onClose={() => setOpen(false)}
          overlayClassName="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50"
          panelClassName="w-full max-w-lg overflow-y-auto bg-card p-5 text-foreground sm:p-8"
        >
          <div className="mb-7 flex items-center justify-between">
            <h2 id="today-timeline-title" className="text-xl font-semibold">
              今天的投入
            </h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭时间线"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </div>
          {busy && (
            <p role="status" className="text-muted-foreground text-sm">
              正在读取…
            </p>
          )}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <Button variant="outline" onClick={() => void load()}>
                重试
              </Button>
            </div>
          )}
          {data && (
            <>
              <ExecutionTimeline
                date={data.date}
                timezone={data.timezone}
                sessions={data.page.items}
                onOpen={() =>
                  router.push(`/history?period=day&date=${data.date}`)
                }
              />
              <Button
                variant="outline"
                className="mt-5"
                onClick={() =>
                  router.push(`/history?period=day&date=${data.date}`)
                }
              >
                在足迹查看全部记录
              </Button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
