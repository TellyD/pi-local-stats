import { afterEach, describe, expect, it } from "vitest"
import type { AgentObservation } from "../server/agent-adapters/index.ts"
import { nicobailonAdapter } from "../server/agent-adapters/nicobailon.ts"
import {
  reconcileAgentRuns,
  replaceAgentObservations,
} from "../server/agents.ts"
import { createDatabase } from "../server/database.ts"
import { deleteModelHistory } from "../server/model-history.ts"

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function setup() {
  const db = createDatabase(":memory:")
  databases.push(db)
  db.prepare(
    `INSERT INTO sessions (file_path, session_id, cwd, started_at, accounting_session_id)
    VALUES ('/output', 'output', '/', '2026-01-01T00:00:00Z', 'output')`
  ).run()
  return db
}
function observation(
  key: string,
  overrides: Partial<AgentObservation> = {}
): AgentObservation {
  return {
    observationKey: key,
    nativeRunKey: key,
    nativeId: key,
    adapter: "tintinweb",
    channel: "tool-details",
    sourcePath: `/${key}`,
    sourceEntryId: null,
    artifactVersion: null,
    rootSessionRef: "root",
    rootSessionFile: "/root",
    sessionFile: null,
    parentNativeId: null,
    workflowId: null,
    workflowStepIndex: null,
    agentType: "worker",
    displayName: "worker",
    description: null,
    statusRaw: "completed",
    status: "completed",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    provider: "test",
    modelId: "deleted",
    modelLabel: null,
    usage: {
      inputTokens: 50,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 50,
      totalCost: 1,
      requestCount: 1,
      toolCount: 1,
      turnCount: 1,
      scope: "self",
    },
    precision: {
      identity: "exact",
      linkage: "reported",
      model: "reported",
      tokens: "reported",
      cost: "reported",
    },
    metadataPriority: 50,
    usagePriority: 50,
    ...overrides,
  }
}
function put(db: ReturnType<typeof setup>, ...rows: AgentObservation[]) {
  for (const row of rows) replaceAgentObservations(db, row.sourcePath, [row])
  reconcileAgentRuns(db)
}
function total(db: ReturnType<typeof setup>) {
  return db
    .prepare(
      "SELECT COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS rows FROM accounted_usage"
    )
    .get()
}
function request(
  db: ReturnType<typeof setup>,
  key: string,
  model = "deleted",
  path = "/output"
) {
  db.prepare(
    `INSERT INTO requests (id, source_key, request_key, file_path, session_id, accounting_session_id, cwd, timestamp, provider, model, input_tokens, cache_read_tokens, total_tokens, cost, is_error, duration_ms)
    VALUES (?, ?, ?, ?, 'root', 'root', '/', '2026-01-01T00:00:00Z', 'test', ?, 7, 0, 7, 1, 0, 0)`
  ).run(key, key, key, path, model)
}

function session(db: ReturnType<typeof setup>, path: string, id: string) {
  db.prepare(
    `INSERT INTO sessions (file_path, session_id, cwd, started_at, accounting_session_id)
    VALUES (?, ?, '/', '2026-01-01', ?)`
  ).run(path, id, id)
}
function nicoDetails(path: string, model = "test/deleted") {
  return nicobailonAdapter.inspect({
    filePath: path,
    session: {
      id: "root",
      cwd: "/",
      name: null,
      startedAt: "2026-01-01",
      parentSession: null,
    },
    records: [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "subagent",
          details: {
            runId: "run",
            results: [{ index: 0, agent: "worker", model, totalTokens: 7 }],
          },
        },
      },
    ],
  }).observations
}
function nicoStatus(runId: string, step: Record<string, unknown>) {
  return nicobailonAdapter.inspect({
    filePath: `/tmp/async-subagent-runs/${runId}/status.json`,
    session: null,
    records: [
      {
        lifecycleArtifactVersion: 3,
        runId,
        sessionId: "root",
        steps: [{ index: 0, agent: "worker", ...step }],
      },
    ],
  }).observations
}

describe("nicobailon deletion lifecycle", () => {
  it("remembers the root ID when the root file and original channel disappear", () => {
    const db = setup()
    session(db, "/root.jsonl", "root")
    put(db, ...nicoDetails("/root.jsonl"))
    expect(total(db)).toEqual({ tokens: 7, rows: 1 })
    deleteModelHistory(db, "test", "deleted")
    db.prepare("DELETE FROM sessions WHERE file_path = '/root.jsonl'").run()
    db.prepare("DELETE FROM agent_observations").run()
    const events = nicobailonAdapter.inspect({
      filePath: "/tmp/async-subagent-runs/run/events.jsonl",
      session: null,
      records: [
        {
          type: "subagent.step.completed",
          lifecycleArtifactVersion: 3,
          runId: "run",
          stepIndex: 0,
          sessionId: "root",
          model: "test/deleted",
          totalTokens: 7,
        },
      ],
    }).observations
    expect(events).toHaveLength(1)
    put(db, ...events)
    expect(total(db)).toEqual({ tokens: 0, rows: 0 })
  })

  it.each([false, true])(
    "keeps distinct explicit paths with reused root/native IDs (second root already indexed: %s)",
    (alreadyIndexed) => {
      const db = setup()
      session(db, "/root.jsonl", "root")
      if (alreadyIndexed) session(db, "/other.jsonl", "root")
      put(db, ...nicoDetails("/root.jsonl"))
      deleteModelHistory(db, "test", "deleted")
      // This explicit path must not match the first root's remembered ID alias,
      // even if its own session has not been indexed yet.
      put(db, ...nicoDetails("/other.jsonl", "test/other"))
      expect(total(db)).toEqual({ tokens: 7, rows: 1 })
      if (alreadyIndexed) {
        expect(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM deleted_agent_usage WHERE kind = 'alias' AND record_key = ?"
            )
            .get(
              JSON.stringify(["nicobailon", "root", JSON.stringify(["run", 0])])
            )
        ).toEqual({ count: 0 })
      }
    }
  )

  it("uses erased transcript provenance when running status receives late linkage", () => {
    const db = setup()
    session(db, "/root.jsonl", "root")
    session(db, "/child.jsonl", "child")
    request(db, "old")
    db.prepare(
      "UPDATE requests SET file_path = '/child.jsonl', session_id = 'child', accounting_session_id = 'child'"
    ).run()
    const running = nicoStatus("run", { status: "running" })
    expect(running).toHaveLength(1)
    put(db, ...running)
    expect(total(db)).toEqual({ tokens: 7, rows: 1 })
    expect(db.prepare("SELECT agent_run_key FROM requests").get()).toEqual({
      agent_run_key: null,
    })
    deleteModelHistory(db, "test", "deleted")
    put(
      db,
      ...nicoStatus("run", {
        status: "completed",
        sessionFile: "/child.jsonl",
        model: "test/deleted",
        totalTokens: 7,
      })
    )
    expect(total(db)).toEqual({ tokens: 0, rows: 0 })
    request(db, "future")
    db.prepare(
      "UPDATE requests SET file_path = '/child.jsonl', session_id = 'child'"
    ).run()
    reconcileAgentRuns(db)
    expect(total(db)).toEqual({ tokens: 7, rows: 1 })
    session(db, "/fresh.jsonl", "fresh")
    put(
      db,
      ...nicoStatus("new-run", {
        status: "completed",
        sessionFile: "/fresh.jsonl",
        model: "test/deleted",
        totalTokens: 9,
      })
    )
    expect(total(db)).toEqual({ tokens: 16, rows: 2 })
  })

  it("does not use orchestration tool-details source paths as owned transcripts", () => {
    const db = setup()
    session(db, "/root.jsonl", "root")
    request(db, "root-request")
    db.prepare("UPDATE requests SET file_path = '/root.jsonl'").run()
    deleteModelHistory(db, "test", "deleted")
    put(db, ...nicoDetails("/root.jsonl"))
    expect(total(db)).toEqual({ tokens: 7, rows: 1 })
  })
})

describe("deleted agent aggregate cohorts", () => {
  it("carries erased-source evidence to copies when rejecting old records", () => {
    const db = setup()
    request(db, "old")
    deleteModelHistory(db, "test", "deleted")
    session(db, "/copy.jsonl", "root")
    request(db, "old", "deleted", "/copy.jsonl")
    expect(db.prepare("SELECT COUNT(*) FROM requests").pluck().get()).toBe(0)
    put(
      db,
      observation("copy", { channel: "output", sourcePath: "/copy.jsonl" })
    )
    expect(total(db)).toEqual({ tokens: 0, rows: 0 })
    request(db, "new", "deleted", "/copy.jsonl")
    reconcileAgentRuns(db)
    expect(total(db)).toEqual({ tokens: 7, rows: 1 })
  })

  it("marks every channel when only a hidden nonselected observation matches", () => {
    const db = setup()
    const main = observation("main", { modelId: "other" })
    const hidden = observation("hidden", {
      nativeRunKey: "main",
      nativeId: "main",
      metadataPriority: 1,
      usagePriority: 1,
    })
    const unknown = observation("unknown", {
      nativeRunKey: "main",
      nativeId: "main",
      provider: null,
      modelId: null,
    })
    put(db, main, hidden, unknown)
    db.prepare(
      "INSERT INTO hidden_models (provider, model, hidden_at) VALUES ('test', 'deleted', '2026-01-01')"
    ).run()
    expect(total(db)).toEqual({ tokens: 50, rows: 1 })
    deleteModelHistory(db, "test", "deleted")
    put(db, main, hidden, unknown)
    expect(total(db)).toEqual({ tokens: 0, rows: 0 })
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM agent_observations WHERE total_tokens IS NOT NULL OR request_count IS NOT NULL OR tool_count IS NOT NULL"
        )
        .get()
    ).toEqual({ count: 0 })
  })

  it.each(["tool_calls", "skill_usages"])(
    "captures runs linked only through %s",
    (table) => {
      const db = setup()
      put(
        db,
        observation("run", {
          channel: "output",
          sourcePath: "/output",
          modelId: "other",
        })
      )
      const fields =
        table === "tool_calls"
          ? "name, started_at, duration_ms, is_error"
          : "skill, used_at"
      const values =
        table === "tool_calls"
          ? "'read', '2026-01-01', 0, 0"
          : "'skill', '2026-01-01'"
      db.prepare(
        `INSERT INTO ${table} (id, source_key, file_path, session_id, cwd, provider, model, ${fields})
      VALUES ('old', 'old', '/output', 'root', '/', 'test', 'deleted', ${values})`
      ).run()
      reconcileAgentRuns(db)
      expect(deleteModelHistory(db, "test", "deleted")).toBe(true)
      expect(total(db)).toEqual({ tokens: 0, rows: 0 })
    }
  )

  it("keeps exact surviving/new requests without activating cumulative fallback", () => {
    const db = setup()
    const row = observation("child", {
      channel: "output",
      sourcePath: "/output",
      modelId: "other",
    })
    put(db, row)
    request(db, "old")
    request(db, "survivor", "other")
    reconcileAgentRuns(db)
    expect(total(db)).toEqual({ tokens: 14, rows: 2 })
    expect(deleteModelHistory(db, "test", "deleted")).toBe(true)
    expect(total(db)).toEqual({ tokens: 7, rows: 1 })
    expect(
      db
        .prepare("SELECT total_tokens, usage_scope FROM agent_observations")
        .get()
    ).toEqual({ total_tokens: null, usage_scope: null })
    put(db, row)
    expect(total(db)).toEqual({ tokens: 7, rows: 1 })
    deleteModelHistory(db, "test", "other")
    expect(total(db)).toEqual({ tokens: 0, rows: 0 })
    request(db, "future")
    reconcileAgentRuns(db)
    expect(total(db)).toEqual({ tokens: 7, rows: 1 })
    expect(
      db.prepare("SELECT agent_run_key FROM requests").get()
    ).toMatchObject({ agent_run_key: expect.any(String) })
  })

  it("clears unknown ancestor subtree totals, keeps ancestor self and sibling usage", () => {
    const db = setup()
    const parent = observation("parent", { provider: null, modelId: null })
    parent.usage = { ...parent.usage!, scope: "subtree", totalTokens: 200 }
    const self = observation("self", {
      nativeRunKey: "parent",
      nativeId: "parent",
      modelId: "other",
      usagePriority: 10,
    })
    const child = observation("child", {
      parentNativeId: "parent",
      channel: "output",
      sourcePath: "/output",
      provider: null,
      modelId: null,
    })
    const sibling = observation("sibling", {
      parentNativeId: "parent",
      modelId: "other",
    })
    put(db, parent, self, child, sibling)
    request(db, "child-request")
    reconcileAgentRuns(db)
    expect(deleteModelHistory(db, "test", "deleted")).toBe(true)
    expect(total(db)).toEqual({ tokens: 100, rows: 2 })
    expect(
      db
        .prepare(
          "SELECT total_tokens FROM agent_observations WHERE observation_key = 'parent'"
        )
        .get()
    ).toEqual({ total_tokens: null })
    // The child disappearing must not release the ancestor's subtree fallback.
    db.prepare(
      "DELETE FROM agent_observations WHERE observation_key = 'child'"
    ).run()
    put(db, parent)
    expect(total(db)).toEqual({ tokens: 100, rows: 2 })
  })

  it("follows orphan resolution and late channels after all old observations disappear", () => {
    const db = setup()
    const orphan = observation("original", {
      nativeRunKey: "run",
      nativeId: "run",
      rootSessionRef: null,
      rootSessionFile: null,
    })
    put(db, orphan)
    deleteModelHistory(db, "test", "deleted")
    const resolved = {
      ...orphan,
      rootSessionFile: "/resolved",
      rootSessionRef: "resolved",
    }
    const late = observation("late", {
      nativeRunKey: "run",
      nativeId: "run",
      rootSessionFile: "/resolved",
      rootSessionRef: "resolved",
      modelId: null,
    })
    put(db, resolved, late)
    expect(total(db)).toEqual({ tokens: 0, rows: 0 })
    db.prepare("DELETE FROM agent_observations").run()
    put(
      db,
      observation("later", {
        ...late,
        observationKey: "later",
        sourcePath: "/later",
      })
    )
    expect(total(db)).toEqual({ tokens: 0, rows: 0 })
    put(
      db,
      observation("new", { nativeRunKey: "new", rootSessionFile: "/resolved" })
    )
    expect(total(db)).toEqual({ tokens: 50, rows: 1 })
  })

  it("does not suppress an ancestor in another root when session IDs are null", () => {
    const db = setup()
    const parent = observation("parent-other", {
      nativeRunKey: "parent",
      nativeId: "parent",
      rootSessionFile: "/other",
      rootSessionRef: null,
      modelId: "other",
    })
    parent.usage = { ...parent.usage!, scope: "subtree" }
    const child = observation("child", {
      parentNativeId: "parent",
      rootSessionRef: null,
    })
    put(db, parent, child)
    deleteModelHistory(db, "test", "deleted")
    expect(total(db)).toEqual({ tokens: 50, rows: 1 })
  })

  it("does not suppress reused native IDs in another root or unrelated bare orphans", () => {
    const db = setup()
    const first = observation("first", {
      nativeRunKey: "same",
      nativeId: "same",
    })
    const other = observation("other", {
      nativeRunKey: "same",
      nativeId: "same",
      rootSessionFile: "/other",
      rootSessionRef: "other",
      modelId: "other",
    })
    put(db, first, other)
    deleteModelHistory(db, "test", "deleted")
    put(db, other)
    expect(total(db)).toEqual({ tokens: 50, rows: 1 })
    db.prepare("DELETE FROM agent_observations").run()
    put(
      db,
      observation("orphan", {
        nativeRunKey: "same",
        nativeId: "same",
        rootSessionFile: null,
        rootSessionRef: null,
      })
    )
    expect(total(db)).toEqual({ tokens: 50, rows: 1 })
  })
})
