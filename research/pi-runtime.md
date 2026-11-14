# pi（pi-ai / pi-agent-core）调研

Ticket: #49 (map #46). Inputs for #51, #54, #55, #60. Facts and trade-offs only; no decisions.

Primary reference: the local project `~/code/learnharness` (the ticket calls it "learningharness"; the directory is actually `learnharness`, v0.6.1). Facts were checked against the npm registry (2026-11-14) and against the READMEs that ship in the installed packages (`node_modules/@earendil-works/pi-ai/README.md`, `.../pi-agent-core/README.md`, both 1.4.0). The local clone `~/code/pi` is stale at 0.78.1 and should not be used as a reference.

## 1. Versions, licence, provenance

| | pi-ai | pi-agent-core |
|---|---|---|
| npm name | `@earendil-works/pi-ai` | `@earendil-works/pi-agent-core` |
| latest | **1.5.2** (2026-11-10) | **1.5.2** (2026-11-10) |
| Pinned in learnharness | `1.4.0` exact (2026-10-21) | `1.4.0` exact |
| Licence | MIT | MIT |
| Repo | https://github.com/earendil-works/pi | same monorepo |
| Node engine | `>=22.19.0` (dist-tag `legacy-node20` = 0.74.2) | same |

- Release cadence is fast: 1.4.0 → 1.5.0 → 1.5.1 → 1.5.2 shipped within three weeks. Both packages are released in lockstep from one monorepo.
- Breaking renames happen even inside the 0.x/1.x line. learnharness comments record `shouldStopAfterTurn → finishTurn` in 0.87.1, and a "transcript rework" that moved the system prompt into the message list (`src/agent/subagents/pi-run.ts:105,174`).
- pi-ai pulls in vendor SDKs as exact pinned dependencies: `openai` 7.19.0, `@anthropic-ai/sdk` 0.129.0, `@google/genai` 2.21.0, `@aws-sdk/client-bedrock-runtime`, plus `@earendil-works/pi-schema` and `pi-telemetry` (`npm view @earendil-works/pi-ai dependencies`). Provider adapters load lazily, but they are all in the install footprint.
- **Licence caveat for reuse:** learnharness itself is **AGPL-3.0-only** (`~/code/learnharness/package.json`). pi is MIT and safe to depend on. Copying learnharness *code* into AimThread would carry AGPL obligations, so treat learnharness as a design reference, not a source to paste from. AimThread has no LICENSE file yet.

## 2. Built-in providers

`builtinProviders()` from `@earendil-works/pi-ai/providers/all` registers 42 provider ids in 1.4.0 (taken from `dist/providers/*.models.js`):

amazon-bedrock, ant-ling, anthropic, azure, baseten, cerebras, cloudflare-ai-gateway, cloudflare-workers-ai, deepseek, fireworks, github-copilot, google, google-vertex, groq, huggingface, kimi-coding, meta, minimax, minimax-cn, mistral, moonshotai, moonshotai-cn, nvidia, openai, openai-codex, opencode, opencode-go, openrouter, qwen-token-plan(-cn/-individual), radius, together, typesafe, vercel-ai-gateway, xai, xiaomi(-token-plan-ams/-cn/-sgp), zai, zai-coding-cn.

Facts relevant to PRD §6.1, which allows "API Key" providers only:
- Several of these are OAuth or subscription routes: `openai-codex` (ChatGPT subscription), `github-copilot`, `radius` (OAuth optional), Vertex (ADC). They need filtering if §6.1's "no subscription login in v1" stands.
- Each provider ships a static model catalogue with `contextWindow`, `maxTokens`, `cost`, `reasoning`, and `input` modalities. That covers the "service-reported" rung of §6.1's budget ladder for built-ins, and the `cost` field covers §6.2 cost estimates.
- By default, auth for built-ins resolves per request from env vars. learnharness "reflects file-saved keys into env" (`src/agent/models.ts:75-82`). Providers can also declare an `auth.apiKey.resolve` function, which is the cleaner path for an OS keychain (see §3).

## 3. OpenAI-compatible custom endpoints

Supported first-class through `createProvider()` + `openAICompletionsApi()` (README "Custom Providers"). learnharness implementation: `~/code/learnharness/src/server/custom-provider.ts`.

- **Base URL:** set on the provider *and* stamped on each `Model` (`custom-provider.ts:76,102`). pi uses it as given and appends `/chat/completions`. It does not add `/v1`, so §6.1's "don't auto-append /v1" holds as long as AimThread doesn't normalise.
- **No-key mode:** every provider must declare `auth`. The README says keyless servers can resolve `{ auth: {} }`. learnharness instead returns a placeholder bearer `"not-needed"` because "the OpenAI client needs *a* key" (`custom-provider.ts:26,104-107`). For §6.1 ("no-key uses no saved key"), the important property is that `resolve` is a closure the app owns. pi never reads a stored key for a custom provider unless the closure returns one.
- **Key binding:** learnharness rebuilds the provider whenever the (config, auth) fingerprint changes and deletes it when the binding doesn't match (`custom-provider.ts:36-54`, `customBindingMatches`). Before *every* model request in a tool loop, it also re-checks that the custom model still exists (`src/agent/models.ts:168-180`). This is a working pattern for "never send an old key to a new URL" and for "deleted connection makes no new requests".
- **Model list:** pi does **not** discover models. learnharness has its own `discoverModels()`: `GET {base}/models`, 15 s timeout, `redirect: "manual"` (redirects rejected), 8 MiB body cap, 10 000 row cap. It accepts `{data:[…]}`, `{models:[…]}` or a bare array, and returns the HTTP status so a 401/403 can be told apart from "no list" (`custom-provider.ts:126-164`). `mergeManualModels` handles manual ids as the fallback (`:160`).
- **Capability metadata:** pi needs `reasoning`, `input`, `contextWindow` and `maxTokens` on every model. learnharness detects them from `/models` row fields (vLLM, OpenRouter, llama.cpp `meta.n_ctx`), with ladder *user pin → endpoint metadata → compiled default* (`custom-provider.ts:60-88,177-257`). That is the same three-rung ladder as PRD §6.1. It deliberately does not guess from model names, because a false `reasoning: true` sends `reasoning_effort` and some endpoints reject it.
- **Wire quirks:** `compat` on the model (`OpenAICompletionsCompat`) covers `maxTokensField`, `supportsDeveloperRole`, `supportsStore`, `supportsUsageInStreaming`, `thinkingFormat` (qwen/deepseek/chat-template…), `requiresToolResultName`, and more. If unset, it is auto-detected from the URL for known hosts, otherwise OpenAI defaults (README "OpenAI Compatibility Settings"). learnharness sets no `compat` for custom endpoints.
- Images sent to a model whose `input` lacks `"image"` are **silently dropped** (README "Image Input"). learnharness forces `input: ["text","image"]` on custom models for that reason (`models.ts:137-140`).

## 4. Tool-call API and validation

- **pi-ai level:** `Tool = { name, description, parameters: TypeBox schema }`. Use `StringEnum`, not `Type.Enum`, for Google compatibility. `validateToolCall(tools, toolCall)` throws on invalid args. Optional `constrainedSampling: { type: 'json_schema', strict: 'prefer' | 'require' }` uses provider strict mode where supported (README "Tools").
- **pi-agent-core level:** `AgentTool = Tool + { label, execute(toolCallId, params, signal, onUpdate), executionMode?, prepareArguments? }`. Before `execute`, the loop runs `prepareArguments`, then `validateToolArguments` (`pi-agent-core/dist/agent-loop.js:475-498`). An invalid call becomes a `toolResult` with `isError: true` that the model sees and can retry. `execute` should **throw** on failure, and the loop converts that to an error result.
- **Hooks:** `beforeToolCall` runs after validation and can `{block, reason, terminate}`. `afterToolCall` can rewrite the result or set `terminate`. `terminate: true` on *every* result in a batch skips the follow-up LLM call. This maps directly onto "the card is the tool call; the user's accept/reject is the result" (PRD §5.7). learnharness's question tools use exactly this: the pose returns a placeholder result plus `terminate`, the run ends, and the user's answer arrives later as the real `toolResult` (`src/server/turn-service.ts:44-52,72-79`; `src/agent/teacher-agent.ts:272`).
- **Parallel by default:** `toolExecution: "parallel"`. Persisted toolResults still follow source order.
- **Tool-call ids are not unique across turns on some providers.** DeepSeek via OpenRouter returns `call_0` every response. learnharness rewrites colliding ids once, at the stream boundary, consistently in the wire, the record, and the next context (`src/server/pi/call-ids.ts`, seeded from the record at `chat-handler.ts:833`). Anything in AimThread that keys cards on `toolCallId` hits the same problem.

## 5. Abort

- pi-ai: pass `signal` in options. The stream then ends with an `error` event of `reason: "aborted"`, and the final `AssistantMessage` has `stopReason: "aborted"` with partial content and partial `usage`. Request failures after the stream is returned **never throw**; they surface as `error` events. Direct `streamSimple()` calls throw synchronously only when auth is missing (README "Error Handling", "Aborting Requests").
- pi-agent-core: `agent.abort()` plus `await agent.waitForIdle()`. Tools receive the `signal`. `finishTurn` still runs for aborted turns, but aborted and error responses are hard exits from the loop.
- An aborted assistant message can be appended to history and continued later (README "Continuing After Abort"). learnharness persists the partial transcript on abort (`turn-service.ts:38-43`) and treats aborted steps as unbilled (`pi-run.ts:131-137`).
- learnharness decouples the turn from the HTTP response: a client disconnect only detaches a view, and `handle.abort()` is the single kill path (`src/server/pi/ui-stream.ts:46-53,359-363`). That matches PRD §5.7 ("closing the window only disconnects the view").

## 6. Streaming event shape

- **pi-ai `AssistantMessageEvent`:** `start → (text|thinking|toolcall)_(start|delta|end)* → done | error`. Each non-terminal event carries `contentIndex` and `partial`, which is a *live mutable* message, not a snapshot. Blocks may interleave, so consumers key on `contentIndex`. `toolcall_delta` exposes best-effort partial-JSON `arguments` (Google sends one delta with the full args). `done.reason` ∈ `stop | length | toolUse`, and `error.reason` ∈ `error | aborted` (README "Complete Event Reference").
- **pi-agent-core `AgentEvent`:** `agent_start`, `turn_start`, `message_start/update/end`, `tool_execution_start/update/end`, `turn_end {message, toolResults}`, `agent_end {messages}`. `message_update` is assistant-only and wraps the pi-ai event. Subscribers are **awaited in order**, which makes them usable as persistence barriers (README "Event Types").
- **Cost trap observed in learnharness:** every `message_update` carries the full partial message, so retaining or replaying every event is quadratic. learnharness slims the wire event to `{type, message}` and keeps compacted state instead of a chunk log (`ui-stream.ts:21-28,55-66`). Its UI replaces the streaming message with each update, so no delta assembly happens anywhere.
- `onPayload` (inspect the request body) and `onProviderStreamEvent` (raw parsed chunks) are available for debugging. pi-telemetry spans record no prompt or output text, but error status can include up to 500 characters of provider error text.

## 7. Rebuilding a turn purely from saved history

**Yes, and learnharness does exactly this in production.**

- `Context`, `Message`, and `Model` are plain JSON (README "Context Serialization"). Messages carry provider, model, usage and `thinkingSignature` stamped by pi itself. Cross-provider handoff transforms older messages automatically.
- learnharness builds a **fresh `Agent` per request** from the persisted record: `initialState.messages = record.messages` (`chat-handler.ts:652-655,680`; `pi-run.ts:85-95`). It persists only the messages appended past the base count at settlement (`turn-service.ts:59-93`). Its comment calls the record "the agent state".
- Rules learned the hard way, all from learnharness:
  - **System message handling (1.x):** `systemPrompt` and tool declarations are injected as a leading `role: "system"` message *unless `messages` already starts with one*. If you persist that seed, the next turn's fresh prompt and tool set are silently suppressed. learnharness filters out `role === "system"` before persisting (`ui-stream.ts:228-236`; `pi-run.ts:174-179`). Before each request, pi also diffs `state.tools` against the transcript's declared tools and appends a system message announcing changes. That matters if roles swap tool sets on the same thread (PRD §5.7).
  - **`continue()` needs a non-assistant tail.** On retry, learnharness hands the agent a temporary history with trailing failed attempts omitted, while keeping them on disk (`chat-handler.ts:595-602`).
  - **pi messages have no id.** The app mints ids at the single canonical write (`turn-service.ts:44-46`). `toLlmMessages` strips the app's extra fields at the wire.
  - **Write-ahead:** user input is saved *before* the turn runs (`chat-handler.ts:603-611`).
  - **`prepareRequest`** can reload canonical context from storage before *every* provider request in the loop, including mid-tool-loop (pi-agent-core README "Request preparation").
- The only in-process state left is the live run itself (queues, abort controller), which a restart simply loses. Recovery then works from the saved partial transcript.

## 8. Version pinning and mock-provider testing in learnharness

- **Exact pins:** no caret on both pi packages (`package.json`), and `package-lock.json` is committed. An `allowScripts` allowlist pins install scripts, including for `@google/genai@2.21.0`.
- **Faux provider:** pi-ai ships `fauxProvider()` / `createFauxCore()` with `fauxAssistantMessage`, `fauxText`, `fauxThinking` and `fauxToolCall` (`pi-ai/dist/providers/faux.d.ts`). Responses are queued per request, can be factories that inspect the incoming context, and stream incrementally (tool-call args arrive as `toolcall_delta` chunks). It simulates usage and cache, and an empty queue produces an error message rather than a hang. learnharness injects it as an engine `{ model: faux.getModel(), streamFn: faux.streamSimple }` (`tests/chat-flow.test.ts:19-26,80-98`). Its tests run fully offline via `node:test` + `tsx`.
- **Engine seam:** the agent layer takes a `PiEngine = { model, streamFn }` (`src/agent/models.ts:46-52`). Tests replace the engine and production resolves it from settings, so there is no global default model (`piEngineFor` throws on purpose, `models.ts:188-198`). That is the PRD §6.1 "no factory default" rule.
- **Packaging smoke test:** `scripts/smoke-provider-runtime.mjs` checks offline that the bundled app can initialise lazy provider adapters (Google, Bedrock), with the network forced closed and an `onPayload` sentinel. It runs in `desktop:dist` and is relevant if AimThread bundles the server.

## 9. Reuse versus avoid

learnharness is **AGPL-3.0-only**, so every item below is labelled:
- **Reusable as a pattern:** reimplement the idea from scratch. Do not copy the code.
- **Copyable code:** may be copied or used directly. Only the MIT pi packages (`@earendil-works/pi-ai`, `pi-agent-core`, including `fauxProvider`/`createFauxCore` and the README examples) fall in this category. **No learnharness source is copyable code.** The file:line references throughout this doc point to designs to study, not code to paste.

Reusable as a pattern (learnharness, AGPL; reimplement, do not copy):
- Thin engine seam `{model, streamFn}` with the faux provider in tests.
- Stateless agent per turn, built from the record. Persist only the appended suffix, after stripping `system` messages, and mint ids at one write point.
- Write-ahead user input. Persist the partial transcript on abort.
- A background turn object with views that attach and detach. Abort is explicit only.
- Tool-call id uniquification at the stream boundary.
- Custom endpoint: closure-based `auth.resolve`, provider rebuilt on (URL, auth-mode, key-binding) change, re-validation before each request, metadata ladder, and a discovery fetch that blocks redirects and caps body size.
- Slim the SSE wire event and keep compacted state instead of an event log.

Avoid or keep out of scope (whatever the licence):
- Reflecting saved keys into `process.env` (`models.ts:79-81`). It works, but it spreads secrets process-wide, which conflicts with PRD §6.3. A per-provider `auth.apiKey.resolve` that reads the keychain is available instead.
- The subscription and CLI bridges (`chatgpt-*`, `claude-code/*`, `subscription-*`, `electron/subscriptions.cjs`). They are large and out of PRD v1 scope.
- The placeholder-key approach for keyless endpoints, if a server rejects any `Authorization` header. The README's `{ auth: {} }` route should be verified instead.
- Process-wide mutable `Models` collection hot-swapped by `configureProviderSource`. It needs fingerprinting to stay consistent, so its complexity is worth weighing against building per request.

## 10. Trade-offs to carry forward

- **Upgrade churn vs. features:** exact pins plus a faux regression suite meet PRD §10.4, but upstream renames hooks between releases. The adapter boundary (#54) absorbs that only if hooks like `finishTurn`, `prepareRequest` and system-message semantics stay behind it.
- **Agent class vs. low-level `agentLoop`:** the `Agent` class gives subscriber barriers before tool preflight. `agentLoop` events are observational only, without barriers.
- **Install weight:** all vendor SDKs install regardless of provider use.
- **Capability honesty:** pi trusts the `Model` flags. Wrong `reasoning`, `input` or `compat` values cause rejected requests or silent image drops, so the capability source decided in #60 directly controls failure modes.

## Sources

- npm: https://www.npmjs.com/package/@earendil-works/pi-ai, https://www.npmjs.com/package/@earendil-works/pi-agent-core
- Upstream: https://github.com/earendil-works/pi (`packages/ai`, `packages/agent`)
- Installed READMEs (1.4.0): `~/code/learnharness/node_modules/@earendil-works/pi-ai/README.md`, `.../pi-agent-core/README.md`
- learnharness: `package.json`, `src/agent/models.ts`, `src/server/custom-provider.ts`, `src/server/turn-service.ts`, `src/server/chat-handler.ts`, `src/server/pi/ui-stream.ts`, `src/server/pi/call-ids.ts`, `src/agent/subagents/pi-run.ts`, `src/agent/teacher-agent.ts`, `tests/chat-flow.test.ts`, `scripts/smoke-provider-runtime.mjs`
