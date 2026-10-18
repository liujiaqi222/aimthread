import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createMcpAccessToken, loginAs, mcpCall, mcpEnvelope } from "./helpers";

const origin = "http://127.0.0.1:3010";

test("two real Users isolate Web/MCP data, execution, history and browser state", async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const users = [`isolation-a-${randomUUID()}`, `isolation-b-${randomUUID()}`];
  const [tokenA, tokenB] = await Promise.all(
    users.map((id) => createMcpAccessToken(request, id)),
  );
  let sequence = 0;
  async function call(token: string, name: string, args: object = {}) {
    const response = await mcpCall(request, token, ++sequence, name, args);
    expect(response.error).toBeUndefined();
    if (response.result.structuredContent)
      return response.result.structuredContent;
    // The MCP SDK rejects schema-invalid arguments before invoking a tool.
    expect(response.result.isError, JSON.stringify(response)).toBe(true);
    return { ok: false, error: response.result };
  }
  async function ok(token: string, name: string, args: object = {}) {
    const result = await call(token, name, args);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return result.data;
  }
  async function denied(name: string, args: object) {
    const result = await call(tokenA, name, args);
    expect(result.ok, `${name}: ${JSON.stringify(result)}`).toBe(false);
    expect(JSON.stringify(result)).not.toContain("B-private");
  }
  const goalA = await ok(tokenA, "goal_create", {
    title: "A-private goal",
    idempotencyKey: "same-goal-key",
  });
  const goalB = await ok(tokenB, "goal_create", {
    title: "B-private goal",
    idempotencyKey: "same-goal-key",
  });
  expect(goalA.userId).toBe(users[0]);
  expect(goalB.userId).toBe(users[1]);
  expect(goalA.position).toBe(1);
  expect(goalB.position).toBe(1);
  const tasksA = await ok(tokenA, "tasks_create", {
    goalId: goalA.id,
    tasks: [{ title: "A-private task", note: "A-private note" }],
    idempotencyKey: "same-tasks-key",
  });
  const tasksB = await ok(tokenB, "tasks_create", {
    goalId: goalB.id,
    tasks: [
      {
        title: "B-private task",
        note: "B-private note",
        resourceType: "text",
        resourceValue: "B-private resource",
      },
    ],
    idempotencyKey: "same-tasks-key",
  });
  const taskA = tasksA[0];
  const taskB = tasksB[0];
  await ok(tokenA, "settings_update", {
    timezone: "Asia/Shanghai",
    weekStartsOn: 0,
  });
  expect(await ok(tokenB, "settings_get")).toMatchObject({
    timezone: "UTC",
    weekStartsOn: 1,
    setupCompleted: false,
  });
  await ok(tokenA, "selection_set", { goalId: goalA.id, taskId: taskA.id });
  await ok(tokenB, "selection_set", { goalId: goalB.id, taskId: null });
  const beforeB = await ok(tokenB, "goal_context_get", { goalId: goalB.id });
  for (const [name, args] of [
    ["goal_get", { id: goalB.id }],
    ["goal_update", { id: goalB.id, title: "attack" }],
    ["goal_context_get", { goalId: goalB.id }],
    ["tasks_list", { goalId: goalB.id }],
    ["tasks_create", { goalId: goalB.id, tasks: [{ title: "attack" }] }],
    [
      "task_update",
      {
        id: taskB.id,
        note: "attack",
        resourceType: "text",
        resourceValue: "attack",
      },
    ],
    ["task_complete", { id: taskB.id }],
    ["task_skip", { id: taskB.id }],
    ["task_archive", { id: taskB.id }],
    ["task_reopen", { id: taskB.id }],
    ["goals_reorder", { ids: [goalB.id] }],
    ["tasks_reorder", { goalId: goalB.id, ids: [taskB.id] }],
    ["selection_set", { goalId: goalB.id }],
    ["selection_set", { goalId: goalA.id, taskId: taskB.id }],
    ["session_start", { goalId: goalA.id, taskId: taskB.id }],
    ["session_log", { goalId: goalB.id, durationSeconds: 60 }],
    ["goal_create", { title: "forged", userId: users[1] }],
  ] as const)
    await denied(name, args);
  const afterB = await ok(tokenB, "goal_context_get", { goalId: goalB.id });
  expect({ ...afterB.report, generatedAt: null }).toEqual({
    ...beforeB.report,
    generatedAt: null,
  });
  expect(
    (
      await ok(tokenA, "goals_list", { includeArchived: true, limit: 1 })
    ).items.map((g: { id: string }) => g.id),
  ).toEqual([goalA.id]);
  expect(
    (await ok(tokenA, "goals_list", { cursor: goalB.id })).items.map(
      (g: { id: string }) => g.id,
    ),
  ).toEqual([goalA.id]);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const secondDeviceA = await browser.newContext();
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await Promise.all([loginAs(pageA, users[0]), loginAs(pageB, users[1])]);
    for (const page of [pageA, pageB]) {
      await page.goto("/setup");
      await page.getByRole("button", { name: "完成设置" }).click();
      await page.waitForURL(/\/today/);
    }
    await expect(
      pageA.getByText("B-private goal", { exact: true }),
    ).toHaveCount(0);
    await expect(
      pageB.getByText("A-private goal", { exact: true }),
    ).toHaveCount(0);
    await pageA.goto("/goals");
    await expect(
      pageA.getByText("A-private task", { exact: true }),
    ).toBeVisible();
    await expect(
      pageA.getByText("B-private task", { exact: true }),
    ).toHaveCount(0);
    async function web(api: APIRequestContext, path: string, data: object) {
      return api.post(path, { data, headers: { origin } });
    }
    const [startA, startB] = await Promise.all([
      web(pageA.request, "/api/session/start", {
        goalId: goalA.id,
        taskId: taskA.id,
        timerMode: "pomodoro",
        idempotencyKey: "same-start-key",
      }),
      ok(tokenB, "session_start", {
        goalId: goalB.id,
        taskId: taskB.id,
        timerMode: "stopwatch",
        idempotencyKey: "same-start-key",
      }),
    ]);
    expect(startA.status()).toBe(200);
    const sessionA = (await startA.json()).data;
    const sessionB = startB;
    expect(sessionA.id).not.toBe(sessionB.id);
    expect((await ok(tokenA, "session_get_active")).id).toBe(sessionA.id);
    expect(
      (await (await pageB.request.get("/api/session/active")).json()).data.id,
    ).toBe(sessionB.id);
    expect(
      (
        await ok(tokenB, "session_start", {
          goalId: goalB.id,
          taskId: taskB.id,
          timerMode: "stopwatch",
          idempotencyKey: "same-start-key",
        })
      ).id,
    ).toBe(sessionB.id);
    const distraction = await ok(tokenB, "distraction_log", {
      text: "B-private distraction",
    });
    for (const [name, args] of [
      ["session_get", { id: sessionB.id }],
      ["session_pause", { id: sessionB.id }],
      ["session_resume", { id: sessionB.id }],
      ["session_finish", { id: sessionB.id }],
      ["session_cancel", { id: sessionB.id }],
      [
        "session_advance",
        {
          id: sessionB.id,
          expectedPhaseId: sessionA.phase.id,
          action: "start_break",
        },
      ],
      [
        "session_note_update",
        { id: sessionB.id, note: "attack", expectedVersion: 0 },
      ],
      [
        "session_resume_hint_update",
        { id: sessionB.id, resumeHint: "attack", expectedVersion: 0 },
      ],
      ["distractions_list", { sessionId: sessionB.id }],
      ["distraction_log", { sessionId: sessionB.id, text: "attack" }],
      ["distraction_update", { id: distraction.id, text: "attack" }],
      ["distraction_archive", { id: distraction.id }],
    ] as const)
      await denied(name, args);
    for (const [path, data] of [
      ["/api/session/transition", { id: sessionB.id, operation: "cancel" }],
      ["/api/session/finish", { id: sessionB.id }],
      [
        "/api/session/advance",
        {
          id: sessionB.id,
          expectedPhaseId: sessionA.phase.id,
          action: "start_next_focus",
        },
      ],
    ] as const) {
      const result = await web(pageA.request, path, data);
      expect((await result.json()).ok).toBe(false);
    }
    expect(
      (await ok(tokenB, "distractions_list", { sessionId: sessionB.id }))[0],
    ).toMatchObject({
      id: distraction.id,
      text: "B-private distraction",
      archivedAt: null,
    });
    expect(await ok(tokenB, "session_get", { id: sessionB.id })).toMatchObject({
      status: "active",
      note: null,
      resumeHint: null,
    });
    const secondPageA = await secondDeviceA.newPage();
    await loginAs(secondPageA, users[0]);
    expect(
      (await (await secondPageA.request.get("/api/session/active")).json()).data
        .id,
    ).toBe(sessionA.id);
    await ok(tokenA, "session_pause", { id: sessionA.id });
    expect(
      (await (await secondPageA.request.get("/api/session/active")).json()).data
        .status,
    ).toBe("paused");
    expect(
      (await (await pageA.request.get("/api/session/active")).json()).data
        .status,
    ).toBe("paused");
    expect((await ok(tokenB, "session_get_active")).status).toBe("active");
    expect(
      (
        await web(secondPageA.request, "/api/session/transition", {
          id: sessionA.id,
          operation: "resume",
        })
      ).ok(),
    ).toBe(true);
    await ok(tokenA, "session_note_update", {
      id: sessionA.id,
      note: "A-private session note",
      expectedVersion: 0,
    });
    await ok(tokenA, "session_resume_hint_update", {
      id: sessionA.id,
      resumeHint: "A-private hint",
      expectedVersion: 0,
    });
    expect(
      (
        await web(pageA.request, "/api/session/finish", { id: sessionA.id })
      ).ok(),
    ).toBe(true);
    const finishedB = await ok(tokenB, "session_finish", { id: sessionB.id });
    await denied("session_update", {
      id: finishedB.id,
      note: "attack",
      expectedNoteVersion: finishedB.noteVersion,
    });
    await denied("session_update", {
      id: sessionA.id,
      goalId: goalB.id,
      taskId: null,
      expectedRevision: (await ok(tokenA, "session_get", { id: sessionA.id }))
        .revision,
    });
    const manual = {
      durationSeconds: 120,
      startedAt: "2026-06-01T10:00:00Z",
      endedAt: "2026-06-01T10:02:00Z",
      idempotencyKey: "same-log-key",
    };
    const recordA = await ok(tokenA, "session_log", {
      ...manual,
      goalId: goalA.id,
      resumeHint: "A-private manual hint",
    });
    const recordB = await ok(tokenB, "session_log", {
      ...manual,
      goalId: goalB.id,
      resumeHint: "B-private manual hint",
    });
    expect(recordA.id).not.toBe(recordB.id);
    expect(
      (
        await ok(tokenA, "session_log", {
          ...manual,
          goalId: goalA.id,
          resumeHint: "A-private manual hint",
        })
      ).id,
    ).toBe(recordA.id);
    expect(
      (
        await call(tokenA, "session_log", {
          ...manual,
          goalId: goalA.id,
          idempotencyKey: "overlap",
        })
      ).error.code,
    ).toBe("SESSION_TIME_OVERLAP");
    await ok(tokenA, "session_update", {
      id: recordA.id,
      durationSeconds: 60,
      expectedRevision: recordA.revision,
    });
    await ok(tokenB, "task_complete", { id: taskB.id });
    const statsA = await ok(tokenA, "stats_get", {
      period: "custom",
      from: "2026-06-01",
      to: "2026-06-02",
      timezone: "UTC",
      daily: true,
    });
    const statsB = await ok(tokenB, "stats_get", {
      period: "custom",
      from: "2026-06-01",
      to: "2026-06-02",
      timezone: "UTC",
      daily: true,
    });
    expect(statsA.totalFocusSeconds).toBe(60);
    expect(statsB.totalFocusSeconds).toBe(120);
    for (const name of ["dashboard_get", "sessions_list", "stats_get"]) {
      const result = await ok(
        tokenA,
        name,
        name === "stats_get" ? { period: "all" } : {},
      );
      expect(JSON.stringify(result)).not.toContain("B-private");
    }
    await pageA.goto("/history");
    await expect(
      pageA.getByRole("heading", { name: "时间留下的痕迹", exact: true }),
    ).toBeVisible();
    await expect(
      pageA.getByText("B-private goal", { exact: true }),
    ).toHaveCount(0);
    const [concurrent1, concurrent2] = await Promise.all([
      call(tokenA, "session_start", {
        goalId: goalA.id,
        timerMode: "stopwatch",
      }),
      call(tokenA, "session_start", {
        goalId: goalA.id,
        timerMode: "stopwatch",
      }),
    ]);
    expect(
      [concurrent1, concurrent2].filter((result) => result.ok),
    ).toHaveLength(1);
    await ok(tokenA, "session_cancel", {
      id: (concurrent1.ok ? concurrent1 : concurrent2).data.id,
    });
    // Clear the User's selection independently; the other User's remains intact.
    await ok(tokenA, "selection_clear");
    expect((await ok(tokenB, "dashboard_get")).selection.goal.id).toBe(
      goalB.id,
    );
    // Logout performs full navigation so old Router/UI state cannot survive account switching.
    await pageA.getByRole("button", { name: "退出", exact: true }).click();
    await expect(pageA).toHaveURL(/\/login$/);
    await loginAs(pageA, users[1]);
    await pageA.goto("/goals");
    await expect(
      pageA.getByText("B-private goal", { exact: true }),
    ).toBeVisible();
    await expect(
      pageA.getByText("A-private goal", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await contextA.close();
    await contextB.close();
    await secondDeviceA.close();
  }
});

test("MCP rejects invalid subjects, issuer, resource, expiry and scopes; password APIs remain closed", async ({
  request,
}) => {
  test.setTimeout(120_000);
  const userId = `claims-${randomUUID()}`;
  for (const [claims, options] of [
    [{ sub: "" }, {}],
    [{ sub: "unknown-user" }, {}],
    [{ sub: null }, {}],
    [{ scope: "aimthread:read" }, {}],
    [{}, { audience: "https://attacker.example/mcp" }],
    [{}, { issuer: "https://attacker.example/api/auth" }],
    [{}, { expirationTime: "-1m" }],
  ] as const) {
    const token = await createMcpAccessToken(request, userId, claims, options);
    const response = await request.post("/mcp", {
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "server/discover",
        params: { _meta: mcpEnvelope },
      },
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
      },
    });
    expect([401, 403]).toContain(response.status());
  }
  for (const path of ["/api/auth/sign-in/email", "/api/auth/sign-up/email"]) {
    const response = await request.post(path, {
      data: {
        email: "a@example.test",
        password: "test-password-long",
        name: "test",
      },
      headers: { origin },
    });
    expect(response.ok()).toBe(false);
  }
  expect((await request.get("/api/session/active")).status()).toBe(401);
  expect(
    (
      await request.post("/api/session/start", {
        data: {},
        headers: { origin: "https://attacker.example" },
      })
    ).status(),
  ).toBe(403);
});

test("onboarding drafts are isolated when the same browser changes User", async ({
  page,
}) => {
  const userA = `draft-a-${randomUUID()}`;
  const userB = `draft-b-${randomUUID()}`;
  await loginAs(page, userA);
  await page.goto("/setup");
  await page.getByRole("button", { name: "完成设置" }).click();
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel("目标标题").fill("A-private unfinished draft");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(localStorage).some((value) =>
          value.includes("A-private unfinished draft"),
        ),
      ),
    )
    .toBe(true);
  await loginAs(page, userB);
  await page.goto("/setup");
  await page.getByRole("button", { name: "完成设置" }).click();
  await page.waitForURL(/\/onboarding/);
  await expect(page.getByLabel("目标标题")).toHaveValue("");
  await loginAs(page, userA);
  await page.goto("/onboarding");
  await expect(page.getByLabel("目标标题")).toHaveValue(
    "A-private unfinished draft",
  );
});
