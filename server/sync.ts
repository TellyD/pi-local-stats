import type { SqliteDatabase } from "./database.ts"
import { execFile } from "node:child_process"
import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import { agentAdapters, type AgentAdapter } from "./agent-adapters/index.ts"
import {
  deleteAgentObservations,
  reconcileAgentRuns,
  replaceAgentObservations,
} from "./agents.ts"
import { parseSessionJsonl, parseSourceRecords } from "./session-parser.ts"
import type { SyncResult } from "./types.ts"

export { parseSessionJsonl, parseSourceRecords } from "./session-parser.ts"
export type { ParsedSession } from "./session-parser.ts"

const execFileAsync = promisify(execFile)

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
    const deleteRequests = this.db.prepare(
      "DELETE FROM requests WHERE file_path = ?"
    )
    const deleteToolCalls = this.db.prepare(
      "DELETE FROM tool_calls WHERE file_path = ?"
    )
    const deleteSession = this.db.prepare(
      "DELETE FROM sessions WHERE file_path = ?"
    )
    const deleteSkillUsages = this.db.prepare(
      "DELETE FROM skill_usages WHERE file_path = ?"
    )
    const deleteIndexedFile = this.db.prepare(
      "DELETE FROM indexed_files WHERE path = ?"
    )
    const insertSession = this.db.prepare(
      "INSERT INTO sessions (file_path, session_id, cwd, name, started_at, parent_session, accounting_session_id, session_kind, linkage_precision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    const insertRequest = this.db.prepare(
      "INSERT INTO requests (id, source_key, request_key, file_path, session_id, accounting_session_id, cwd, timestamp, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, is_error, duration_ms, source_channel, usage_scope, token_precision, cost_precision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    const insertToolCall = this.db.prepare(
      "INSERT INTO tool_calls (id, source_key, file_path, session_id, cwd, name, provider, model, started_at, duration_ms, is_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    const insertSkillUsage = this.db.prepare(
      "INSERT INTO skill_usages (id, source_key, file_path, session_id, cwd, skill, provider, model, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    const upsertIndexedFile = this.db.prepare(
      "INSERT INTO indexed_files (path, size, mtime_ms, indexed_at, retain_when_missing, source_channel) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, indexed_at = excluded.indexed_at, retain_when_missing = excluded.retain_when_missing, source_channel = excluded.source_channel"
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
        deleteRequests.run(filePath)
        deleteToolCalls.run(filePath)
        deleteSession.run(filePath)
        deleteSkillUsages.run(filePath)
        replaceAgentObservations(this.db, filePath, observations)
        if (parsed) {
          const accountingSessionId = inferredParentSession ?? parsed.id
          insertSession.run(
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
          for (const item of parsed.requests)
            insertRequest.run(
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
          for (const item of parsed.tools)
            insertToolCall.run(
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
          for (const item of parsed.skills)
            insertSkillUsage.run(
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
        upsertIndexedFile.run(
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
        deleteRequests.run(filePath)
        deleteToolCalls.run(filePath)
        deleteSession.run(filePath)
        deleteSkillUsages.run(filePath)
        deleteAgentObservations(this.db, filePath)
        deleteIndexedFile.run(filePath)
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
