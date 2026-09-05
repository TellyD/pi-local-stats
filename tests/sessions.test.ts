import { describe, expect, it } from "vitest"

import type { AgentObservation } from "../server/agent-adapters/index.ts"
import {
  reconcileAgentRuns,
  replaceAgentObservations,
} from "../server/agents.ts"
import { createDatabase } from "../server/database.ts"
import {
  getSessions,
  getSessionTrace,
  parseSessionPageOptions,
} from "../server/stats.ts"
import type {
  SessionPageOptions,
  SessionSortKey,
  SortDirection,
  StatsFilters,
} from "../server/types.ts"

const filters: StatsFilters = {
  range: "all",
  project: "",
  provider: "",
  model: "",
}

function normalizedObservation({
  id,
  sourcePath,
  rootId,
  sourceEntryId,
  parentNativeId = null,
  startedAt = "2026-01-01T00:00:01.000Z",
  completedAt = "2026-01-01T00:00:02.000Z",
}: {
  id: string
  sourcePath: string
  rootId: string
  sourceEntryId: string
  parentNativeId?: string | null
  startedAt?: string | null
  completedAt?: string | null
}): AgentObservation {
  return {
    observationKey: `observation:${rootId}:${sourceEntryId}`,
    nativeRunKey: id,
    nativeId: id,
    adapter: "tintinweb",
    channel: "tool-details",
    sourcePath,
    sourceEntryId,
    artifactVersion: null,
    rootSessionRef: rootId,
    rootSessionFile: sourcePath,
    sessionFile: null,
    parentNativeId,
    workflowId: null,
    workflowStepIndex: null,
    agentType: "worker",
    displayName: "worker",
    description: null,
    statusRaw: "completed",
    status: "completed",
    startedAt,
    completedAt,
    provider: "openai",
    modelId: "gpt-child",
    modelLabel: null,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
      totalCost: 0.01,
      requestCount: null,
      toolCount: null,
      turnCount: null,
      scope: "self",
    },
    precision: {
      identity: "exact",
      linkage: "exact",
      model: "exact",
      tokens: "exact",
      cost: "exact",
    },
    metadataPriority: 50,
    usagePriority: 50,
  }
}

function options(
  sort: SessionSortKey,
  direction: SortDirection,
  page = 1,
  pageSize = 10
): SessionPageOptions {
  return { page, pageSize, sort, direction }
}

describe("parseSessionPageOptions", () => {
  it("applique les valeurs par défaut et refuse les paramètres invalides", () => {
    expect(parseSessionPageOptions(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 10,
      sort: "startedAt",
      direction: "desc",
    })
    expect(
      parseSessionPageOptions(
        new URLSearchParams("page=2&pageSize=25&sort=cost&direction=asc")
      )
    ).toEqual({ page: 2, pageSize: 25, sort: "cost", direction: "asc" })

    for (const query of [
      "page=0",
      "page=1.5",
      "pageSize=101",
      "sort=unknown",
      "direction=sideways",
    ])
      expect(parseSessionPageOptions(new URLSearchParams(query))).toBeNull()
  })
})

describe("getSessions", () => {
  it("trie avant de paginer, filtre et borne la page demandée", () => {
    const db = createDatabase(":memory:")
    const insertSession = db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES (?, ?, ?, ?, ?, NULL, ?)"
    )
    const insertRequest = db.prepare(
      "INSERT INTO requests (id, source_key, request_key, file_path, session_id, accounting_session_id, cwd, timestamp, provider, model, input_tokens, cache_read_tokens, total_tokens, cost, is_error, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test', ?, 1, 0, ?, ?, 0, 0)"
    )

    try {
      for (let index = 1; index <= 23; index += 1) {
        const suffix = String(index).padStart(2, "0")
        const reverseSuffix = String(24 - index).padStart(2, "0")
        const id = `session-${suffix}`
        const file = `/sessions/${suffix}.jsonl`
        const project = `/work/project-${reverseSuffix}`
        const startedAt = `2026-01-${suffix}T00:00:00.000Z`
        const requestCount = (index % 3) + 1
        insertSession.run(
          file,
          id,
          project,
          `Name ${reverseSuffix}`,
          startedAt,
          id
        )
        for (let request = 0; request < requestCount; request += 1) {
          const requestId = `${id}-request-${request}`
          const model =
            index === 1
              ? request === 0
                ? "z-model"
                : "a-model"
              : `model-${suffix}`
          insertRequest.run(
            requestId,
            requestId,
            requestId,
            file,
            id,
            id,
            project,
            startedAt,
            model,
            index,
            index / requestCount
          )
        }
      }

      const firstPage = getSessions(db, filters, options("cost", "desc"))
      expect(firstPage).toMatchObject({ page: 1, pageSize: 10, total: 23 })
      expect(firstPage.rows).toHaveLength(10)
      expect(firstPage.rows.every((row) => row.agents.length === 0)).toBe(true)
      expect(firstPage.rows.map(({ id }) => id)).toEqual(
        Array.from({ length: 10 }, (_, offset) => `session-${23 - offset}`)
      )

      const lastPage = getSessions(db, filters, options("cost", "desc", 999))
      expect(lastPage).toMatchObject({ page: 3, pageSize: 10, total: 23 })
      expect(lastPage.rows.map(({ id }) => id)).toEqual([
        "session-03",
        "session-02",
        "session-01",
      ])
      expect(lastPage.rows.at(-1)?.models).toEqual(["a-model", "z-model"])

      expect(
        getSessions(db, filters, options("name", "asc", 1, 1)).rows[0]?.id
      ).toBe("session-23")
      expect(
        getSessions(db, filters, options("project", "asc", 1, 1)).rows[0]?.id
      ).toBe("session-23")
      expect(
        getSessions(db, filters, options("models", "asc", 1, 1)).rows[0]?.id
      ).toBe("session-01")
      expect(
        getSessions(db, filters, options("startedAt", "desc", 1, 1)).rows[0]?.id
      ).toBe("session-23")
      expect(
        getSessions(db, filters, options("requests", "desc", 1, 1)).rows[0]?.id
      ).toBe("session-02")
      expect(
        getSessions(db, filters, options("tokens", "desc", 1, 1)).rows[0]?.id
      ).toBe("session-23")

      const project = "/work/project-19"
      expect(
        getSessions(db, { ...filters, project }, options("cost", "desc"))
      ).toMatchObject({ total: 1, rows: [{ id: "session-05", project }] })
    } finally {
      db.close()
    }
  })

  it("ne fusionne pas le même ID natif entre deux sessions racines", () => {
    const db = createDatabase(":memory:")
    const insert = db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES (?, ?, '/work/project', ?, '2026-01-01T00:00:00.000Z', NULL, ?)"
    )
    insert.run("/sessions/a.jsonl", "root-a", "A", "root-a")
    insert.run("/sessions/b.jsonl", "root-b", "B", "root-b")
    replaceAgentObservations(db, "/sessions/a.jsonl", [
      normalizedObservation({
        id: "reused-id",
        sourcePath: "/sessions/a.jsonl",
        rootId: "root-a",
        sourceEntryId: "same-entry",
      }),
    ])
    replaceAgentObservations(db, "/sessions/b.jsonl", [
      normalizedObservation({
        id: "reused-id",
        sourcePath: "/sessions/b.jsonl",
        rootId: "root-b",
        sourceEntryId: "same-entry",
      }),
    ])

    reconcileAgentRuns(db)

    expect(db.prepare("SELECT COUNT(*) FROM agent_runs").pluck().get()).toBe(2)
    expect(
      getSessions(db, filters, options("name", "asc")).rows.map((row) => [
        row.id,
        row.agents.map((agent) => agent.id),
      ])
    ).toEqual([
      ["root-a", ["reused-id"]],
      ["root-b", ["reused-id"]],
    ])
    db.close()
  })

  it("applique hidden_models aux runs agrégés et à la pagination", () => {
    const db = createDatabase(":memory:")
    db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES ('/sessions/root.jsonl', 'root', '/work/project', 'Root', '2026-01-01T00:00:00.000Z', NULL, 'root')"
    ).run()
    replaceAgentObservations(db, "/sessions/root.jsonl", [
      normalizedObservation({
        id: "hidden-agent",
        sourcePath: "/sessions/root.jsonl",
        rootId: "root",
        sourceEntryId: "hidden-entry",
      }),
    ])
    reconcileAgentRuns(db)
    db.prepare(
      "INSERT INTO hidden_models (provider, model, hidden_at) VALUES ('openai', 'gpt-child', '2026-01-01T00:00:00.000Z')"
    ).run()

    expect(getSessions(db, filters, options("startedAt", "desc")).total).toBe(0)
    expect(
      getSessions(
        db,
        { ...filters, provider: "openai", model: "gpt-child" },
        options("startedAt", "desc")
      ).total
    ).toBe(0)

    db.prepare("DELETE FROM hidden_models").run()
    expect(
      getSessions(db, filters, options("startedAt", "desc"))
    ).toMatchObject({ total: 1, rows: [{ agents: [{ id: "hidden-agent" }] }] })
    db.close()
  })

  it("efface le nom des sessions enfant liées sans perdre leur rattachement", () => {
    const db = createDatabase(":memory:")
    const insert = db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES (?, ?, '/work/project', ?, '2026-01-01T00:00:00.000Z', ?, ?)"
    )
    insert.run("/sessions/root.jsonl", "root", "Root", null, "root")
    insert.run(
      "/sessions/child.jsonl",
      "child-session",
      "reviewer: PRIVATE NICO TASK",
      "/sessions/root.jsonl",
      "child-session"
    )
    const observation = normalizedObservation({
      id: "nico-child",
      sourcePath: "/sessions/root.jsonl",
      rootId: "root",
      sourceEntryId: "nico-entry",
    })
    observation.adapter = "nicobailon"
    observation.sessionFile = "/sessions/child.jsonl"
    replaceAgentObservations(db, "/sessions/root.jsonl", [observation])

    reconcileAgentRuns(db)

    const linked = db
      .prepare(
        "SELECT name, session_kind, agent_run_key FROM sessions WHERE file_path = '/sessions/child.jsonl'"
      )
      .get() as Record<string, unknown>
    expect(linked).toMatchObject({ name: null, session_kind: "agent" })
    expect(linked.agent_run_key).toBeTruthy()
    expect(
      JSON.stringify(getSessions(db, filters, options("startedAt", "desc")))
    ).not.toContain("PRIVATE NICO TASK")

    reconcileAgentRuns(db)
    expect(
      getSessions(db, filters, options("startedAt", "desc")).rows[0]?.agents[0]
        ?.id
    ).toBe("nico-child")
    db.close()
  })

  it("n’additionne pas un agrégat subtree à ses enfants", () => {
    const db = createDatabase(":memory:")
    db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES ('/sessions/root.jsonl', 'root', '/work/project', 'Root', '2026-01-01T00:00:00.000Z', NULL, 'root')"
    ).run()
    const makeObservation = (
      id: string,
      tokens: number,
      scope: "self" | "subtree",
      parentNativeId: string | null
    ): AgentObservation => ({
      observationKey: `observation:${id}`,
      nativeRunKey: id,
      nativeId: id,
      adapter: "tintinweb",
      channel: "tool-details",
      sourcePath: "/sessions/root.jsonl",
      sourceEntryId: id,
      artifactVersion: null,
      rootSessionRef: "root",
      rootSessionFile: "/sessions/root.jsonl",
      sessionFile: null,
      parentNativeId,
      workflowId: null,
      workflowStepIndex: null,
      agentType: "worker",
      displayName: "worker",
      description: null,
      statusRaw: "completed",
      status: "completed",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:02.000Z",
      provider: "openai",
      modelId: "gpt-child",
      modelLabel: null,
      usage: {
        inputTokens: tokens,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: tokens,
        totalCost: tokens / 1000,
        requestCount: null,
        toolCount: null,
        turnCount: null,
        scope,
      },
      precision: {
        identity: "exact",
        linkage: "exact",
        model: "exact",
        tokens: "reported",
        cost: "reported",
      },
      metadataPriority: 50,
      usagePriority: 50,
    })
    replaceAgentObservations(db, "/sessions/root.jsonl", [
      makeObservation("parent-agent", 100, "subtree", null),
      makeObservation("child-agent", 30, "self", "parent-agent"),
    ])

    reconcileAgentRuns(db)

    const row = getSessions(db, filters, options("startedAt", "desc")).rows[0]!
    expect(row.tokens).toBe(30)
    expect(row.cost).toBeCloseTo(0.03)
    expect(
      row.agents.find((agent) => agent.id === "parent-agent")
    ).toMatchObject({
      usage: { includedInSessionTotal: false, coverage: "partial" },
    })
    expect(
      row.agents.find((agent) => agent.id === "child-agent")
    ).toMatchObject({ depth: 2, usage: { includedInSessionTotal: true } })

    const childWithRequest = makeObservation(
      "request-child",
      0,
      "self",
      "parent-agent"
    )
    childWithRequest.channel = "output"
    childWithRequest.sourcePath = "/tmp/request-child.output"
    childWithRequest.sessionFile = "/tmp/request-child.output"
    childWithRequest.usage = null
    db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES ('/tmp/request-child.output', 'request-child', '/work/project', NULL, '2026-01-01T00:00:01.000Z', NULL, 'request-child')"
    ).run()
    db.prepare(
      `INSERT INTO requests (
        id, source_key, request_key, file_path, session_id,
        accounting_session_id, cwd, timestamp, provider, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        total_tokens, cost, is_error, duration_ms
      ) VALUES (
        'child-request', 'child-request', 'child-request',
        '/tmp/request-child.output', 'request-child', 'request-child',
        '/work/project', '2026-01-01T00:00:02.000Z', 'openai', 'gpt-child',
        40, 10, 0, 0, 50, 0.05, 0, 0
      )`
    ).run()
    replaceAgentObservations(db, "/sessions/root.jsonl", [
      makeObservation("parent-agent", 100, "subtree", null),
      childWithRequest,
    ])
    reconcileAgentRuns(db)
    const requestBacked = getSessions(db, filters, options("startedAt", "desc"))
      .rows[0]!
    expect(requestBacked.tokens).toBe(50)
    expect(
      requestBacked.agents.find((agent) => agent.id === "parent-agent")?.usage
    ).toMatchObject({ includedInSessionTotal: false, coverage: "partial" })
    db.prepare("DELETE FROM requests").run()

    const middle = makeObservation("middle-agent", 0, "self", "parent-agent")
    middle.usage = null
    replaceAgentObservations(db, "/sessions/root.jsonl", [
      makeObservation("parent-agent", 100, "subtree", null),
      middle,
      makeObservation("grandchild-agent", 30, "self", "middle-agent"),
    ])
    reconcileAgentRuns(db)
    const nested = getSessions(db, filters, options("startedAt", "desc"))
      .rows[0]!
    expect(nested.tokens).toBe(30)
    expect(
      nested.agents.find((agent) => agent.id === "parent-agent")?.usage
    ).toMatchObject({ includedInSessionTotal: false, coverage: "partial" })
    expect(
      nested.agents.find((agent) => agent.id === "grandchild-agent")?.depth
    ).toBe(3)
    db.close()
  })

  it("ne duplique pas les agents copiés dans une session forkée", () => {
    const db = createDatabase(":memory:")
    const insertSession = db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES (?, ?, '/work/project', ?, ?, ?, ?)"
    )
    const insertRequest = db.prepare(
      "INSERT INTO requests (id, source_key, request_key, file_path, session_id, accounting_session_id, cwd, timestamp, provider, model, input_tokens, cache_read_tokens, total_tokens, cost, is_error, duration_ms) VALUES (?, ?, ?, ?, ?, ?, '/work/project', ?, 'test', 'model', 1, 0, 1, 0.01, 0, 0)"
    )

    try {
      insertSession.run(
        "/sessions/original.jsonl",
        "original",
        "Original",
        "2026-01-01T00:00:00.000Z",
        null,
        "original"
      )
      insertSession.run(
        "/sessions/fork.jsonl",
        "fork",
        "Fork",
        "2026-01-02T00:00:00.000Z",
        "/sessions/original.jsonl",
        "fork"
      )
      insertRequest.run(
        "original-request",
        "original-request",
        "original-request",
        "/sessions/original.jsonl",
        "original",
        "original",
        "2026-01-01T00:00:00.000Z"
      )
      insertRequest.run(
        "fork-request",
        "fork-request",
        "fork-request",
        "/sessions/fork.jsonl",
        "fork",
        "fork",
        "2026-01-02T00:00:00.000Z"
      )
      const copiedObservation = (
        sourcePath: string,
        rootId: string
      ): AgentObservation => ({
        observationKey: `copy:${sourcePath}`,
        nativeRunKey: "agent-copy",
        nativeId: "agent-copy",
        adapter: "tintinweb",
        channel: "tool-details",
        sourcePath,
        sourceEntryId: "copied-agent",
        artifactVersion: null,
        rootSessionRef: rootId,
        rootSessionFile: sourcePath,
        sessionFile: null,
        parentNativeId: null,
        workflowId: null,
        workflowStepIndex: null,
        agentType: "reviewer",
        displayName: "reviewer",
        description: null,
        statusRaw: "completed",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        provider: "test",
        modelId: "agent-model",
        modelLabel: null,
        usage: {
          inputTokens: 60,
          outputTokens: 40,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 100,
          totalCost: 0.2,
          requestCount: null,
          toolCount: null,
          turnCount: null,
          scope: "self",
        },
        precision: {
          identity: "exact",
          linkage: "reported",
          model: "reported",
          tokens: "reported",
          cost: "reported",
        },
        metadataPriority: 40,
        usagePriority: 40,
      })
      replaceAgentObservations(db, "/sessions/original.jsonl", [
        copiedObservation("/sessions/original.jsonl", "original"),
      ])
      replaceAgentObservations(db, "/sessions/fork.jsonl", [
        copiedObservation("/sessions/fork.jsonl", "fork"),
      ])
      reconcileAgentRuns(db)

      const rows = getSessions(db, filters, options("startedAt", "desc")).rows
      expect(rows.find(({ id }) => id === "original")?.agents).toHaveLength(1)
      expect(rows.find(({ id }) => id === "fork")?.agents).toEqual([])
    } finally {
      db.close()
    }
  })
})

describe("getSessionTrace", () => {
  it("ordonne la trace, déduplique les événements et conserve les timings inconnus", () => {
    const db = createDatabase(":memory:")
    const rootFile = "/sessions/trace.jsonl"
    const childFile = "/sessions/trace-child.jsonl"
    db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES (?, 'trace-root', '/work/project', 'Trace root', '2026-01-01T00:00:00.000Z', NULL, 'trace-root')"
    ).run(rootFile)
    db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id, session_kind) VALUES (?, 'trace-child', '/work/project', NULL, '2026-01-01T00:00:01.000Z', ?, 'trace-root', 'agent')"
    ).run(childFile, rootFile)

    const parent = normalizedObservation({
      id: "parent",
      sourcePath: rootFile,
      rootId: "trace-root",
      sourceEntryId: "parent-entry",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
    })
    const child = normalizedObservation({
      id: "child",
      sourcePath: rootFile,
      rootId: "trace-root",
      sourceEntryId: "child-entry",
      parentNativeId: "parent",
      startedAt: "2026-01-01T00:00:02.000Z",
      completedAt: "2026-01-01T00:00:04.000Z",
    })
    parent.displayName = "parent"
    child.displayName = "child"
    child.sessionFile = childFile
    const untimed = normalizedObservation({
      id: "untimed",
      sourcePath: rootFile,
      rootId: "trace-root",
      sourceEntryId: "untimed-entry",
      startedAt: null,
      completedAt: null,
    })
    untimed.displayName = "untimed"
    untimed.usage = null
    replaceAgentObservations(db, rootFile, [parent, child, untimed])
    reconcileAgentRuns(db)

    const runKeys = new Map(
      (
        db.prepare("SELECT native_id, run_key FROM agent_runs").all() as Array<{
          native_id: string
          run_key: string
        }>
      ).map((row) => [row.native_id, row.run_key])
    )
    const insertRequest = db.prepare(
      `INSERT INTO requests (
        id, source_key, request_key, file_path, session_id,
        accounting_session_id, agent_run_key, cwd, timestamp, provider, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        total_tokens, cost, is_error, duration_ms, usage_scope
      ) VALUES (?, ?, ?, ?, ?, 'trace-root', ?, '/work/project', ?, 'openai',
        'gpt', 1, 1, 0, 0, ?, ?, 0, ?, ?)`
    )
    insertRequest.run(
      "parent-request",
      "parent-source",
      "parent-key",
      rootFile,
      "trace-root",
      runKeys.get("parent"),
      "2026-01-01T00:00:03.000Z",
      10,
      0.1,
      2_000,
      "self"
    )
    insertRequest.run(
      "child-request",
      "child-source",
      "child-key",
      childFile,
      "trace-child",
      runKeys.get("child"),
      "2026-01-01T00:00:04.000Z",
      20,
      0.2,
      1_000,
      "self"
    )
    insertRequest.run(
      "duplicate-request",
      "duplicate-source",
      "parent-key",
      childFile,
      "trace-child",
      runKeys.get("parent"),
      "2026-01-01T00:00:03.000Z",
      999,
      9.99,
      2_000,
      "self"
    )
    insertRequest.run(
      "unassigned-request",
      "unassigned-source",
      "unassigned-key",
      rootFile,
      "trace-root",
      null,
      "2026-01-01T00:00:05.000Z",
      5,
      0.05,
      0,
      "unassigned"
    )
    db.prepare(
      `INSERT INTO tool_calls (
        id, source_key, file_path, session_id, cwd, name, provider, model,
        started_at, duration_ms, is_error, agent_run_key
      ) VALUES ('tool', 'tool-source', ?, 'trace-child', '/work/project',
        'bash', 'openai', 'gpt', '2026-01-01T00:00:03.000Z', 500, 1, ?)`
    ).run(childFile, runKeys.get("child"))

    expect(
      db.prepare("SELECT COUNT(*) FROM unique_tool_calls").pluck().get()
    ).toBe(1)
    expect(
      db
        .prepare(
          "SELECT COUNT(*) FROM unique_tool_calls AS tool JOIN sessions AS owner ON owner.file_path = tool.file_path WHERE owner.accounting_session_id = ? AND tool.project = ?"
        )
        .pluck()
        .get("trace-root", "/work/project")
    ).toBe(1)
    const trace = getSessionTrace(db, "trace-root", "/work/project")
    expect(trace).not.toBeNull()
    expect(trace?.session).toMatchObject({
      name: "Trace root",
      requests: 2,
      tokens: 30,
      durationMs: 5_000,
    })
    expect(trace?.session.cost).toBeCloseTo(0.3)
    expect(trace?.bounds).toEqual({
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:05.000Z",
    })
    expect(trace?.spans.filter((span) => span.kind === "request")).toHaveLength(
      3
    )
    expect(trace?.spans.find((span) => span.label === "gpt")?.startedAt).toBe(
      "2026-01-01T00:00:01.000Z"
    )
    expect(
      trace?.spans.map((span) => [span.kind, span.label, span.depth])
    ).toEqual([
      ["agent", "parent", 0],
      ["request", "gpt", 1],
      ["agent", "child", 1],
      ["request", "gpt", 2],
      ["tool", "bash", 2],
      ["request", "gpt", 0],
      ["agent", "untimed", 0],
    ])
    expect(trace?.spans.find((span) => span.label === "untimed")).toMatchObject(
      { startedAt: null, durationMs: null }
    )
    expect(
      trace?.spans.find((span) => span.id.includes("unassigned-request"))
        ?.includedInSessionTotal
    ).toBe(false)
    expect(getSessionTrace(db, "trace-root", "/work/other")).toBeNull()

    db.prepare(
      `INSERT INTO hidden_models (provider, model, hidden_at) VALUES
        ('openai', 'gpt', '2026-01-02T00:00:00.000Z'),
        ('openai', 'gpt-child', '2026-01-02T00:00:00.000Z')`
    ).run()
    expect(getSessionTrace(db, "trace-root", "/work/project")).toMatchObject({
      session: { requests: 0, tokens: 0, cost: 0 },
      spans: [],
    })

    db.prepare(
      `INSERT INTO sessions (
        file_path, session_id, cwd, name, started_at, parent_session,
        accounting_session_id
      ) VALUES (
        '/sessions/cross.jsonl', 'cross-root', '/work/root', 'Cross root',
        '2026-01-01T00:00:00.000Z', NULL, 'cross-root'
      )`
    ).run()
    db.prepare(
      `INSERT INTO requests (
        id, source_key, request_key, file_path, session_id,
        accounting_session_id, cwd, timestamp, provider, model, input_tokens,
        output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
        cost, is_error, duration_ms, usage_scope
      ) VALUES (
        'cross-request', 'cross-source', 'cross-key',
        '/sessions/cross.jsonl', 'cross-root', 'cross-root', '/work/cross',
        '2026-01-01T00:00:01.000Z', 'openai', 'gpt', 1, 1, 0, 0, 2,
        0.01, 0, 1000, 'self'
      )`
    ).run()
    expect(getSessionTrace(db, "cross-root", "/work/cross")).toMatchObject({
      session: { requests: 0, tokens: 0, cost: 0 },
      spans: [],
    })
    db.close()
  })

  it("utilise la fin connue d'un agent sans inventer son début", () => {
    const db = createDatabase(":memory:")
    const rootFile = "/sessions/completed-only.jsonl"
    const otherRootFile = "/sessions/completed-only-other.jsonl"
    const insertSession = db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES (?, 'completed-only', ?, 'Root', '2026-01-01T00:00:00.000Z', NULL, 'completed-only')"
    )
    insertSession.run(rootFile, "/work/project")
    insertSession.run(otherRootFile, "/work/other")

    const visible = normalizedObservation({
      id: "visible",
      sourcePath: rootFile,
      rootId: "completed-only",
      sourceEntryId: "visible-entry",
      startedAt: null,
      completedAt: "2026-01-01T00:30:00.000Z",
    })
    visible.modelId = "visible-model"
    const hidden = normalizedObservation({
      id: "hidden",
      sourcePath: rootFile,
      rootId: "completed-only",
      sourceEntryId: "hidden-entry",
      startedAt: null,
      completedAt: "2026-01-01T00:45:00.000Z",
    })
    hidden.modelId = "hidden-model"
    const otherProject = normalizedObservation({
      id: "other-project",
      sourcePath: otherRootFile,
      rootId: "completed-only",
      sourceEntryId: "other-project-entry",
      startedAt: null,
      completedAt: "2026-01-01T01:00:00.000Z",
    })
    otherProject.modelId = "other-model"
    replaceAgentObservations(db, rootFile, [visible, hidden])
    replaceAgentObservations(db, otherRootFile, [otherProject])
    reconcileAgentRuns(db)
    db.prepare(
      "INSERT INTO hidden_models (provider, model, hidden_at) VALUES ('openai', 'hidden-model', '2026-01-02T00:00:00.000Z')"
    ).run()

    const trace = getSessionTrace(db, "completed-only", "/work/project")
    expect(trace?.session).toMatchObject({ durationMs: 30 * 60 * 1_000 })
    expect(trace?.bounds).toEqual({
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:30:00.000Z",
    })
    expect(trace?.spans).toHaveLength(1)
    expect(trace?.spans[0]).toMatchObject({
      label: "worker",
      model: "visible-model",
      startedAt: null,
      durationMs: null,
    })
    db.close()
  })

  it("ne recompte pas un agent lié seulement par une copie non canonique", () => {
    const db = createDatabase(":memory:")
    const rootFile = "/sessions/dedup-root.jsonl"
    const childFile = "/sessions/dedup-child.jsonl"
    const insertSession = db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id, session_kind) VALUES (?, ?, '/work/project', ?, '2026-01-01T00:00:00.000Z', ?, 'dedup-root', ?)"
    )
    insertSession.run(rootFile, "dedup-root", "Root", null, "root")
    insertSession.run(childFile, "dedup-child", null, rootFile, "agent")
    const observation = normalizedObservation({
      id: "copied-agent",
      sourcePath: rootFile,
      rootId: "dedup-root",
      sourceEntryId: "copied-entry",
    })
    observation.displayName = "copied-agent"
    observation.sessionFile = childFile
    replaceAgentObservations(db, rootFile, [observation])
    reconcileAgentRuns(db)
    const runKey = String(
      db.prepare("SELECT run_key FROM agent_runs").pluck().get()
    )
    const insertRequest = db.prepare(
      `INSERT INTO requests (
        id, source_key, request_key, file_path, session_id,
        accounting_session_id, agent_run_key, cwd, timestamp, provider, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        total_tokens, cost, is_error, duration_ms, usage_scope
      ) VALUES (?, ?, 'shared-key', ?, ?, 'dedup-root', ?, '/work/project',
        '2026-01-01T00:00:01.000Z', 'openai', 'gpt', 5, 5, 0, 0, 10,
        0.1, 0, 1000, 'self')`
    )
    insertRequest.run(
      "canonical",
      "canonical-source",
      rootFile,
      "dedup-root",
      null
    )
    insertRequest.run(
      "copied",
      "copied-source",
      childFile,
      "dedup-child",
      runKey
    )

    const trace = getSessionTrace(db, "dedup-root", "/work/project")
    expect(trace?.session).toMatchObject({ requests: 1, tokens: 10, cost: 0.1 })
    expect(trace?.spans.filter((span) => span.kind === "request")).toHaveLength(
      1
    )
    expect(trace?.spans.filter((span) => span.kind === "agent")).toEqual([])
    db.close()
  })
})
