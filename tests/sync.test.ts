import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

import { tintinwebAdapter } from "../server/agent-adapters/tintinweb.ts"
import { createDatabase } from "../server/database.ts"
import { getSessions, getStats } from "../server/stats.ts"
import {
  parseSessionJsonl,
  parseSourceRecords,
  SessionSynchronizer,
} from "../server/sync.ts"

const temporaryDirectories: string[] = []
const run = promisify(execFile)
const firstSessionPage = {
  page: 1,
  pageSize: 10,
  sort: "startedAt",
  direction: "desc",
} as const
const filters = {
  range: "all" as const,
  project: "",
  provider: "",
  model: "",
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

function sessionFixture() {
  return [
    {
      type: "session",
      version: 3,
      id: "session-1",
      timestamp: "2026-01-01T10:00:00.000Z",
      cwd: "/work/private-project",
    },
    {
      type: "session_info",
      id: "info-1",
      parentId: null,
      timestamp: "2026-01-01T10:00:00.500Z",
      name: "Refonte privée",
    },
    {
      type: "message",
      id: "user-1",
      parentId: null,
      timestamp: "2026-01-01T10:00:01.000Z",
      message: { role: "user", content: "contenu confidentiel" },
    },
    {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      timestamp: "2026-01-01T10:00:03.500Z",
      message: {
        role: "assistant",
        provider: "openai-codex",
        model: "gpt-test",
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "read",
            arguments: {
              path: "/work/.agents/skills/frontend-design/SKILL.md",
            },
          },
        ],
        usage: {
          input: 100,
          output: 25,
          cacheRead: 50,
          cacheWrite: 5,
          totalTokens: 180,
          cost: { total: 0.012 },
        },
      },
    },
    "{invalid-json",
    {
      type: "message",
      id: "tool-result-1",
      parentId: "assistant-1",
      timestamp: "2026-01-01T10:00:04.000Z",
      message: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        isError: true,
        errorMessage: "SECRET_CONTENT",
        content: [{ type: "text", text: "sortie confidentielle" }],
        usage: {
          input: 10,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 12,
          cost: { total: 0.001 },
        },
      },
    },
    {
      type: "compaction",
      id: "compact-1",
      parentId: "tool-result-1",
      timestamp: "2026-01-01T10:00:05.000Z",
      usage: {
        input: 20,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 25,
        cost: { total: 0.002 },
      },
      retainedTail: [{ role: "assistant", usage: { totalTokens: 999_999 } }],
    },
  ]
    .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
    .join("\n")
}

function forkedSessionFixture(parentSession: string): string {
  const [header, ...entries] = sessionFixture().split("\n")
  return [
    JSON.stringify({
      ...(JSON.parse(header) as Record<string, unknown>),
      id: "session-fork",
      timestamp: "2026-01-02T10:00:00.000Z",
      parentSession,
    }),
    ...entries,
  ].join("\n")
}

function agentResult(
  agentId: string,
  cost = 0.42,
  modelName = "gpt-5.6 terra"
): string {
  return JSON.stringify({
    type: "message",
    id: `result-${agentId}`,
    parentId: null,
    timestamp: "2026-01-04T10:00:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: `call-${agentId}`,
      toolName: "Agent",
      isError: false,
      content: [],
      details: {
        agentId,
        displayName: "reviewer",
        description: "Review historical costs",
        modelName,
        tokens: "12.5k token",
        cost,
        status: "completed",
      },
    },
  })
}

function agentCall(agentId: string): string {
  return JSON.stringify({
    type: "message",
    id: `request-${agentId}`,
    timestamp: "2026-01-04T10:59:59.000Z",
    message: {
      role: "assistant",
      provider: "openai-codex",
      model: "gpt-test",
      content: [
        {
          type: "toolCall",
          id: `call-${agentId}`,
          name: "Agent",
          arguments: {
            subagent_type: "planner",
            description: "Plan historical work",
          },
        },
      ],
      usage: { input: 0, output: 0, totalTokens: 0, cost: { total: 0 } },
    },
  })
}

function legacyAgentResult(agentId: string): string {
  return JSON.stringify({
    type: "message",
    id: `result-${agentId}`,
    timestamp: "2026-01-04T11:00:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: `call-${agentId}`,
      toolName: "Agent",
      content: [{ type: "text", text: `Agent ID: ${agentId}\n` }],
    },
  })
}

function sidechainFixture(cwd = "/work/project"): string {
  return [
    JSON.stringify({
      isSidechain: true,
      agentId: "agent-terra",
      type: "user",
      timestamp: "2026-01-03T10:00:00.000Z",
      cwd,
      message: { role: "user", content: "SECRET_AGENT_PROMPT" },
    }),
    JSON.stringify({
      isSidechain: true,
      agentId: "agent-terra",
      type: "assistant",
      timestamp: "2026-01-03T10:00:02.000Z",
      cwd,
      message: {
        role: "assistant",
        responseId: "response-terra",
        timestamp: 1_767_434_402_000,
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        stopReason: "stop",
        content: [{ type: "text", text: "SECRET_AGENT_OUTPUT" }],
        usage: {
          input: 40,
          output: 10,
          cacheRead: 20,
          cacheWrite: 0,
          totalTokens: 70,
          cost: { total: 0.03 },
        },
      },
    }),
  ].join("\n")
}

describe("parseSessionJsonl", () => {
  it("indexe les usages facturés sans conserver le contenu des conversations", () => {
    const parsed = parseSessionJsonl(
      "/sessions/example.jsonl",
      sessionFixture()
    )

    expect(parsed).not.toBeNull()
    expect(parsed?.name).toBe("Refonte privée")
    expect(parsed?.requests).toHaveLength(3)
    expect(
      parsed?.requests.map((request) => request.usage.totalTokens)
    ).toEqual([180, 12, 25])
    expect(parsed?.requests[0]?.durationMs).toBe(2_500)
    expect(parsed?.tools).toEqual([
      expect.objectContaining({
        name: "read",
        provider: "openai-codex",
        model: "gpt-test",
        isError: true,
        durationMs: 500,
      }),
    ])
    expect(parsed?.skills).toEqual([
      expect.objectContaining({
        skill: "frontend-design",
        provider: "openai-codex",
        model: "gpt-test",
      }),
    ])
    expect(JSON.stringify(parsed)).not.toContain("contenu confidentiel")
    expect(JSON.stringify(parsed)).not.toContain("sortie confidentielle")
    expect(JSON.stringify(parsed)).not.toContain("999999")
    expect(JSON.stringify(parsed)).not.toContain("SECRET_CONTENT")

    const independent = parseSessionJsonl(
      "/sessions/independent.jsonl",
      sessionFixture()
        .replaceAll("session-1", "session-other")
        .replaceAll("assistant-1", "assistant-other")
    )
    expect(independent?.tools[0]?.sourceKey).not.toBe(
      parsed?.tools[0]?.sourceKey
    )
  })

  it("attribue les transcriptions de sous-agents à leur modèle réel", () => {
    const parsed = parseSessionJsonl(
      "/tmp/tasks/agent-terra.output",
      sidechainFixture(),
      "parent-session"
    )

    expect(parsed?.id).toBe("agent-terra")
    expect(parsed?.parentSession).toBe("parent-session")
    expect(parsed?.cwd).toBe("/work/project")
    expect(parsed?.requests).toEqual([
      expect.objectContaining({
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        usage: expect.objectContaining({ totalTokens: 70, cost: 0.03 }),
      }),
    ])
    expect(JSON.stringify(parsed)).not.toContain("SECRET_AGENT_PROMPT")
    expect(JSON.stringify(parsed)).not.toContain("SECRET_AGENT_OUTPUT")
  })

  it("délègue les métadonnées d’agents à l’adaptateur", () => {
    const filePath = "/sessions/parent.jsonl"
    const source = `${sessionFixture()}\n${agentResult("agent-history")}\n${agentCall("legacy-agent")}\n${legacyAgentResult("legacy-agent")}`
    const parsed = parseSessionJsonl(filePath, source)
    const records = parseSourceRecords(filePath, source)
    const observations = tintinwebAdapter.inspect({
      filePath,
      records,
      session: parsed
        ? {
            id: parsed.id,
            cwd: parsed.cwd,
            name: parsed.name,
            startedAt: parsed.startedAt,
            parentSession: parsed.parentSession,
          }
        : null,
    }).observations

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nativeId: "agent-history",
          displayName: "reviewer",
          description: "Review historical costs",
          modelId: null,
          modelLabel: "gpt-5.6 terra",
          usage: expect.objectContaining({
            totalTokens: 12_500,
            totalCost: 0.42,
          }),
        }),
        expect.objectContaining({
          nativeId: "legacy-agent",
          agentType: "planner",
          description: "Plan historical work",
        }),
      ])
    )
    expect(JSON.stringify(parsed)).not.toContain("agentId")
  })
})

describe("SessionSynchronizer", () => {
  it("affiche correctement le nom d’un projet Windows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-windows-path-"))
    temporaryDirectories.push(directory)
    await writeFile(
      join(directory, "session.jsonl"),
      sessionFixture().replaceAll(
        "/work/private-project",
        "C:\\\\work\\\\private-project"
      ),
      "utf8"
    )
    const database = createDatabase(":memory:")

    await new SessionSynchronizer(database, directory).sync()

    expect(
      getStats(
        database,
        { range: "all", project: "", provider: "", model: "" },
        null
      ).projects[0]?.label
    ).toBe("private-project")
    database.close()
  })

  it("détecte les agents historiques sans transcription conservée", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-agent-history-"))
    temporaryDirectories.push(directory)
    const sessionPath = join(directory, "parent.jsonl")
    await writeFile(
      sessionPath,
      `${sessionFixture()}\n${agentResult("agent-history")}\n${agentCall("legacy-agent")}\n${legacyAgentResult("legacy-agent")}`,
      "utf8"
    )
    const database = createDatabase(":memory:")

    await new SessionSynchronizer(database, directory).sync()

    expect(
      getSessions(
        database,
        { range: "all", project: "", provider: "", model: "" },
        firstSessionPage
      ).rows[0]?.agents
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "agent-history",
          source: "tintinweb",
          name: "reviewer",
          description: "Review historical costs",
          models: [],
          modelLabel: "gpt-5.6 terra",
          requests: null,
          tokens: 12_500,
          cost: 0.42,
          precision: expect.objectContaining({
            tokens: "estimated",
            cost: "reported",
          }),
          usage: expect.objectContaining({ coverage: "complete" }),
        }),
        expect.objectContaining({
          id: "legacy-agent",
          source: "tintinweb",
          name: "planner",
          description: "Plan historical work",
          models: [],
          requests: null,
          tokens: null,
          cost: null,
          usage: expect.objectContaining({ coverage: "unknown" }),
        }),
      ])
    )
    const historicalStats = getStats(
      database,
      { range: "all", project: "", provider: "", model: "" },
      null
    )
    expect(historicalStats.options.models).not.toContain("gpt-5.6 terra")
    expect(historicalStats.models.map((row) => row.model)).not.toContain(
      "unknown"
    )
    expect(historicalStats.providers.map((row) => row.provider)).not.toContain(
      "unknown"
    )
    expect(historicalStats.overview.totalTokens).toBe(12_717)
    expect(historicalStats.overview.cost).toBeCloseTo(0.435)
    expect(
      getSessions(
        database,
        {
          range: "all",
          project: "",
          provider: "",
          model: "gpt-5.6 terra",
        },
        firstSessionPage
      ).total
    ).toBe(0)

    database
      .prepare(
        "INSERT INTO hidden_models (provider, model, hidden_at) VALUES ('openai-codex', 'gpt-test', '2026-01-05T00:00:00.000Z')"
      )
      .run()
    expect(
      getSessions(
        database,
        {
          range: "all",
          project: "",
          provider: "",
          model: "gpt-5.6-terra",
        },
        firstSessionPage
      ).total
    ).toBe(0)
    expect(
      getStats(
        database,
        { range: "all", project: "", provider: "", model: "" },
        null
      ).options.models
    ).not.toContain("gpt-5.6-terra")
    database.close()
  })

  it("réindexe les métadonnées legacy lors du passage au schéma 19", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-v19-reindex-"))
    temporaryDirectories.push(directory)
    const sessionsDirectory = join(directory, "sessions")
    const databasePath = join(directory, "stats.sqlite")
    await mkdir(sessionsDirectory)
    await writeFile(
      join(sessionsDirectory, "parent.jsonl"),
      `${sessionFixture()}\n${agentResult("agent-history")}`
    )
    let database = createDatabase(databasePath)
    await new SessionSynchronizer(database, sessionsDirectory).sync()
    database
      .prepare(
        "UPDATE agent_observations SET channel = 'legacy-tool-details', status_raw = NULL, status_canonical = 'unknown'"
      )
      .run()
    database
      .prepare(
        "UPDATE agent_runs SET selected_channel = 'legacy-tool-details', status_raw = NULL, status_canonical = 'unknown', coverage = 'partial'"
      )
      .run()
    database.exec(`
      DROP TABLE deleted_agent_usage;
      DROP TABLE deleted_model_records;
      DROP TRIGGER skip_deleted_requests;
      DROP TRIGGER skip_deleted_tool_calls;
      DROP TRIGGER skip_deleted_skill_usages;
      PRAGMA user_version = 18;
    `)
    database.close()

    database = createDatabase(databasePath)
    expect(
      database.prepare("SELECT size FROM indexed_files").pluck().get()
    ).toBe(-1)
    await new SessionSynchronizer(database, sessionsDirectory).sync()

    expect(
      getSessions(database, filters, firstSessionPage).rows[0]?.agents[0]
    ).toMatchObject({
      id: "agent-history",
      status: "completed",
      statusRaw: "completed",
      usage: { coverage: "complete" },
    })
    database.close()
  })

  it("ne réconcilie pas les agents quand aucun fichier n’a changé", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-unchanged-"))
    temporaryDirectories.push(directory)
    await writeFile(
      join(directory, "session.jsonl"),
      `${sessionFixture()}\n${agentResult("unchanged-agent")}`
    )
    const database = createDatabase(":memory:")
    const synchronizer = new SessionSynchronizer(database, directory, [])
    await synchronizer.sync()
    database.exec(`
      CREATE TEMP TABLE run_mutations (operation TEXT);
      CREATE TEMP TRIGGER runs_deleted AFTER DELETE ON agent_runs
        BEGIN INSERT INTO run_mutations VALUES ('delete'); END;
      CREATE TEMP TRIGGER runs_inserted AFTER INSERT ON agent_runs
        BEGIN INSERT INTO run_mutations VALUES ('insert'); END;
    `)

    const result = await synchronizer.sync()

    expect(result).toMatchObject({ updated: 0, removed: 0 })
    expect(
      database.prepare("SELECT COUNT(*) FROM run_mutations").pluck().get()
    ).toBe(0)
    database.close()
  })

  it("agrège les coûts des sous-agents dans leur session principale", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-sidechain-"))
    temporaryDirectories.push(directory)
    const sessionsDirectory = join(directory, "sessions")
    const sidechainsDirectory = join(directory, "sidechains")
    const parentSession = "01a0641d-611d-708f-bf33-00a2782b4540"
    const sidechainDirectory = join(
      sidechainsDirectory,
      "home-user-work",
      parentSession,
      "tasks"
    )
    const sidechainPath = join(sidechainDirectory, "agent-terra.output")
    await mkdir(sessionsDirectory, { recursive: true })
    await mkdir(sidechainDirectory, { recursive: true })
    await writeFile(
      join(sessionsDirectory, "parent.jsonl"),
      `${sessionFixture().replaceAll("session-1", parentSession)}\n${agentResult("agent-terra", 0.5, "stale model")}`,
      "utf8"
    )
    await writeFile(
      sidechainPath,
      sidechainFixture("/work/private-project"),
      "utf8"
    )
    const database = createDatabase(":memory:")
    const synchronizer = new SessionSynchronizer(database, sessionsDirectory, [
      sidechainsDirectory,
    ])

    await synchronizer.sync()

    const page = getSessions(
      database,
      { range: "all", project: "", provider: "", model: "" },
      firstSessionPage
    )
    expect(page.total).toBe(1)
    expect(page.rows[0]).toEqual(
      expect.objectContaining({
        id: parentSession,
        name: "Refonte privée",
        models: ["gpt-5.6-terra", "gpt-test"],
        requests: 4,
        tokens: 287,
      })
    )
    expect(page.rows[0]?.cost).toBeCloseTo(0.045)
    expect(page.rows[0]?.agents).toEqual([
      expect.objectContaining({
        id: "agent-terra",
        name: "reviewer",
        description: "Review historical costs",
        models: ["gpt-5.6-terra"],
        requests: 1,
        tokens: 70,
      }),
    ])
    expect(page.rows[0]?.agents[0]?.cost).toBeCloseTo(0.03)
    expect(
      getSessions(
        database,
        {
          range: "all",
          project: "",
          provider: "",
          model: "gpt-5.6-terra",
        },
        firstSessionPage
      ).rows[0]?.agents[0]
    ).toEqual(
      expect.objectContaining({
        id: "agent-terra",
        name: "reviewer",
        models: ["gpt-5.6-terra"],
      })
    )
    expect(
      getSessions(
        database,
        { range: "all", project: "", provider: "", model: "stale-model" },
        firstSessionPage
      ).total
    ).toBe(0)
    expect(
      getStats(
        database,
        { range: "all", project: "", provider: "", model: "" },
        null
      ).options.models
    ).not.toContain("stale-model")
    expect(
      getStats(
        database,
        { range: "all", project: "", provider: "", model: "" },
        null
      ).projects[0]?.sessions
    ).toBe(1)

    database
      .prepare("UPDATE requests SET model = 'unknown' WHERE file_path = ?")
      .run(sidechainPath)
    expect(
      getSessions(
        database,
        { range: "all", project: "", provider: "", model: "" },
        firstSessionPage
      ).rows[0]?.agents[0]?.models
    ).toEqual(["gpt-5.6-terra"])

    database
      .prepare("UPDATE sessions SET parent_session = NULL WHERE file_path = ?")
      .run(sidechainPath)
    database
      .prepare(
        "UPDATE requests SET session_id = 'agent-terra' WHERE file_path = ?"
      )
      .run(sidechainPath)
    await rm(sidechainPath)
    expect((await synchronizer.sync()).updated).toBe(0)
    expect(
      database
        .prepare(
          "SELECT parent_session, accounting_session_id, session_kind FROM sessions WHERE file_path = ?"
        )
        .get(sidechainPath)
    ).toEqual({
      parent_session: null,
      accounting_session_id: parentSession,
      session_kind: "agent",
    })
    expect(
      database
        .prepare(
          "SELECT DISTINCT session_id, accounting_session_id FROM requests WHERE file_path = ?"
        )
        .all(sidechainPath)
    ).toEqual([
      { session_id: "agent-terra", accounting_session_id: parentSession },
    ])
    expect(
      getSessions(
        database,
        { range: "all", project: "", provider: "", model: "" },
        firstSessionPage
      ).total
    ).toBe(1)
    database.close()
  })

  it("isole l’usage reportUsage non attribuable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-unassigned-"))
    temporaryDirectories.push(directory)
    const result = JSON.parse(agentResult("agent-history"))
    result.message.usage = {
      input: 40,
      output: 10,
      cacheRead: 20,
      cacheWrite: 0,
      totalTokens: 70,
      cost: { total: 0.03 },
    }
    await writeFile(
      join(directory, "parent.jsonl"),
      `${sessionFixture()}\n${JSON.stringify(result)}`,
      "utf8"
    )
    const database = createDatabase(":memory:")

    await new SessionSynchronizer(database, directory).sync()

    const row = getSessions(database, filters, firstSessionPage).rows[0]!
    expect(row).toMatchObject({
      requests: 3,
      tokens: 12_717,
      accounting: {
        coverage: "partial",
        unassignedTokens: 70,
        unassignedCost: 0.03,
      },
      agents: [{ id: "agent-history", tokens: 12_500, cost: 0.42 }],
    })
    expect(row.cost).toBeCloseTo(0.435)
    database.close()
  })

  it("reconstruit l’imbrication Tintin depuis les transcripts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-nested-"))
    temporaryDirectories.push(directory)
    const sessionsDirectory = join(directory, "sessions")
    const artifactsDirectory = join(directory, "artifacts")
    const rootSession = "root-session"
    const tasksDirectory = join(
      artifactsDirectory,
      "home-work-project",
      rootSession,
      "tasks"
    )
    await mkdir(sessionsDirectory, { recursive: true })
    await mkdir(tasksDirectory, { recursive: true })
    await writeFile(
      join(sessionsDirectory, "parent.jsonl"),
      `${sessionFixture().replaceAll("session-1", rootSession)}\n${agentResult("parent-agent")}`
    )
    const parentTranscript = [
      {
        isSidechain: true,
        agentId: "parent-agent",
        type: "user",
        timestamp: "2026-01-03T10:00:00.000Z",
        cwd: "/work/private-project",
        message: { role: "user", content: "PRIVATE_PARENT_PROMPT" },
      },
      {
        isSidechain: true,
        agentId: "parent-agent",
        type: "assistant",
        id: "parent-call-entry",
        timestamp: "2026-01-03T10:00:01.000Z",
        cwd: "/work/private-project",
        message: {
          role: "assistant",
          responseId: "parent-response",
          provider: "openai-codex",
          model: "parent-model",
          content: [
            {
              type: "toolCall",
              id: "nested-call",
              name: "Agent",
              arguments: {
                subagent_type: "worker",
                description: "Nested work",
              },
            },
          ],
          usage: {
            input: 6,
            output: 4,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 10,
            cost: { total: 0.01 },
          },
        },
      },
      {
        isSidechain: true,
        agentId: "parent-agent",
        type: "toolResult",
        id: "nested-result-entry",
        parentId: "parent-call-entry",
        timestamp: "2026-01-03T10:00:02.000Z",
        cwd: "/work/private-project",
        message: {
          role: "toolResult",
          toolCallId: "nested-call",
          toolName: "Agent",
          details: {
            agentId: "child-agent",
            subagentType: "worker",
            status: "completed",
          },
        },
      },
    ]
    await writeFile(
      join(tasksDirectory, "parent-agent.output"),
      parentTranscript.map((value) => JSON.stringify(value)).join("\n")
    )
    await writeFile(
      join(tasksDirectory, "child-agent.output"),
      [
        {
          isSidechain: true,
          agentId: "child-agent",
          type: "user",
          timestamp: "2026-01-03T10:00:02.000Z",
          cwd: "/work/private-project",
          message: { role: "user", content: "PRIVATE_CHILD_PROMPT" },
        },
        {
          isSidechain: true,
          agentId: "child-agent",
          type: "assistant",
          timestamp: "2026-01-03T10:00:03.000Z",
          cwd: "/work/private-project",
          message: {
            role: "assistant",
            responseId: "child-response",
            provider: "openai-codex",
            model: "child-model",
            content: [{ type: "text", text: "PRIVATE_CHILD_RESULT" }],
            usage: {
              input: 3,
              output: 2,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 5,
              cost: { total: 0.005 },
            },
          },
        },
      ]
        .map((value) => JSON.stringify(value))
        .join("\n")
    )
    const database = createDatabase(":memory:")

    await new SessionSynchronizer(database, sessionsDirectory, [
      artifactsDirectory,
    ]).sync()

    const row = getSessions(database, filters, firstSessionPage).rows[0]!
    const parent = row.agents.find((agent) => agent.id === "parent-agent")!
    const child = row.agents.find((agent) => agent.id === "child-agent")!
    expect(parent.depth).toBe(1)
    expect(child).toMatchObject({
      parentAgentId: parent.key,
      depth: 2,
      models: ["child-model"],
      tokens: 5,
      cost: 0.005,
    })
    expect(row.tokens).toBe(232)
    expect(row.cost).toBeCloseTo(0.03)
    expect(JSON.stringify(row)).not.toContain("PRIVATE_")
    expect(
      JSON.stringify(database.prepare("SELECT * FROM agent_observations").all())
    ).not.toContain("PRIVATE_")
    database.close()
  })

  it("préfère une session enfant persistée à son transcript Tintin", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-persisted-child-"))
    temporaryDirectories.push(directory)
    const sessionsDirectory = join(directory, "sessions")
    const artifactsDirectory = join(directory, "artifacts")
    const rootId = "root-persisted"
    const parentPath = join(sessionsDirectory, "parent.jsonl")
    const childPath = join(sessionsDirectory, "child.jsonl")
    const outputPath = join(
      artifactsDirectory,
      "home-work",
      rootId,
      "tasks",
      "agent-terra.output"
    )
    await mkdir(sessionsDirectory, { recursive: true })
    await mkdir(join(outputPath, ".."), { recursive: true })
    const parentResult = JSON.parse(agentResult("agent-terra"))
    parentResult.message.details.subagentType = "reviewer"
    await writeFile(
      parentPath,
      `${sessionFixture().replaceAll("session-1", rootId)}\n${JSON.stringify(parentResult)}`
    )
    const child = [
      {
        type: "session",
        version: 3,
        id: "child-session-id",
        timestamp: "2026-01-03T10:00:00.000Z",
        cwd: "/work/private-project",
        parentSession: parentPath,
      },
      {
        type: "session_info",
        id: "child-name",
        parentId: null,
        timestamp: "2026-01-03T10:00:00.000Z",
        name: "reviewer#agent-te",
      },
      {
        type: "message",
        id: "child-message",
        parentId: "child-name",
        timestamp: "2026-01-03T10:00:02.000Z",
        message: {
          role: "assistant",
          provider: "openai-codex",
          model: "gpt-5.6-terra",
          content: [],
          usage: {
            input: 40,
            output: 10,
            cacheRead: 20,
            cacheWrite: 0,
            totalTokens: 70,
            cost: { total: 0.03 },
          },
        },
      },
    ]
    await writeFile(
      childPath,
      child.map((value) => JSON.stringify(value)).join("\n")
    )
    await writeFile(
      outputPath,
      sidechainFixture("/work/private-project").replace(
        '"responseId":"response-terra",',
        ""
      )
    )
    const database = createDatabase(":memory:")

    await new SessionSynchronizer(database, sessionsDirectory, [
      artifactsDirectory,
    ]).sync()

    const row = getSessions(database, filters, firstSessionPage).rows[0]!
    expect(row.agents).toHaveLength(1)
    expect(row.agents[0]).toMatchObject({
      id: "agent-terra",
      models: ["gpt-5.6-terra"],
      requests: 1,
      tokens: 70,
      cost: 0.03,
      usage: { source: "pi-session" },
    })
    expect(row.tokens).toBe(287)
    expect(row.cost).toBeCloseTo(0.045)
    database.close()
  })

  it("importe et retient les artefacts versionnés nicobailon", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-nico-"))
    temporaryDirectories.push(directory)
    const sessionsDirectory = join(directory, "sessions")
    const artifactsDirectory = join(directory, "artifacts")
    const runDirectory = join(
      artifactsDirectory,
      "async-subagent-runs",
      "run-1"
    )
    const statusPath = join(runDirectory, "status.json")
    await mkdir(sessionsDirectory, { recursive: true })
    await mkdir(runDirectory, { recursive: true })
    await writeFile(join(sessionsDirectory, "parent.jsonl"), sessionFixture())
    await writeFile(
      statusPath,
      JSON.stringify({
        lifecycleArtifactVersion: 3,
        runId: "run-1",
        sessionId: "session-1",
        mode: "single",
        steps: [
          {
            index: 0,
            childId: "nico-child",
            agent: "reviewer",
            status: "complete",
            model: "openai/gpt-nico",
            startedAt: 1_767_225_600_000,
            endedAt: 1_767_225_601_000,
            tokens: { input: 40, output: 10, total: 50 },
            totalCost: { inputTokens: 40, outputTokens: 10, costUsd: 0.03 },
          },
        ],
      })
    )
    const database = createDatabase(":memory:")
    const synchronizer = new SessionSynchronizer(database, sessionsDirectory, [
      artifactsDirectory,
    ])

    await synchronizer.sync()
    const first = getSessions(database, filters, firstSessionPage).rows[0]!
    expect(first).toMatchObject({
      requests: 3,
      tokens: 267,
      agents: [
        {
          id: "nico-child",
          source: "nicobailon",
          models: ["gpt-nico"],
          requests: null,
          tokens: 50,
          cost: 0.03,
          provenance: { artifactVersion: "3" },
        },
      ],
    })
    expect(first.cost).toBeCloseTo(0.045)

    await writeFile(statusPath, "{incomplete")
    expect((await synchronizer.sync()).updated).toBe(0)
    expect(
      getSessions(database, filters, firstSessionPage).rows[0]?.agents[0]?.id
    ).toBe("nico-child")

    await rm(statusPath)
    expect((await synchronizer.sync()).updated).toBe(0)
    expect(
      getSessions(database, filters, firstSessionPage).rows[0]?.agents[0]?.id
    ).toBe("nico-child")
    database.close()
  })

  it("regroupe les worktrees sous leur projet Git principal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-worktree-"))
    temporaryDirectories.push(directory)
    const repository = join(directory, "project")
    const worktree = join(directory, "worktree")
    const deletedHerdrWorktree = join(
      directory,
      ".herdr",
      "worktrees",
      "project",
      "deleted"
    )
    const deletedOrcaWorktree = join(
      directory,
      "orca",
      "workspaces",
      "project",
      "deleted"
    )
    const sessions = join(directory, "sessions")
    await mkdir(sessions)
    await run("git", ["init", "--initial-branch=main", repository])
    await run("git", [
      "-C",
      repository,
      "config",
      "user.email",
      "stats@example.test",
    ])
    await run("git", ["-C", repository, "config", "user.name", "Stats Test"])
    await writeFile(join(repository, "README.md"), "test\n", "utf8")
    await run("git", ["-C", repository, "add", "README.md"])
    await run("git", ["-C", repository, "commit", "-m", "Initial"])
    await run("git", [
      "-C",
      repository,
      "worktree",
      "add",
      "-b",
      "feature",
      worktree,
    ])

    const fixture = (cwd: string, id: string, date: string) =>
      sessionFixture()
        .replaceAll("/work/private-project", cwd)
        .replaceAll("session-1", id)
        .replaceAll("2026-01-01", date)
    await writeFile(
      join(sessions, "main.jsonl"),
      fixture(repository, "main", "2026-01-01"),
      "utf8"
    )
    await writeFile(
      join(sessions, "worktree.jsonl"),
      fixture(worktree, "worktree", "2026-01-02"),
      "utf8"
    )

    const database = createDatabase(":memory:")
    const synchronizer = new SessionSynchronizer(database, sessions)
    await synchronizer.sync()
    expect(
      getStats(
        database,
        { range: "all", project: "", provider: "", model: "" },
        null
      ).projects
    ).toEqual([expect.objectContaining({ project: repository, sessions: 2 })])

    await run("git", [
      "-C",
      repository,
      "worktree",
      "remove",
      "--force",
      worktree,
    ])
    await writeFile(
      join(sessions, "deleted.jsonl"),
      fixture(deletedHerdrWorktree, "deleted", "2026-01-03"),
      "utf8"
    )
    await writeFile(
      join(sessions, "orca.jsonl"),
      fixture(deletedOrcaWorktree, "orca", "2026-01-04"),
      "utf8"
    )
    await synchronizer.sync()
    const stats = getStats(
      database,
      { range: "all", project: "", provider: "", model: "" },
      null
    )

    expect(stats.options.projects).toEqual([
      { value: repository, label: "project" },
    ])
    expect(stats.projects).toEqual([
      expect.objectContaining({ project: repository, sessions: 4 }),
    ])
    expect(
      getStats(
        database,
        { range: "all", project: repository, provider: "", model: "" },
        null
      ).overview.requests
    ).toBe(12)
    database.close()
  })

  it("attribue les entrées copiées à leur session d’origine quel que soit l’ordre d’indexation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-owner-"))
    temporaryDirectories.push(directory)
    const originalPath = join(directory, "original.jsonl")
    const forkPath = join(directory, "fork.jsonl")
    const database = createDatabase(":memory:")
    const synchronizer = new SessionSynchronizer(database, directory)

    await writeFile(forkPath, forkedSessionFixture(originalPath), "utf8")
    await synchronizer.sync()
    expect(
      getSessions(
        database,
        { range: "all", project: "", provider: "", model: "" },
        firstSessionPage
      ).rows[0]?.id
    ).toBe("session-fork")

    await writeFile(originalPath, sessionFixture(), "utf8")
    await synchronizer.sync()
    expect(
      getSessions(
        database,
        { range: "all", project: "", provider: "", model: "" },
        firstSessionPage
      ).rows
    ).toEqual([
      expect.objectContaining({
        id: "session-1",
        name: "Refonte privée",
        models: ["gpt-test"],
        startedAt: "2026-01-01T10:00:00.000Z",
        requests: 3,
        cost: 0.015,
        tokens: 217,
      }),
    ])
    database.close()
  })

  it("ignore les fichiers inchangés puis retire les sessions supprimées", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-"))
    temporaryDirectories.push(directory)
    const nestedDirectory = join(directory, "nested")
    const filePath = join(nestedDirectory, "session.jsonl")
    await mkdir(nestedDirectory)
    await writeFile(filePath, sessionFixture(), "utf8")

    const database = createDatabase(":memory:")
    const synchronizer = new SessionSynchronizer(database, directory)

    expect(await synchronizer.sync()).toMatchObject({
      scanned: 1,
      updated: 1,
      removed: 0,
    })
    expect(await synchronizer.sync()).toMatchObject({
      scanned: 1,
      updated: 0,
      removed: 0,
    })
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM requests").get()
    ).toEqual({ count: 3 })
    const initialStats = getStats(
      database,
      { range: "all", project: "", provider: "", model: "" },
      null
    )
    expect(initialStats.skills).toEqual([
      expect.objectContaining({
        name: "frontend-design",
        uses: 1,
        sessions: 1,
        models: [{ model: "gpt-test", uses: 1 }],
      }),
    ])

    const copiedFilePath = join(directory, "forked-session.jsonl")
    await writeFile(copiedFilePath, sessionFixture(), "utf8")
    expect(await synchronizer.sync()).toMatchObject({
      scanned: 2,
      updated: 1,
      removed: 0,
    })
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM requests").get()
    ).toEqual({ count: 6 })
    const forkedStats = getStats(
      database,
      { range: "all", project: "", provider: "", model: "" },
      null
    )
    expect(forkedStats.overview.requests).toBe(3)
    expect(forkedStats.skills[0]?.uses).toBe(1)

    const independentFilePath = join(directory, "independent-session.jsonl")
    const independentFixture = sessionFixture()
      .replaceAll("session-1", "session-2")
      .replaceAll("2026-01-01", "2026-01-02")
    await writeFile(independentFilePath, independentFixture, "utf8")
    expect(await synchronizer.sync()).toMatchObject({
      scanned: 3,
      updated: 1,
      removed: 0,
    })
    expect(
      getStats(
        database,
        { range: "all", project: "", provider: "", model: "" },
        null
      ).overview.requests
    ).toBe(6)

    await rm(filePath)
    expect(await synchronizer.sync()).toMatchObject({
      scanned: 2,
      updated: 0,
      removed: 1,
    })
    expect(
      getStats(
        database,
        { range: "all", project: "", provider: "", model: "" },
        null
      ).overview.requests
    ).toBe(6)

    await rm(copiedFilePath)
    expect(await synchronizer.sync()).toMatchObject({
      scanned: 1,
      updated: 0,
      removed: 1,
    })
    expect(
      getStats(
        database,
        { range: "all", project: "", provider: "", model: "" },
        null
      ).overview.requests
    ).toBe(3)

    await rm(independentFilePath)
    expect(await synchronizer.sync()).toMatchObject({
      scanned: 0,
      updated: 0,
      removed: 1,
    })
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM requests").get()
    ).toEqual({ count: 0 })

    const retainedTranscript = join(
      directory,
      "retained-root",
      "tasks",
      "agent-terra.output"
    )
    await mkdir(join(directory, "retained-root", "tasks"), {
      recursive: true,
    })
    await writeFile(retainedTranscript, sidechainFixture(), "utf8")
    expect(await synchronizer.sync()).toMatchObject({
      scanned: 1,
      updated: 1,
      removed: 0,
    })
    await rm(retainedTranscript)
    expect(await synchronizer.sync()).toMatchObject({
      scanned: 0,
      updated: 0,
      removed: 0,
    })
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM requests").get()
    ).toEqual({ count: 1 })
    database.close()
  })

  it.skipIf(process.platform === "win32" || process.geteuid?.() === 0)(
    "conserve l’index lorsqu’un dossier devient illisible",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "pi-stats-unreadable-"))
      temporaryDirectories.push(directory)
      await writeFile(
        join(directory, "session.jsonl"),
        sessionFixture(),
        "utf8"
      )
      const database = createDatabase(":memory:")
      const synchronizer = new SessionSynchronizer(
        database,
        `${directory}${sep}`
      )

      await synchronizer.sync()
      database.prepare("UPDATE indexed_files SET size = -1").run()
      try {
        await chmod(directory, 0o000)
        expect(await synchronizer.sync()).toMatchObject({
          scanned: 0,
          updated: 0,
          removed: 0,
        })
        expect(
          database.prepare("SELECT COUNT(*) AS count FROM requests").get()
        ).toEqual({ count: 3 })
        expect(
          database.prepare("SELECT size FROM indexed_files").pluck().get()
        ).toBe(-2)
      } finally {
        await chmod(directory, 0o700)
        database.close()
      }
    }
  )
})
