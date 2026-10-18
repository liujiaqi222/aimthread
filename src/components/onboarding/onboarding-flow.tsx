"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Clipboard,
  ExternalLink,
  Loader2,
  Sparkles,
  Target,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  checkOnboardingGoalsAction,
  createOnboardingGoalAction,
  type OnboardingCandidate,
  selectOnboardingGoalAction,
} from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type OnboardingDraft,
  type OnboardingStep,
  onboardingDraftStorageKey,
  parseOnboardingDraft,
} from "@/shared/onboarding";

const examples = ["把产品介绍页做完", "开始稳定写作", "准备下一次职业选择"];
const subscribeToHydration = () => () => undefined;

function emptyDraft(): OnboardingDraft {
  return {
    version: 1,
    step: "goal",
    title: "",
    description: "",
    idempotencyKey: `onboarding-${crypto.randomUUID()}`,
  };
}

export function OnboardingFlow({
  endpoint,
  userId,
}: {
  endpoint: string;
  userId: string;
}) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  if (!hydrated) {
    return (
      <main className="bg-background grid min-h-screen place-items-center">
        <Loader2
          className="text-muted-foreground size-5 animate-spin"
          aria-label="正在恢复引导"
        />
      </main>
    );
  }

  return (
    <HydratedOnboardingFlow key={userId} endpoint={endpoint} userId={userId} />
  );
}

function HydratedOnboardingFlow({
  endpoint,
  userId,
}: {
  endpoint: string;
  userId: string;
}) {
  const router = useRouter();
  const storageKey = onboardingDraftStorageKey(window.location.origin, userId);
  const [draft, setDraft] = useState<OnboardingDraft>(() => {
    return (
      parseOnboardingDraft(localStorage.getItem(storageKey)) ?? emptyDraft()
    );
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [checkMessage, setCheckMessage] = useState<string>();
  const [candidates, setCandidates] = useState<OnboardingCandidate[]>([]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey]);

  const setStep = (step: OnboardingStep) => {
    setError(undefined);
    setDraft((current) => ({ ...current, step }));
  };

  const complete = () => {
    localStorage.removeItem(storageKey);
    router.push("/today?first=1");
    router.refresh();
  };

  const saveManualGoal = async () => {
    const title = draft.title.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(undefined);
    const result = await createOnboardingGoalAction({
      title,
      description: draft.description.trim() || null,
      idempotencyKey: draft.idempotencyKey,
    });
    if (result.ok) complete();
    else {
      setError(result.error.message);
      setBusy(false);
    }
  };

  const checkGoals = async () => {
    setBusy(true);
    setError(undefined);
    setCheckMessage(undefined);
    const result = await checkOnboardingGoalsAction();
    if (!result.ok) {
      setError(result.error.message);
    } else if (result.data.length === 0) {
      setCandidates([]);
      setCheckMessage(
        "连接可能已经成功，但 AimThread 里还没有目标。请在 ChatGPT 中确认写入后再检查。",
      );
    } else {
      setCandidates(result.data);
      setCheckMessage(
        result.data.length === 1
          ? "找到了一个已保存目标。确认后会使用它，不会再创建副本。"
          : "找到了多个目标，请选择这次要开始的一个。",
      );
    }
    setBusy(false);
  };

  const chooseGoal = async (goalId: string) => {
    setBusy(true);
    setError(undefined);
    const result = await selectOnboardingGoalAction(goalId);
    if (result.ok) complete();
    else {
      setError(result.error.message);
      setBusy(false);
    }
  };

  return (
    <main className="bg-background min-h-screen px-5 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between">
          <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <span className="bg-foreground text-primary-foreground grid size-8 place-items-center rounded-xl">
              <Target className="size-4" aria-hidden="true" />
            </span>
            AimThread
          </div>
          <span className="text-muted-foreground font-mono text-xs tracking-[0.16em] uppercase">
            {draft.step === "goal"
              ? "第一幕"
              : draft.step === "reason"
                ? "第二幕"
                : "AI 路径"}
          </span>
        </header>

        <section className="border-border bg-card mt-10 rounded-2xl border px-5 py-8 shadow-[0_18px_50px_rgba(28,25,23,0.07)] sm:mt-14 sm:px-10 sm:py-12">
          {draft.step === "goal" && (
            <GoalStep
              title={draft.title}
              onTitleChange={(title) => setDraft({ ...draft, title })}
              onContinue={() => void saveManualGoal()}
              busy={busy}
              error={error}
              onAi={() => setStep("ai")}
            />
          )}
          {draft.step === "reason" && (
            <ReasonStep
              draft={draft}
              busy={busy}
              error={error}
              onChange={(description) => setDraft({ ...draft, description })}
              onBack={() => setStep("goal")}
              onSave={() => void saveManualGoal()}
            />
          )}
          {draft.step === "ai" && (
            <AiStep
              endpoint={endpoint}
              busy={busy}
              error={error}
              message={checkMessage}
              candidates={candidates}
              onBack={() => setStep("goal")}
              onCheck={() => void checkGoals()}
              onChoose={(goalId) => void chooseGoal(goalId)}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function GoalStep({
  title,
  onTitleChange,
  onContinue,
  onAi,
  busy,
  error,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  onContinue: () => void;
  onAi: () => void;
  busy: boolean;
  error?: string;
}) {
  return (
    <div className="mx-auto max-w-xl text-center">
      <p className="text-primary text-sm font-medium">从计划到执行</p>
      <h1 className="text-foreground mt-4 text-3xl font-semibold tracking-[-0.04em] text-balance sm:text-5xl sm:leading-tight">
        把计划接到这里，开始推进。
      </h1>
      <p className="text-muted-foreground mx-auto mt-4 max-w-md leading-7">
        在外部 AI 中准备好计划，或先用一个目标标题开始。
      </p>
      <Button
        type="button"
        size="lg"
        onClick={onAi}
        className="mt-7 h-12 w-full"
      >
        <Bot className="size-4" />
        连接外部 AI，导入计划
      </Button>
      <p className="text-muted-foreground mt-7 text-sm">也可以手动创建目标</p>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) onContinue();
        }}
      >
        <Input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          maxLength={240}
          autoFocus
          aria-label="目标标题"
          placeholder="我想推进…"
          className="border-input bg-muted focus-visible:bg-card h-14 rounded-2xl px-5 text-center text-lg shadow-none"
        />
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {examples.map((example) => (
            <button
              type="button"
              key={example}
              onClick={() => onTitleChange(example)}
              className="border-border text-muted-foreground hover:border-input hover:text-foreground rounded-full border px-3 py-1.5 text-xs"
            >
              {example}
            </button>
          ))}
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={busy || !title.trim()}
          className="mt-8 h-12 rounded-full px-7"
        >
          {busy ? "正在保存…" : "保存目标，准备开始"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function ReasonStep({
  draft,
  busy,
  error,
  onChange,
  onBack,
  onSave,
}: {
  draft: OnboardingDraft;
  busy: boolean;
  error?: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl">
      <p className="text-primary text-sm font-medium">让它对你更有意义</p>
      <h1 className="text-foreground mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
        如果做成，你最期待的变化是什么？
      </h1>
      <p className="text-muted-foreground mt-3 leading-7">
        可选。它会成为目标说明，不影响你马上开始。
      </p>

      <div className="border-border bg-accent mt-7 rounded-2xl border p-5">
        <p className="text-primary text-xs font-semibold tracking-[0.16em] uppercase">
          目标正在成形
        </p>
        <p className="text-foreground mt-2 text-xl font-semibold">
          {draft.title.trim()}
        </p>
      </div>

      <label
        htmlFor="goal-reason"
        className="text-foreground mt-7 block text-sm font-medium"
      >
        我最期待的是
      </label>
      <textarea
        id="goal-reason"
        value={draft.description}
        onChange={(event) => onChange(event.target.value)}
        maxLength={10_000}
        rows={4}
        placeholder="例如：每天打开电脑时，知道下一步该做什么。"
        className="border-input bg-muted focus:border-ring focus:bg-card mt-2 w-full resize-none rounded-2xl border px-4 py-3 text-base leading-7 outline-none"
      />

      {error && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {error}
        </p>
      )}

      <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回修改
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={onSave}
          disabled={busy}
          className="rounded-full px-6"
        >
          {busy
            ? "正在保存…"
            : draft.description.trim()
              ? "保存目标，准备开始"
              : "跳过并保存目标"}
          {!busy && <ArrowRight className="size-4" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

function AiStep({
  endpoint,
  busy,
  error,
  message,
  candidates,
  onBack,
  onCheck,
  onChoose,
}: {
  endpoint: string;
  busy: boolean;
  error?: string;
  message?: string;
  candidates: OnboardingCandidate[];
  onBack: () => void;
  onCheck: () => void;
  onChoose: (goalId: string) => void;
}) {
  const prompt = `请把我们已经确认的计划写入 AimThread。先检查已有目标与任务，避免创建重复项；确认要写入的内容后，使用 goal_create 和 tasks_create 保存目标、任务说明与资源，再用 selection_set 选中本次工作。不要自动开始计时，也不要把计时结束当成任务完成。`;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start gap-4">
        <span className="bg-foreground text-primary-foreground grid size-11 shrink-0 place-items-center rounded-2xl">
          <Sparkles className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-primary text-sm font-medium">ChatGPT MCP App</p>
          <h1 className="text-foreground mt-1 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            把已有计划写入 AimThread
          </h1>
        </div>
      </div>
      <p className="text-muted-foreground mt-5 leading-7">
        ChatGPT
        会通过安全授权访问这个实例。连接成功不等于目标已经保存；最后仍要回到这里检查真实数据。
      </p>

      <ol className="mt-7 space-y-4">
        <AiInstruction number="1" title="在 ChatGPT 中创建 MCP App">
          <p>
            打开 Plugin 管理页，点击 Add → Create MCP App，再填写下面的地址。
          </p>
          <a
            href="https://chatgpt.com/plugins"
            target="_blank"
            rel="noreferrer"
            className="text-foreground decoration-border mt-2 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
          >
            打开 ChatGPT Plugins
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
          <CopyValue value={endpoint} label="复制 MCP 地址" />
        </AiInstruction>
        <AiInstruction number="2" title="将确认好的计划写回">
          <CopyValue value={prompt} label="复制开场话术" multiline />
        </AiInstruction>
        <AiInstruction number="3" title="确认写入后，回到这里检查">
          <p>只有 AimThread 读到了已保存的 Goal，才算完成。</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={onCheck}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
            {busy ? "正在检查…" : "检查已保存目标"}
          </Button>
        </AiInstruction>
      </ol>

      {(message || error) && (
        <p
          role={error ? "alert" : "status"}
          className={`mt-5 rounded-xl p-4 text-sm leading-6 ${error ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground"}`}
        >
          {error ?? message}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="mt-5 grid gap-3">
          {candidates.map((candidate) => (
            <div
              key={candidate.goal.id}
              className="border-border bg-muted rounded-2xl border p-4 sm:flex sm:items-center sm:justify-between sm:gap-4"
            >
              <div>
                <p className="text-foreground font-semibold">
                  {candidate.goal.title}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {candidate.pendingTaskCount > 0
                    ? `${candidate.pendingTaskCount} 个待办任务${candidate.firstTask ? ` · 下一步：${candidate.firstTask.title}` : ""}`
                    : "还没有任务，可以直接围绕目标开始"}
                </p>
              </div>
              <Button
                type="button"
                className="mt-3 shrink-0 sm:mt-0"
                disabled={busy}
                onClick={() => onChoose(candidate.goal.id)}
              >
                用这个目标开始
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        className="mt-7"
        onClick={onBack}
        disabled={busy}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        改为手动创建
      </Button>
    </div>
  );
}

function AiInstruction({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="border-border rounded-2xl border p-4 sm:p-5">
      <div className="flex gap-3">
        <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs">
          {number}
        </span>
        <div className="text-muted-foreground min-w-0 flex-1 text-sm leading-6">
          <h2 className="text-foreground font-semibold">{title}</h2>
          <div className="mt-1">{children}</div>
        </div>
      </div>
    </li>
  );
}

function CopyValue({
  value,
  label,
  multiline = false,
}: {
  value: string;
  label: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="bg-foreground text-primary-foreground mt-3 flex items-start gap-2 rounded-xl p-3">
      <code
        className={`min-w-0 flex-1 font-mono text-xs leading-5 break-all whitespace-pre-wrap ${multiline ? "max-h-32 overflow-y-auto" : ""}`}
      >
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => void copy()}
        aria-label={label}
        className="text-muted-foreground hover:bg-card/10 hover:text-primary-foreground shrink-0"
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Clipboard className="size-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
