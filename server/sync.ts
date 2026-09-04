import type { SqliteDatabase } from "./database.ts"
import { execFile } from "node:child_process"
import { readdir, readFile, realpath, stat } from "node:fs/promises"
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"
import { promisify } from "node:util"
import {
  agentAdapters,
  type AgentAdapter,
  type AgentPrecision,
  type AgentUsageScope,
} from "./agent-adapters/index.ts"
import {
  deleteAgentObservations,
  reconcileAgentRuns,
  replaceAgentObservations,
} from "./agents.ts"
import type { SyncResult } from "./types.ts"

const execFileAsync = promisify(execFile)

interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost: number
}

interface ParsedRequest {
  id: string
  sourceKey: string
  requestKey: string
  sourceEntryId: string | null
  timestamp: string
  provider: string
  model: string
  usage: Usage
  isError: boolean
  durationMs: number
  sourceChannel: string
  usageScope: AgentUsageScope
  tokenPrecision: AgentPrecision
  costPrecision: AgentPrecision
}

interface ParsedToolCall {
  id: string
  sourceKey: string
  name: string
  provider: string
  model: string
  startedAt: string
  durationMs: number
  isError: boolean
}

interface ParsedSkillUsage {
  id: string
  sourceKey: string
  skill: string
  provider: string
  model: string
  usedAt: string
}

export interface ParsedSession {
  id: string
  cwd: string
  name: string | null
  startedAt: string
  parentSession: string | null
  requests: ParsedRequest[]
  tools: ParsedToolCall[]
  skills: ParsedSkillUsage[]
}

const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0
const text = (value: unknown): string =>
  typeof value === "string" ? value : ""
const iso = (value: unknown, fallback: string): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const candidate = new Date(value)
    return Number.isNaN(candidate.getTime())
      ? fallback
      : candidate.toISOString()
  }
  const candidate = text(value)
  return Number.isNaN(Date.parse(candidate)) ? fallback : candidate
}

function skillNameFromPath(value: unknown): string | null {
  const path = text(value)
  if (path.startsWith("skill://"))
    return path.slice("skill://".length).split("/")[0] || null
  const normalized = path.replaceAll("\\", "/")
  const match = normalized.match(/\/([^/]+)\/SKILL\.md$/i)
  return match?.[1] ?? null
}

function usageFrom(value: unknown): Usage | null {
  if (!value || typeof value !== "object") return null
  const source = value as Record<string, unknown>
  const input = number(source.input ?? source.inputTokens)
  const output = number(source.output ?? source.outputTokens)
  const cacheRead = number(source.cacheRead ?? source.cacheReadTokens)
  const cacheWrite = number(source.cacheWrite ?? source.cacheWriteTokens)
  const totalTokens =
    number(source.totalTokens) || input + output + cacheRead + cacheWrite
  const costs =
    source.cost && typeof source.cost === "object"
      ? (source.cost as Record<string, unknown>)
      : {}
  const cost = number(costs.total ?? source.cost)
  return { input, output, cacheRead, cacheWrite, totalTokens, cost }
}

export function parseSourceRecords(
  filePath: string,
  source: string
): Record<string, unknown>[] {
  if (filePath.endsWith(".json")) {
    try {
      const parsed: unknown = JSON.parse(source)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? [parsed as Record<string, unknown>]
        : []
    } catch {
      return []
    }
  }
  return source.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return []
    try {
      const parsed: unknown = JSON.parse(line)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? [parsed as Record<string, unknown>]
        : []
    } catch {
      return []
    }
  })
}

export function parseSessionJsonl(
  filePath: string,
  source: string,
  inferredParentSession: string | null = null,
  records = parseSourceRecords(filePath, source)
): ParsedSession | null {
  const fallbackTime = new Date().toISOString()
  let sessionId = basename(filePath, extname(filePath))
  let cwd = ""
  let name: string | null = null
  let startedAt = fallbackTime
  let parentSession: string | null = inferredParentSession
  let currentProvider = "unknown"
  let currentModel = "unknown"
  let lastActivityAt: string | null = null
  const requests: ParsedRequest[] = []
  const tools = new Map<string, ParsedToolCall>()
  const skills: ParsedSkillUsage[] = []
  let requestCounter = 0
  let lineCounter = 0
  const sourceChannel = filePath.endsWith(".jsonl")
    ? "pi-session"
    : "external-artifact"

  for (const originalEntry of records) {
    let entry = originalEntry
    lineCounter += 1
    if (
      entry.type !== "message" &&
      ["user", "assistant", "toolResult"].includes(text(entry.type)) &&
      entry.message &&
      typeof entry.message === "object"
    ) {
      const wrappedMessage = entry.message as Record<string, unknown>
      cwd = text(entry.cwd) || cwd
      const wrapperTimestamp = iso(entry.timestamp, startedAt)
      if (lineCounter === 1) startedAt = wrapperTimestamp
      const responseIdentity =
        text(wrappedMessage.responseId) || String(lineCounter)
      entry = {
        type: "message",
        id: text(entry.id) || `${sessionId}:${responseIdentity}`,
        parentId: entry.parentId ?? null,
        timestamp: iso(wrappedMessage.timestamp, wrapperTimestamp),
        message: wrappedMessage,
      }
    }

    if (entry.type === "session") {
      sessionId = text(entry.id) || sessionId
      cwd = text(entry.cwd)
      startedAt = iso(entry.timestamp, startedAt)
      parentSession = text(entry.parentSession) || parentSession
      continue
    }
    if (entry.type === "session_info") {
      name = text(entry.name).trim() || null
      continue
    }
    if (entry.type === "model_change") {
      currentProvider = text(entry.provider) || currentProvider
      currentModel = text(entry.modelId) || currentModel
      continue
    }

    const timestamp = iso(entry.timestamp, startedAt)
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      const usage = usageFrom(entry.usage)
      if (usage) {
        requestCounter += 1
        const sourceEntryId = text(entry.id) || null
        const sourceKey = `${sourceEntryId ?? "missing"}:${timestamp}:${entry.type}`
        requests.push({
          id: `${sessionId}:${sourceEntryId ?? requestCounter}:summary`,
          sourceKey,
          requestKey: sourceKey,
          sourceEntryId,
          timestamp,
          provider: currentProvider,
          model: currentModel,
          usage,
          isError: false,
          durationMs: 0,
          sourceChannel,
          usageScope: "self",
          tokenPrecision: "exact",
          costPrecision: "exact",
        })
      }
      // retainedTail is a context checkpoint, not independently billed usage.
      continue
    }
    if (entry.type !== "message") continue
    const message = entry.message
    if (!message || typeof message !== "object") continue
    const item = message as Record<string, unknown>
    const role = text(item.role)

    if (role === "user") {
      lastActivityAt = timestamp
      continue
    }

    if (role === "assistant") {
      currentProvider = text(item.provider) || currentProvider
      currentModel = text(item.model) || currentModel
      const usage = usageFrom(item.usage) ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: 0,
      }
      requestCounter += 1
      const stopReason = text(item.stopReason) || "unknown"
      const hasProviderError = Boolean(text(item.errorMessage))
      const isError = stopReason === "error" || hasProviderError
      const sourceEntryId = text(entry.id) || null
      const sourceKey = `${sourceEntryId ?? "missing"}:${timestamp}:assistant`
      const responseId = text(item.responseId)
      requests.push({
        id: `${sessionId}:${sourceEntryId ?? requestCounter}:assistant`,
        sourceKey,
        requestKey: responseId
          ? JSON.stringify([
              "response",
              currentProvider,
              currentModel,
              responseId,
            ])
          : sourceKey,
        sourceEntryId,
        timestamp,
        provider: currentProvider,
        model: currentModel,
        usage,
        isError,
        durationMs: lastActivityAt
          ? Math.max(0, Date.parse(timestamp) - Date.parse(lastActivityAt))
          : 0,
        sourceChannel,
        usageScope: "self",
        tokenPrecision: "exact",
        costPrecision: "exact",
      })
      const content = Array.isArray(item.content) ? item.content : []
      for (const block of content) {
        if (!block || typeof block !== "object") continue
        const call = block as Record<string, unknown>
        if (call.type !== "toolCall") continue
        const callId = text(call.id)
        if (!callId) continue
        const toolName = text(call.name) || "unknown"
        const argumentsValue = call.arguments
        const argumentsRecord =
          argumentsValue && typeof argumentsValue === "object"
            ? (argumentsValue as Record<string, unknown>)
            : {}
        const recordedTool: ParsedToolCall = {
          id: `${sessionId}:${callId}`,
          sourceKey: `${text(entry.id) || "missing"}:${callId}:${timestamp}:tool`,
          name: toolName,
          provider: currentProvider,
          model: currentModel,
          startedAt: timestamp,
          durationMs: 0,
          isError: false,
        }
        tools.set(callId, recordedTool)
        const skill =
          toolName === "read" ? skillNameFromPath(argumentsRecord.path) : null
        if (skill) {
          skills.push({
            id: `${sessionId}:${callId}:skill`,
            sourceKey: `${text(entry.id) || "missing"}:${callId}:${timestamp}:${skill}:skill`,
            skill,
            provider: currentProvider,
            model: currentModel,
            usedAt: timestamp,
          })
        }
      }
      continue
    }

    if (role !== "toolResult") continue
    const callId = text(item.toolCallId)
    const compositeId = `${sessionId}:${callId}`
    const existing = tools.get(callId)
    const isError = item.isError === true
    if (existing) {
      existing.durationMs = Math.max(
        0,
        Date.parse(timestamp) - Date.parse(existing.startedAt)
      )
      existing.isError = isError
    } else {
      tools.set(callId || `${requestCounter}:${timestamp}`, {
        id: callId
          ? compositeId
          : `${sessionId}:tool:${requestCounter}:${timestamp}`,
        sourceKey: `${text(entry.id) || "missing"}:${callId || "missing"}:${timestamp}:tool`,
        name: text(item.toolName) || "unknown",
        provider: currentProvider,
        model: currentModel,
        startedAt: timestamp,
        durationMs: 0,
        isError,
      })
    }
    const usage = usageFrom(item.usage)
    if (usage) {
      requestCounter += 1
      const sourceEntryId = text(entry.id) || null
      const sourceKey = `${sourceEntryId ?? "missing"}:${timestamp}:tool-usage`
      requests.push({
        id: `${sessionId}:${sourceEntryId ?? requestCounter}:tool`,
        sourceKey,
        requestKey: sourceKey,
        sourceEntryId,
        timestamp,
        provider: currentProvider,
        model: currentModel,
        usage,
        isError,
        durationMs: 0,
        sourceChannel,
        usageScope: "self",
        tokenPrecision: "exact",
        costPrecision: "exact",
      })
    }
    lastActivityAt = timestamp
  }

  return cwd
    ? {
        id: sessionId,
        cwd,
        name,
        startedAt,
        parentSession,
        requests,
        tools: [...tools.values()],
        skills,
      }
    : null
}

async function listSessionFiles(
  roots: string[],
  adapters: AgentAdapter[]
): Promise<{ files: string[]; unreadable: string[] }> {
  const files: string[] = []
  const unreadable: string[] = []
  await Promise.all(
    roots.map(async (root) => {
      try {
        const entries = await readdir(root, {
          recursive: true,
          withFileTypes: true,
          encoding: "utf8",
        })
        files.push(
          ...entries
            .filter((entry) => {
              if (!entry.isFile()) return false
              const path = join(entry.parentPath, entry.name)
              return (
                entry.name.endsWith(".jsonl") ||
                adapters.some((adapter) => adapter.acceptsArtifact(path))
              )
            })
            .map((entry) => join(entry.parentPath, entry.name))
        )
      } catch {
        unreadable.push(root)
      }
    })
  )
  return { files: [...new Set(files)], unreadable }
}

function isWithin(directory: string, path: string): boolean {
  const nested = relative(resolve(directory), resolve(path))
  return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested))
}

function workspaceProjectName(cwd: string): string | null {
  const parts = resolve(cwd).split(sep)
  const container = parts.findIndex(
    (part, index) =>
      (part === "worktrees" && parts[index - 1] === ".herdr") ||
      (part === "workspaces" && parts[index - 1] === "orca")
  )
  return container >= 0 ? (parts[container + 1] ?? null) : null
}

async function gitProject(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "worktree", "list", "--porcelain"],
      { encoding: "utf8" }
    )
    const main = stdout
      .split("\n")
      .find((line) => line.startsWith("worktree "))
      ?.slice(9)
    return main ? await realpath(main) : null
  } catch {
    return null
  }
}

async function refreshProjectAliases(db: SqliteDatabase): Promise<void> {
  const aliases = new Map(
    db
      .prepare("SELECT cwd, project FROM project_aliases")
      .all()
      .map((row) => {
        const alias = row as { cwd: string; project: string }
        return [alias.cwd, alias.project]
      })
  )
  const cwds = db
    .prepare("SELECT DISTINCT cwd FROM sessions WHERE cwd <> ''")
    .pluck()
    .all() as string[]
  const pending = cwds.filter(
    (cwd) =>
      !aliases.has(cwd) ||
      (aliases.get(cwd) === cwd && workspaceProjectName(cwd))
  )
  const resolved = await Promise.all(
    pending.map(async (cwd) => [cwd, await gitProject(cwd)] as const)
  )
  for (const [cwd, project] of resolved) if (project) aliases.set(cwd, project)

  const knownProjects = new Set(
    [...aliases.values(), ...cwds].filter((path) => !workspaceProjectName(path))
  )
  const save = db.prepare(
    "INSERT INTO project_aliases (cwd, project) VALUES (?, ?) ON CONFLICT(cwd) DO UPDATE SET project = excluded.project"
  )
  const update = db.transaction(() => {
    for (const [cwd, gitRoot] of resolved) {
      let project = gitRoot
      const name = workspaceProjectName(cwd)
      if (!project && name) {
        const candidates = [...knownProjects].filter(
          (candidate) => basename(candidate) === name
        )
        if (candidates.length === 1) project = candidates[0]!
      }
      save.run(cwd, project ?? cwd)
    }
  })
  update()
}

export class SessionSynchronizer {
  private pending: Promise<SyncResult> | null = null

  constructor(
    private readonly db: SqliteDatabase,
    private readonly sessionsDirectory: string,
    private readonly additionalDirectories: string[] = [],
    private readonly adapters: AgentAdapter[] = agentAdapters
  ) {}

  sync(): Promise<SyncResult> {
    if (!this.pending)
      this.pending = this.run().finally(() => {
        this.pending = null
      })
    return this.pending
  }

  private async run(): Promise<SyncResult> {
    const started = Date.now()
    const { files, unreadable } = await listSessionFiles(
      [this.sessionsDirectory, ...this.additionalDirectories],
      this.adapters
    )
    const known = new Map(
      (
        this.db
          .prepare(
            "SELECT path, size, mtime_ms, retain_when_missing FROM indexed_files"
          )
          .all() as Array<{
          path: string
          size: number
          mtime_ms: number
          retain_when_missing: number
        }>
      ).map((row) => [row.path, row])
    )
    const requiresReconciliation = [...known.values()].some(
      (indexed) => indexed.size === -1
    )
    for (const filePath of known.keys())
      if (unreadable.some((directory) => isWithin(directory, filePath)))
        known.delete(filePath)
    let updated = 0
    for (const filePath of files) {
      let metadata: { size: number; mtimeMs: number }
      try {
        const value = await stat(filePath)
        metadata = { size: value.size, mtimeMs: value.mtimeMs }
      } catch {
        continue
      }
      const indexed = known.get(filePath)
      known.delete(filePath)
      if (
        indexed &&
        indexed.size === metadata.size &&
        indexed.mtime_ms === metadata.mtimeMs
      )
        continue
      let source: string
      try {
        source = await readFile(filePath, "utf8")
      } catch {
        continue
      }
      const records = parseSourceRecords(filePath, source)
      if (source.trim() && !records.length) continue
      const acceptedAsArtifact = this.adapters.some((adapter) =>
        adapter.acceptsArtifact(filePath)
      )
      const parsed = parseSessionJsonl(filePath, source, null, records)
      if (filePath.endsWith(".jsonl") && !acceptedAsArtifact && !parsed)
        continue
      const adapterInput = {
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
      }
      const adapterResults = this.adapters.map((adapter) => {
        try {
          return adapter.inspect(adapterInput)
        } catch {
          return { observations: [], claimedToolResultEntryIds: [] }
        }
      })
      const observations = adapterResults.flatMap(
        (result) => result.observations
      )
      if (acceptedAsArtifact && !observations.length) continue
      const claimedEntries = new Set(
        adapterResults.flatMap(
          (result) => result.claimedToolResultEntryIds ?? []
        )
      )
      const artifactSourceChannel = observations[0]
        ? `${observations[0].adapter}:${observations[0].channel}`
        : null
      for (const request of parsed?.requests ?? []) {
        if (artifactSourceChannel && !filePath.endsWith(".jsonl"))
          request.sourceChannel = artifactSourceChannel
        if (request.sourceEntryId && claimedEntries.has(request.sourceEntryId))
          request.usageScope = "unassigned"
      }
      const inferredParentSession = observations
        .map((observation) => observation.rootSessionRef)
        .find((value): value is string => Boolean(value))
      const replace = this.db.transaction(() => {
        this.db
          .prepare("DELETE FROM requests WHERE file_path = ?")
          .run(filePath)
        this.db
          .prepare("DELETE FROM tool_calls WHERE file_path = ?")
          .run(filePath)
        this.db
          .prepare("DELETE FROM sessions WHERE file_path = ?")
          .run(filePath)
        this.db
          .prepare("DELETE FROM skill_usages WHERE file_path = ?")
          .run(filePath)
        replaceAgentObservations(this.db, filePath, observations)
        if (parsed) {
          const accountingSessionId = inferredParentSession ?? parsed.id
          this.db
            .prepare(
              "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id, session_kind, linkage_precision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .run(
              filePath,
              parsed.id,
              parsed.cwd,
              parsed.name,
              parsed.startedAt,
              parsed.parentSession,
              accountingSessionId,
              observations.length && inferredParentSession ? "agent" : "root",
              inferredParentSession ? "estimated" : "unknown"
            )
          const request = this.db.prepare(
            `INSERT INTO requests (id, source_key, request_key, file_path, session_id, accounting_session_id, cwd, timestamp, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, is_error, duration_ms, source_channel, usage_scope, token_precision, cost_precision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          for (const item of parsed.requests)
            request.run(
              item.id,
              item.sourceKey,
              item.requestKey,
              filePath,
              parsed.id,
              accountingSessionId,
              parsed.cwd,
              item.timestamp,
              item.provider,
              item.model,
              item.usage.input,
              item.usage.output,
              item.usage.cacheRead,
              item.usage.cacheWrite,
              item.usage.totalTokens,
              item.usage.cost,
              Number(item.isError),
              item.durationMs,
              item.sourceChannel,
              item.usageScope,
              item.tokenPrecision,
              item.costPrecision
            )
          const tool = this.db.prepare(
            "INSERT INTO tool_calls (id, source_key, file_path, session_id, cwd, name, provider, model, started_at, duration_ms, is_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          for (const item of parsed.tools)
            tool.run(
              item.id,
              item.sourceKey,
              filePath,
              parsed.id,
              parsed.cwd,
              item.name,
              item.provider,
              item.model,
              item.startedAt,
              item.durationMs,
              Number(item.isError)
            )
          const skill = this.db.prepare(
            "INSERT INTO skill_usages (id, source_key, file_path, session_id, cwd, skill, provider, model, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          for (const item of parsed.skills)
            skill.run(
              item.id,
              item.sourceKey,
              filePath,
              parsed.id,
              parsed.cwd,
              item.skill,
              item.provider,
              item.model,
              item.usedAt
            )
        }
        const retainingAdapter = this.adapters.find((adapter) =>
          adapter.retainWhenMissing(filePath)
        )
        const retainWhenMissing = retainingAdapter ? 1 : 0
        const sourceChannel = observations[0]?.channel ?? "pi-session"
        this.db
          .prepare(
            "INSERT INTO indexed_files (path, size, mtime_ms, indexed_at, retain_when_missing, source_channel) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, indexed_at = excluded.indexed_at, retain_when_missing = excluded.retain_when_missing, source_channel = excluded.source_channel"
          )
          .run(
            filePath,
            metadata.size,
            metadata.mtimeMs,
            new Date().toISOString(),
            retainWhenMissing,
            sourceChannel
          )
      })
      replace()
      updated += 1
    }
    let removed = 0
    const remove = this.db.transaction(() => {
      for (const [filePath, indexed] of known) {
        if (indexed.retain_when_missing) continue
        this.db
          .prepare("DELETE FROM requests WHERE file_path = ?")
          .run(filePath)
        this.db
          .prepare("DELETE FROM tool_calls WHERE file_path = ?")
          .run(filePath)
        this.db
          .prepare("DELETE FROM sessions WHERE file_path = ?")
          .run(filePath)
        this.db
          .prepare("DELETE FROM skill_usages WHERE file_path = ?")
          .run(filePath)
        deleteAgentObservations(this.db, filePath)
        this.db
          .prepare("DELETE FROM indexed_files WHERE path = ?")
          .run(filePath)
        removed += 1
      }
    })
    remove()
    if (updated > 0 || removed > 0 || requiresReconciliation) {
      reconcileAgentRuns(this.db)
      this.db
        .prepare("UPDATE indexed_files SET size = -2 WHERE size = -1")
        .run()
    }
    await refreshProjectAliases(this.db)
    return {
      scanned: files.length,
      updated,
      removed,
      durationMs: Date.now() - started,
    }
  }
}
