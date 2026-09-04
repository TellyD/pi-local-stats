import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type {
  AdapterInput,
  AgentAdapter,
  AgentObservation,
} from "../server/agent-adapters/index.ts"
import { nicobailonAdapter } from "../server/agent-adapters/nicobailon.ts"
import { tintinwebAdapter } from "../server/agent-adapters/tintinweb.ts"
import {
  reconcileAgentRuns,
  replaceAgentObservations,
} from "../server/agents.ts"
import { createDatabase } from "../server/database.ts"
import { getSessions } from "../server/session-stats.ts"
import { getStats } from "../server/stats.ts"
import { SessionSynchronizer } from "../server/sync.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

const page = {
  page: 1,
  pageSize: 10,
  sort: "startedAt" as const,
  direction: "desc" as const,
}
const filters = {
  range: "all" as const,
  project: "",
  provider: "",
  model: "",
}

function tintinInput(): AdapterInput {
  return {
    filePath: "/sessions/parent.jsonl",
    session: {
      id: "parent",
      cwd: "/work/project",
      name: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      parentSession: null,
    },
    records: [
      {
        type: "message",
        id: "call-entry",
        parentId: null,
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "Agent",
              arguments: {
                subagent_type: "reviewer",
                description: "Review changes",
              },
            },
          ],
        },
      },
      {
        type: "message",
        id: "result-entry",
        parentId: "call-entry",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "Agent",
          details: {
            agentId: "agent-1",
            displayName: "Reviewer",
            modelName: "GPT 5 Terra",
            tokens: "12.5k token",
            cost: 0.42,
            status: "completed",
          },
        },
      },
    ],
  }
}

describe("agent adapters", () => {
  it("utilise les racines temporaires propres à chaque package", () => {
    expect(tintinwebAdapter.defaultRoots()[0]).toMatch(/pi-subagents-\d+$/)
    expect(nicobailonAdapter.defaultRoots()[0]).toMatch(
      /pi-subagents-(?:uid-\d+|user-|home-)/
    )
  })

  it("conserve le label modèle Tintin sans fabriquer un identifiant", () => {
    const result = tintinwebAdapter.inspect(tintinInput())
    expect(result.observations).toEqual([
      expect.objectContaining({
        nativeId: "agent-1",
        agentType: "reviewer",
        modelId: null,
        modelLabel: "GPT 5 Terra",
        usage: expect.objectContaining({
          totalTokens: 12_500,
          totalCost: 0.42,
        }),
        precision: expect.objectContaining({
          tokens: "estimated",
          cost: "reported",
        }),
      }),
    ])
  })

  it("ne déduit pas un statut terminal d’un output encore inscriptible", () => {
    const result = tintinwebAdapter.inspect({
      filePath: "/tmp/pi-subagents-1000/root/tasks/agent-1.output",
      session: null,
      records: [
        {
          isSidechain: true,
          agentId: "agent-1",
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            role: "assistant",
            provider: "openai",
            model: "gpt",
            usage: { totalTokens: 10, cost: { total: 0.01 } },
          },
        },
      ],
    })

    expect(result.observations[0]).toMatchObject({
      channel: "output",
      statusRaw: null,
      status: "unknown",
      usage: { totalTokens: 10 },
    })
  })

  it("lit les résultats foreground structurés de nicobailon", () => {
    const result = nicobailonAdapter.inspect({
      filePath: "/sessions/parent.jsonl",
      session: {
        id: "parent",
        cwd: "/work/project",
        name: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        parentSession: null,
      },
      records: [
        {
          type: "message",
          id: "result",
          message: {
            role: "toolResult",
            toolName: "subagent",
            details: {
              mode: "single",
              runId: "foreground-run",
              results: [
                {
                  index: 0,
                  agent: "scout",
                  status: "completed",
                  model: "anthropic/claude-test:high",
                  usage: {
                    input: 20,
                    output: 5,
                    cacheRead: 2,
                    cacheWrite: 1,
                    totalTokens: 28,
                    cost: 0.04,
                  },
                },
              ],
            },
          },
        },
      ],
    })

    expect(result.observations).toEqual([
      expect.objectContaining({
        channel: "tool-details",
        nativeRunKey: JSON.stringify(["foreground-run", 0]),
        agentType: "scout",
        provider: "anthropic",
        modelId: "claude-test",
        usage: expect.objectContaining({ totalTokens: 28, totalCost: 0.04 }),
      }),
    ])
  })

  it("lit un totalTokens nicobailon scalaire", () => {
    const result = nicobailonAdapter.inspect({
      filePath: "/sessions/parent.jsonl",
      session: {
        id: "parent",
        cwd: "/work/project",
        name: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        parentSession: null,
      },
      records: [
        {
          type: "message",
          id: "result",
          message: {
            role: "toolResult",
            toolName: "subagent",
            details: {
              runId: "run",
              results: [
                {
                  index: 0,
                  agent: "worker",
                  status: "completed",
                  totalTokens: 50,
                  totalCost: 0.03,
                },
              ],
            },
          },
        },
      ],
    })

    expect(result.observations[0]).toMatchObject({
      usage: { totalTokens: 50, totalCost: 0.03 },
      precision: { tokens: "reported", cost: "reported" },
    })
  })

  it("laisse un total nicobailon absent inconnu", () => {
    const result = nicobailonAdapter.inspect({
      filePath: "/sessions/parent.jsonl",
      session: {
        id: "parent",
        cwd: "/work/project",
        name: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        parentSession: null,
      },
      records: [
        {
          type: "message",
          id: "result",
          message: {
            role: "toolResult",
            toolName: "subagent",
            details: {
              runId: "run",
              results: [
                {
                  index: 0,
                  agent: "worker",
                  status: "completed",
                  model: "anthropic/claude-test:low",
                  totalCost: {
                    inputTokens: 10,
                    outputTokens: 5,
                  },
                },
              ],
            },
          },
        },
      ],
    })

    expect(result.observations[0]).toMatchObject({
      modelId: "claude-test",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: null,
        totalCost: null,
      },
      precision: { tokens: "unknown", cost: "unknown" },
    })

    const database = createDatabase(":memory:")
    database
      .prepare(
        "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES ('/sessions/parent.jsonl', 'parent', '/work/project', NULL, '2026-01-01T00:00:00.000Z', NULL, 'parent')"
      )
      .run()
    replaceAgentObservations(
      database,
      "/sessions/parent.jsonl",
      result.observations
    )
    reconcileAgentRuns(database)
    expect(
      database.prepare("SELECT coverage FROM agent_runs").pluck().get()
    ).toBe("partial")
    database.close()
  })

  it("lit les steps versionnés de nicobailon", () => {
    const statusPath =
      "/tmp/pi-subagents-1000/async-subagent-runs/run-1/status.json"
    const result = nicobailonAdapter.inspect({
      filePath: statusPath,
      session: null,
      records: [
        {
          lifecycleArtifactVersion: 3,
          runId: "run-1",
          sessionId: "/sessions/parent.jsonl",
          mode: "parallel",
          steps: [
            {
              index: 2,
              childId: "child-2",
              agent: "reviewer",
              sessionName: "PRIVATE_TASK_EXCERPT",
              description: "PRIVATE_DESCRIPTION",
              recentOutput: ["PRIVATE_OUTPUT"],
              status: "complete",
              model: "openai/gpt-test",
              startedAt: 1_767_225_600_000,
              endedAt: 1_767_225_601_000,
              tokens: { input: 40, output: 10, total: 50 },
              totalCost: { inputTokens: 40, outputTokens: 10, costUsd: 0.03 },
              sessionFile: "/sessions/child.jsonl",
            },
          ],
        },
      ],
    })

    expect(result.observations).toEqual([
      expect.objectContaining({
        nativeId: "child-2",
        nativeRunKey: JSON.stringify(["run-1", 2]),
        rootSessionFile: "/sessions/parent.jsonl",
        sessionFile: "/sessions/child.jsonl",
        statusRaw: "complete",
        status: "completed",
        provider: "openai",
        modelId: "gpt-test",
        artifactVersion: "3",
        displayName: "reviewer",
        description: null,
        usage: expect.objectContaining({
          inputTokens: 40,
          outputTokens: 10,
          totalTokens: 50,
          totalCost: 0.03,
        }),
      }),
    ])
    expect(JSON.stringify(result.observations)).not.toContain("PRIVATE_")
  })

  it("lit les entrées historiques et notifications Tintin sans leur contenu", () => {
    const input = tintinInput()
    input.records = [
      {
        type: "custom",
        id: "record",
        customType: "subagents:record",
        timestamp: "2026-01-01T00:00:02.000Z",
        data: {
          id: "agent-1",
          type: "reviewer",
          description: "Review changes",
          status: "completed",
          startedAt: 1_767_225_600_000,
          completedAt: 1_767_225_601_000,
          result: "PRIVATE_RESULT",
          error: "PRIVATE_ERROR",
        },
      },
      {
        type: "custom_message",
        id: "notification",
        customType: "subagent-notification",
        timestamp: "2026-01-01T00:00:03.000Z",
        content: "PRIVATE_NOTIFICATION",
        details: {
          id: "agent-1",
          description: "Review changes",
          status: "completed",
          totalTokens: 42,
          totalCost: 0.04,
          resultPreview: "PRIVATE_PREVIEW",
        },
      },
    ]

    const observations = tintinwebAdapter.inspect(input).observations
    expect(observations.map((item) => item.channel)).toEqual([
      "record",
      "notification",
    ])
    expect(observations[1]).toMatchObject({
      nativeId: "agent-1",
      usage: { totalTokens: 42, totalCost: 0.04 },
    })
    expect(JSON.stringify(observations)).not.toContain("PRIVATE_")
  })

  it("préfère le statut terminal et le dernier cumul Tintin", () => {
    const input = tintinInput()
    input.records = [
      {
        type: "custom_message",
        id: "a-old",
        customType: "subagent-notification",
        timestamp: "2026-01-01T00:00:02.000Z",
        details: {
          id: "agent-1",
          status: "running",
          totalTokens: 100,
          totalCost: 0.1,
        },
      },
      {
        type: "custom_message",
        id: "z-new",
        customType: "subagent-notification",
        timestamp: "2026-01-01T00:00:03.000Z",
        details: {
          id: "agent-1",
          status: "running",
          totalTokens: 200,
          totalCost: 0.2,
        },
      },
      {
        type: "custom",
        id: "final-record",
        customType: "subagents:record",
        timestamp: "2026-01-01T00:00:04.000Z",
        data: {
          id: "agent-1",
          type: "worker",
          status: "completed",
          completedAt: "2026-01-01T00:00:04.000Z",
        },
      },
    ]
    const database = createDatabase(":memory:")
    database
      .prepare(
        "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES ('/sessions/parent.jsonl', 'parent', '/work/project', NULL, '2026-01-01T00:00:00.000Z', NULL, 'parent')"
      )
      .run()
    const observations = tintinwebAdapter.inspect(input).observations
    observations.find(
      (item) => item.sourceEntryId === "a-old"
    )!.precision.tokens = "exact"
    replaceAgentObservations(database, input.filePath, observations)

    reconcileAgentRuns(database)

    expect(
      database
        .prepare(
          "SELECT status_canonical, total_tokens, total_cost FROM agent_runs"
        )
        .get()
    ).toEqual({
      status_canonical: "completed",
      total_tokens: 200,
      total_cost: 0.2,
    })
    database.close()
  })

  it("pondère la durée moyenne par le nombre de requêtes", () => {
    const database = createDatabase(":memory:")
    database
      .prepare(
        "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES ('/sessions/parent.jsonl', 'parent', '/work/project', NULL, '2026-01-01T00:00:00.000Z', NULL, 'parent')"
      )
      .run()
    database
      .prepare(
        "INSERT INTO requests (id, source_key, request_key, file_path, session_id, accounting_session_id, cwd, timestamp, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, is_error, duration_ms) VALUES ('request', 'request', 'request', '/sessions/parent.jsonl', 'parent', 'parent', '/work/project', '2026-01-01T00:00:01.000Z', 'openai', 'gpt', 1, 0, 0, 0, 1, 0.01, 0, 1000)"
      )
      .run()
    const observation = tintinwebAdapter.inspect(tintinInput()).observations[0]!
    observation.startedAt = "2026-01-01T00:00:00.000Z"
    observation.completedAt = "2026-01-01T00:01:40.000Z"
    observation.usage = {
      ...observation.usage!,
      requestCount: 10,
      totalTokens: 10,
      totalCost: 0.1,
    }
    replaceAgentObservations(database, "/sessions/parent.jsonl", [observation])
    reconcileAgentRuns(database)

    expect(
      getStats(database, filters, null).overview.averageDurationMs
    ).toBeCloseTo(101_000 / 11, 0)
    database.close()
  })

  it("déduplique tools et skills entre session persistée et output", () => {
    const database = createDatabase(":memory:")
    const insertSession = database.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES (?, ?, '/work/project', ?, '2026-01-01T00:00:00.000Z', ?, ?)"
    )
    insertSession.run("/sessions/root.jsonl", "root", null, null, "root")
    insertSession.run(
      "/sessions/child.jsonl",
      "child",
      "worker#agent-1",
      "/sessions/root.jsonl",
      "child"
    )
    insertSession.run("/tmp/agent-1.output", "agent-1", null, null, "agent-1")
    const insertTool = database.prepare(
      "INSERT INTO tool_calls (id, source_key, file_path, session_id, cwd, name, provider, model, started_at, duration_ms, is_error) VALUES (?, ?, ?, ?, '/work/project', 'read', 'openai', 'gpt', '2026-01-01T00:00:01.000Z', 1, 0)"
    )
    const insertSkill = database.prepare(
      "INSERT INTO skill_usages (id, source_key, file_path, session_id, cwd, skill, provider, model, used_at) VALUES (?, ?, ?, ?, '/work/project', 'demo', 'openai', 'gpt', '2026-01-01T00:00:01.000Z')"
    )
    for (const [suffix, path, session] of [
      ["child", "/sessions/child.jsonl", "child"],
      ["output", "/tmp/agent-1.output", "agent-1"],
    ]) {
      insertTool.run(`tool-${suffix}`, "same-tool", path, session)
      insertSkill.run(`skill-${suffix}`, "same-skill", path, session)
    }
    const base = tintinwebAdapter.inspect(tintinInput()).observations[0]!
    base.agentType = "worker"
    base.sourcePath = "/sessions/root.jsonl"
    base.rootSessionRef = "root"
    base.rootSessionFile = "/sessions/root.jsonl"
    const output = {
      ...base,
      observationKey: "output-observation",
      channel: "output",
      sourcePath: "/tmp/agent-1.output",
      sessionFile: "/tmp/agent-1.output",
      metadataPriority: 80,
      usagePriority: 80,
    } satisfies AgentObservation
    replaceAgentObservations(database, "/sessions/root.jsonl", [base])
    replaceAgentObservations(database, "/tmp/agent-1.output", [output])

    reconcileAgentRuns(database)

    expect(
      database
        .prepare(
          "SELECT file_path, usage_scope FROM tool_calls ORDER BY file_path"
        )
        .all()
    ).toEqual([
      { file_path: "/sessions/child.jsonl", usage_scope: "self" },
      { file_path: "/tmp/agent-1.output", usage_scope: "duplicate" },
    ])
    expect(
      database.prepare("SELECT COUNT(*) FROM unique_tool_calls").pluck().get()
    ).toBe(1)
    expect(
      database.prepare("SELECT COUNT(*) FROM unique_skill_usages").pluck().get()
    ).toBe(1)

    insertSession.run(
      "/sessions/new-child.jsonl",
      "new-child",
      null,
      "/sessions/root.jsonl",
      "new-child"
    )
    base.sessionFile = "/sessions/new-child.jsonl"
    replaceAgentObservations(database, "/sessions/root.jsonl", [base])
    reconcileAgentRuns(database)
    expect(
      database
        .prepare(
          "SELECT file_path FROM sessions WHERE agent_run_key IS NOT NULL ORDER BY file_path"
        )
        .pluck()
        .all()
    ).toEqual(["/sessions/new-child.jsonl", "/tmp/agent-1.output"])
    database.close()
  })

  it("associe un résultat Tintin à l’appel de sa branche", () => {
    const input = tintinInput()
    input.records = [
      {
        type: "message",
        id: "branch-a",
        parentId: null,
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "same-call",
              name: "Agent",
              arguments: { subagent_type: "branch-a" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "branch-b",
        parentId: null,
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "same-call",
              name: "Agent",
              arguments: { subagent_type: "branch-b" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "result-a",
        parentId: "branch-a",
        message: {
          role: "toolResult",
          toolCallId: "same-call",
          toolName: "Agent",
          details: { agentId: "agent-a" },
        },
      },
    ]

    expect(tintinwebAdapter.inspect(input).observations[0]?.agentType).toBe(
      "branch-a"
    )
  })

  it("tolère les événements lifecycle nicobailon connus et inconnus", () => {
    const result = nicobailonAdapter.inspect({
      filePath: "/tmp/pi-subagents-1000/async-subagent-runs/run/events.jsonl",
      session: null,
      records: [
        {
          type: "subagent.step.started",
          lifecycleArtifactVersion: 3,
          runId: "run",
          stepIndex: 1,
          agent: "worker",
          ts: 1_767_225_600_000,
        },
        {
          type: "subagent.step.completed",
          lifecycleArtifactVersion: 3,
          runId: "run",
          stepIndex: 1,
          agent: "worker",
          ts: 1_767_225_601_000,
        },
        { type: "subagent.future.event", runId: "run" },
      ],
    })

    expect(result.observations).toEqual([
      expect.objectContaining({
        channel: "events",
        nativeRunKey: JSON.stringify(["run", 1]),
        status: "completed",
      }),
    ])
  })

  it("conserve des identités distinctes pour les runs nicobailon imbriqués", () => {
    const filePath =
      "/tmp/pi-subagents-uid-1000/async-subagent-runs/root-run/status.json"
    const result = nicobailonAdapter.inspect({
      filePath,
      session: null,
      records: [
        {
          lifecycleArtifactVersion: 3,
          runId: "root-run",
          sessionId: "root-session",
          mode: "single",
          steps: [
            {
              index: 0,
              childId: "root-child",
              agent: "reviewer",
              status: "complete",
              children: [
                {
                  id: "nested-run",
                  parentRunId: "root-run",
                  parentStepIndex: 0,
                  agent: "worker",
                  state: "complete",
                },
              ],
            },
          ],
        },
      ],
    })
    expect(result.observations).toHaveLength(2)
    expect(
      new Set(result.observations.map((item) => item.nativeRunKey)).size
    ).toBe(2)
    expect(result.observations[1]).toMatchObject({
      nativeId: "nested-run",
      parentNativeId: "root-child",
    })

    const database = createDatabase(":memory:")
    database
      .prepare(
        "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id) VALUES ('/sessions/root.jsonl', 'root-session', '/work/project', 'Root', '2026-01-01T00:00:00.000Z', NULL, 'root-session')"
      )
      .run()
    replaceAgentObservations(database, filePath, result.observations)
    reconcileAgentRuns(database)
    expect(
      database
        .prepare("SELECT native_id, depth FROM agent_runs ORDER BY depth")
        .all()
    ).toEqual([
      { native_id: "root-child", depth: 1 },
      { native_id: "nested-run", depth: 2 },
    ])
    database.close()
  })

  it("ignore une version d’artefact nicobailon inconnue", () => {
    expect(
      nicobailonAdapter.inspect({
        filePath: "/tmp/pi-subagents-1000/async-subagent-runs/run/status.json",
        session: null,
        records: [{ lifecycleArtifactVersion: 99, runId: "run" }],
      }).observations
    ).toEqual([])
  })

  it("accepte un troisième adaptateur sans modifier le cœur", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-third-adapter-"))
    temporaryDirectories.push(directory)
    const sessionsDirectory = join(directory, "sessions")
    const artifactsDirectory = join(directory, "artifacts")
    await mkdir(sessionsDirectory)
    await mkdir(artifactsDirectory)
    await writeFile(
      join(sessionsDirectory, "parent.jsonl"),
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "parent",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: "/work/project",
        }),
        JSON.stringify({
          type: "message",
          id: "request",
          parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            role: "assistant",
            provider: "openai",
            model: "gpt-main",
            content: [],
            usage: {
              input: 1,
              output: 1,
              totalTokens: 2,
              cost: { total: 0.01 },
            },
          },
        }),
      ].join("\n")
    )
    const artifactPath = join(artifactsDirectory, "run.agentstat")
    await writeFile(artifactPath, JSON.stringify({ run: "third-1" }))
    const observation: AgentObservation = {
      observationKey: "third-observation",
      nativeRunKey: "third-1",
      nativeId: "third-1",
      adapter: "third",
      channel: "artifact",
      sourcePath: artifactPath,
      sourceEntryId: null,
      artifactVersion: "1",
      rootSessionRef: "parent",
      rootSessionFile: null,
      sessionFile: null,
      parentNativeId: null,
      workflowId: null,
      workflowStepIndex: null,
      agentType: "custom",
      displayName: "Custom",
      description: null,
      statusRaw: "complete",
      status: "completed",
      startedAt: "2026-01-01T00:00:02.000Z",
      completedAt: "2026-01-01T00:00:03.000Z",
      provider: "openai",
      modelId: "gpt-child",
      modelLabel: null,
      usage: {
        inputTokens: 4,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 5,
        totalCost: 0.02,
        requestCount: 1,
        toolCount: 0,
        turnCount: 1,
        scope: "self",
      },
      precision: {
        identity: "exact",
        linkage: "exact",
        model: "exact",
        tokens: "exact",
        cost: "exact",
      },
      metadataPriority: 100,
      usagePriority: 100,
    }
    const adapter: AgentAdapter = {
      id: "third",
      defaultRoots: () => [],
      acceptsArtifact: (path) => path.endsWith(".agentstat"),
      retainWhenMissing: () => true,
      inspect: (input) => ({
        observations: input.filePath === artifactPath ? [observation] : [],
      }),
    }
    const database = createDatabase(":memory:")

    await new SessionSynchronizer(
      database,
      sessionsDirectory,
      [artifactsDirectory],
      [adapter]
    ).sync()

    const result = getSessions(database, filters, page)
    expect(result.rows[0]).toMatchObject({
      id: "parent",
      requests: 2,
      tokens: 7,
      cost: 0.03,
      agents: [
        {
          id: "third-1",
          source: "third",
          tokens: 5,
          cost: 0.02,
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain("run.agentstat")
    database.close()
  })
})
