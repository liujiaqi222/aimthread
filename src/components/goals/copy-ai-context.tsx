"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { getGoalContextAction } from "@/app/(app)/goals/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/focus/modal";

export function CopyAiContext({ goalId }: { goalId: string }) {
  const titleId = useId();
  const [state, setState] = useState<"idle" | "loading" | "copied" | "error">(
    "idle",
  );
  const [manualText, setManualText] = useState<string | null>(null);

  async function copy() {
    setState("loading");
    try {
      const result = await getGoalContextAction(goalId);
      if (!result.ok) {
        setState("error");
        return;
      }
      try {
        await navigator.clipboard.writeText(result.data.markdown);
        setState("copied");
      } catch {
        setManualText(result.data.markdown);
        setState("idle");
      }
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <div className="space-y-1">
        <Button
          variant="outline"
          size="sm"
          disabled={state === "loading"}
          onClick={() => void copy()}
        >
          {state === "copied" ? (
            <Check aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          {state === "loading"
            ? "整理上下文…"
            : state === "copied"
              ? "已复制，可粘贴给 AI"
              : "复制给 AI"}
        </Button>
        {state === "error" && (
          <p role="alert" className="text-destructive text-xs">
            读取失败，请再试一次。
          </p>
        )}
        <span role="status" className="sr-only">
          {state === "copied" ? "该目标的执行上下文已复制" : ""}
        </span>
      </div>
      {manualText != null && (
        <Modal
          labelledBy={titleId}
          panelClassName="bg-card w-full max-w-2xl rounded-xl p-5 shadow-xl"
          onClose={() => setManualText(null)}
        >
          <h2 id={titleId} className="mb-2 text-lg font-semibold">
            复制执行上下文
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            浏览器未允许自动复制。选中以下内容，复制后粘贴给 AI 即可继续讨论。
          </p>
          <textarea
            aria-label="执行上下文 Markdown"
            readOnly
            value={manualText}
            onFocus={(event) => event.currentTarget.select()}
            className="border-input bg-card h-72 w-full rounded-lg border p-3 text-sm"
          />
          <Button className="mt-3" onClick={() => setManualText(null)}>
            关闭
          </Button>
        </Modal>
      )}
    </>
  );
}
