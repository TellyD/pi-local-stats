import type { SqliteDatabase } from "./database.ts"
import type {
  AgentPrecision,
  AgentUsageObservation,
} from "./agent-adapters/index.ts"
import { canonicalRunKey, stableKey } from "./agent-keys.ts"

interface ObservationRow {
  observation_key: string
  logical_key: string
  run_key: string
  native_run_key: string
  native_id: string
  adapter: string
  channel: string
  source_path: string
  source_entry_id: string | null
  artifact_version: string | null
  root_session_ref: string | null
  root_session_file: string | null
  session_file: string | null
  parent_native_id: string | null
  workflow_id: string | null
  workflow_step_index: number | null
  agent_type: string | null
  display_name: string | null
  description: string | null
  status_raw: string | null
  status_canonical: string
  started_at: string | null
  completed_at: string | null
  provider: string | null
  model_id: string | null
  model_label: string | null
  usage_scope: string | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  total_tokens: number | null
  total_cost: number | null
  request_count: number | null
  tool_count: number | null
  turn_count: number | null
  identity_precision: AgentPrecision
  linkage_precision: AgentPrecision
  model_precision: AgentPrecision
  token_precision: AgentPrecision
  cost_precision: AgentPrecision
  metadata_priority: number
  usage_priority: number
}

interface SessionRow {
  file_path: string
  session_id: string
  name: string | null
  started_at: string
  parent_session: string | null
  agent_run_key: string | null
}

const precisionRank: Record<AgentPrecision, number> = {
  unknown: 0,
  estimated: 1,
  reported: 2,
  exact: 3,
}

const terminalStatuses = new Set(["completed", "failed", "cancelled"])

function timestampTime(value: string | null): number {
  const parsed = Date.parse(value ?? "")
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

function observationTime(observation: ObservationRow): number {
  return timestampTime(observation.completed_at ?? observation.started_at)
}

function newestFirst(left: ObservationRow, right: ObservationRow): number {
  return (
    observationTime(right) - observationTime(left) ||
    left.observation_key.localeCompare(right.observation_key)
  )
}

function bestStatus(rows: ObservationRow[]): ObservationRow | null {
  return (
    [...rows]
      .filter((row) => row.status_raw)
      .sort(
        (left, right) =>
          Number(terminalStatuses.has(right.status_canonical)) -
            Number(terminalStatuses.has(left.status_canonical)) ||
          observationTime(right) - observationTime(left) ||
          right.metadata_priority - left.metadata_priority ||
          left.observation_key.localeCompare(right.observation_key)
      )[0] ?? null
  )
}

function usageOf(row: ObservationRow): AgentUsageObservation | null {
  return row.usage_scope
    ? {
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheWriteTokens: row.cache_write_tokens,
        totalTokens: row.total_tokens,
        totalCost: row.total_cost,
        requestCount: row.request_count,
        toolCount: row.tool_count,
        turnCount: row.turn_count,
        scope: row.usage_scope as AgentUsageObservation["scope"],
      }
    : null
}

function firstValue<K extends keyof ObservationRow>(
  rows: ObservationRow[],
  key: K
): ObservationRow[K] {
  for (const row of rows)
    if (row[key] !== null && row[key] !== "") return row[key]
  return null as ObservationRow[K]
}

function resolveSession(
  observation: ObservationRow,
  byPath: Map<string, SessionRow>,
  byId: Map<string, SessionRow[]>
): SessionRow | null {
  if (observation.root_session_file) {
    const exact = byPath.get(observation.root_session_file)
    if (exact) return exact
  }
  if (observation.root_session_ref) {
    const byExactPath = byPath.get(observation.root_session_ref)
    if (byExactPath) return byExactPath
    const candidates = byId.get(observation.root_session_ref) ?? []
    return (
      [...candidates].sort(
        (left, right) =>
          Number(Boolean(left.parent_session)) -
            Number(Boolean(right.parent_session)) ||
          left.started_at.localeCompare(right.started_at) ||
          left.file_path.localeCompare(right.file_path)
      )[0] ?? null
    )
  }
  return null
}

function lineageOrigin(
  session: SessionRow,
  byPath: Map<string, SessionRow>
): SessionRow {
  let current = session
  const seen = new Set<string>()
  while (
    current.parent_session &&
    !seen.has(current.file_path) &&
    byPath.has(current.parent_session)
  ) {
    seen.add(current.file_path)
    current = byPath.get(current.parent_session)!
  }
  return current
}

function bestRootObservation(
  rows: ObservationRow[],
  byPath: Map<string, SessionRow>,
  byId: Map<string, SessionRow[]>
): { observation: ObservationRow; session: SessionRow | null } {
  return rows
    .map((observation) => ({
      observation,
      session: resolveSession(observation, byPath, byId),
    }))
    .sort(
      (left, right) =>
        Number(Boolean(left.session?.parent_session)) -
          Number(Boolean(right.session?.parent_session)) ||
        precisionRank[right.observation.linkage_precision] -
          precisionRank[left.observation.linkage_precision] ||
        right.observation.metadata_priority -
          left.observation.metadata_priority ||
        left.observation.observation_key.localeCompare(
          right.observation.observation_key
        )
    )[0]!
}

function findAgentSession(
  rows: ObservationRow[],
  root: SessionRow | null,
  sessions: SessionRow[],
  runKey: string
): SessionRow | null {
  for (const row of rows) {
    if (!row.session_file || row.session_file.endsWith(".output")) continue
    const exact = sessions.find(
      (session) => session.file_path === row.session_file
    )
    if (exact) return exact
  }
  const previouslyLinked = sessions.find(
    (session) => session.agent_run_key === runKey
  )
  if (previouslyLinked) return previouslyLinked
  const type = firstValue(rows, "agent_type")
  const nativeId = firstValue(rows, "native_id")
  if (!type || !nativeId) return null
  const expected = `${type}#${nativeId.slice(0, 8)}`.toLowerCase()
  const candidates = sessions.filter(
    (session) =>
      session.name?.toLowerCase() === expected &&
      (!root ||
        session.parent_session === root.file_path ||
        session.parent_session === root.session_id)
  )
  return candidates.length === 1 ? candidates[0]! : null
}

interface CanonicalRun {
  runKey: string
  logicalKey: string
  rows: ObservationRow[]
  metadata: ObservationRow
  usageRow: ObservationRow | null
  root: SessionRow | null
  rootId: string | null
  rootFile: string | null
  agentSession: SessionRow | null
  parentRunKey: string | null
  depth: number
  included: boolean
  hasSelectedRequests: boolean
  overlappedSubtree: boolean
}

function selectedRequestPath(run: CanonicalRun): string | null {
  return (
    run.agentSession?.file_path ??
    (run.usageRow?.channel === "output" ||
    run.usageRow?.channel === "legacy-output"
      ? run.usageRow.source_path
      : (run.rows.find(
          (row) => row.channel === "output" || row.channel === "legacy-output"
        )?.source_path ?? null))
  )
}

export function reconcileAgentRuns(db: SqliteDatabase): void {
  const observations = db
    .prepare(
      "SELECT * FROM agent_observations ORDER BY metadata_priority DESC, usage_priority DESC, observation_key"
    )
    .all() as ObservationRow[]
  const sessions = db.prepare("SELECT * FROM sessions").all() as SessionRow[]
  const byPath = new Map(
    sessions.map((session) => [session.file_path, session])
  )
  const byId = new Map<string, SessionRow[]>()
  for (const session of sessions)
    byId.set(session.session_id, [
      ...(byId.get(session.session_id) ?? []),
      session,
    ])

  const scopeFor = (observation: ObservationRow): string => {
    const session = resolveSession(observation, byPath, byId)
    return (
      session?.file_path ??
      observation.root_session_file ??
      observation.root_session_ref ??
      "orphan"
    )
  }
  const copiedEntries = new Map<string, ObservationRow[]>()
  for (const observation of observations) {
    if (!observation.source_entry_id) continue
    const key = stableKey([
      observation.adapter,
      observation.native_run_key,
      observation.source_entry_id,
    ])
    copiedEntries.set(key, [...(copiedEntries.get(key) ?? []), observation])
  }
  const copiedKeys = new Set(
    [...copiedEntries].flatMap(([key, rows]) => (rows.length > 1 ? [key] : []))
  )
  const knownScopes = new Map<string, Set<string>>()
  for (const observation of observations) {
    const scope = scopeFor(observation)
    if (scope === "orphan") continue
    const key = stableKey([observation.adapter, observation.native_run_key])
    knownScopes.set(key, new Set([...(knownScopes.get(key) ?? []), scope]))
  }
  for (const observation of observations) {
    const copyKey = observation.source_entry_id
      ? stableKey([
          observation.adapter,
          observation.native_run_key,
          observation.source_entry_id,
        ])
      : null
    let scope: string | undefined
    if (copyKey && copiedKeys.has(copyKey)) {
      const session = resolveSession(observation, byPath, byId)
      if (session) scope = lineageOrigin(session, byPath).file_path
    }
    scope ??= scopeFor(observation)
    if (scope === "orphan") {
      const candidates = knownScopes.get(
        stableKey([observation.adapter, observation.native_run_key])
      )
      if (candidates?.size === 1) scope = [...candidates][0]!
    }
    observation.logical_key = stableKey([
      observation.adapter,
      scope,
      observation.native_run_key,
    ])
    observation.run_key = canonicalRunKey(observation.logical_key)
  }

  const groups = new Map<string, ObservationRow[]>()
  for (const observation of observations)
    groups.set(observation.logical_key, [
      ...(groups.get(observation.logical_key) ?? []),
      observation,
    ])

  const runs: CanonicalRun[] = []
  for (const [logicalKey, group] of groups) {
    const sorted = [...group].sort(
      (left, right) =>
        right.metadata_priority - left.metadata_priority ||
        precisionRank[right.identity_precision] -
          precisionRank[left.identity_precision] ||
        newestFirst(left, right)
    )
    const rootChoice = bestRootObservation(sorted, byPath, byId)
    const root = rootChoice.session
    const rootScope =
      root?.file_path ??
      rootChoice.observation.root_session_file ??
      rootChoice.observation.root_session_ref ??
      "orphan"
    const metadata = sorted[0]!
    const usageRow =
      [...group]
        .filter((row) => usageOf(row))
        .sort(
          (left, right) =>
            right.usage_priority - left.usage_priority ||
            observationTime(right) - observationTime(left) ||
            precisionRank[right.token_precision] -
              precisionRank[left.token_precision] ||
            left.observation_key.localeCompare(right.observation_key)
        )[0] ?? null
    const runKey = canonicalRunKey(
      stableKey([metadata.adapter, rootScope, metadata.native_run_key])
    )
    runs.push({
      runKey,
      logicalKey,
      rows: sorted,
      metadata,
      usageRow,
      root,
      rootId:
        root?.session_id ?? rootChoice.observation.root_session_ref ?? null,
      rootFile:
        root?.file_path ?? rootChoice.observation.root_session_file ?? null,
      agentSession: findAgentSession(sorted, root, sessions, runKey),
      parentRunKey: null,
      depth: 1,
      included: Boolean(usageRow && usageRow.usage_scope !== "unassigned"),
      hasSelectedRequests: false,
      overlappedSubtree: false,
    })
  }

  const byNative = new Map<string, CanonicalRun[]>()
  for (const run of runs)
    byNative.set(stableKey([run.metadata.adapter, run.metadata.native_id]), [
      ...(byNative.get(
        stableKey([run.metadata.adapter, run.metadata.native_id])
      ) ?? []),
      run,
    ])
  for (const run of runs) {
    const parentNativeId = firstValue(run.rows, "parent_native_id")
    if (!parentNativeId) continue
    const candidates =
      byNative.get(stableKey([run.metadata.adapter, parentNativeId])) ?? []
    const parent = candidates.find(
      (candidate) =>
        candidate.rootId === run.rootId || candidate.rootFile === run.rootFile
    )
    if (parent && parent !== run) run.parentRunKey = parent.runKey
  }
  const hasRequests = db.prepare(
    "SELECT 1 FROM requests WHERE file_path = ? AND usage_scope <> 'unassigned' LIMIT 1"
  )
  for (const run of runs) {
    const sourcePath = selectedRequestPath(run)
    run.hasSelectedRequests = Boolean(sourcePath && hasRequests.get(sourcePath))
  }

  const runsByKey = new Map(runs.map((run) => [run.runKey, run]))
  const depthFor = (run: CanonicalRun, seen = new Set<string>()): number => {
    if (!run.parentRunKey || seen.has(run.runKey)) return 1
    const parent = runsByKey.get(run.parentRunKey)
    if (!parent) return 1
    seen.add(run.runKey)
    return 1 + depthFor(parent, seen)
  }
  for (const run of runs) run.depth = depthFor(run)
  const ancestorsWithIncludedDescendants = new Set<string>()
  for (const descendant of runs) {
    if (!descendant.included && !descendant.hasSelectedRequests) continue
    let parentKey = descendant.parentRunKey
    const seen = new Set<string>()
    while (parentKey && !seen.has(parentKey)) {
      seen.add(parentKey)
      ancestorsWithIncludedDescendants.add(parentKey)
      parentKey = runsByKey.get(parentKey)?.parentRunKey ?? null
    }
  }
  for (const run of runs)
    if (
      run.usageRow?.usage_scope === "subtree" &&
      ancestorsWithIncludedDescendants.has(run.runKey)
    ) {
      run.included = false
      run.overlappedSubtree = true
    }

  const replace = db.transaction(() => {
    const updateObservationKey = db.prepare(
      "UPDATE agent_observations SET logical_key = ?, run_key = ? WHERE observation_key = ?"
    )
    for (const observation of observations)
      updateObservationKey.run(
        observation.logical_key,
        observation.run_key,
        observation.observation_key
      )
    db.prepare("DELETE FROM agent_runs").run()
    db.prepare(
      "UPDATE sessions SET accounting_session_id = session_id, agent_run_key = NULL, session_kind = 'root', linkage_precision = 'unknown'"
    ).run()
    db.prepare(
      "UPDATE requests SET accounting_session_id = session_id, agent_run_key = NULL"
    ).run()
    db.prepare(
      "UPDATE tool_calls SET agent_run_key = NULL, usage_scope = 'self'"
    ).run()
    db.prepare(
      "UPDATE skill_usages SET agent_run_key = NULL, usage_scope = 'self'"
    ).run()
    const insert = db.prepare(`
      INSERT INTO agent_runs (
        run_key, logical_key, adapter, native_id, root_session_id,
        root_session_file, parent_run_key, parent_native_id, workflow_id,
        workflow_step_index, depth, agent_type, display_name, description,
        status_raw, status_canonical, started_at, completed_at, provider,
        model_id, model_label, selected_channel, usage_scope,
        identity_precision, linkage_precision, model_precision,
        token_precision, cost_precision, coverage, included_in_session_total,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        total_tokens, total_cost, request_count, tool_count, turn_count,
        provenance_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `)
    for (const run of runs) {
      const usage = run.usageRow ? usageOf(run.usageRow) : null
      const status = bestStatus(run.rows)
      const coverage = !usage
        ? "unknown"
        : run.overlappedSubtree ||
            usage.totalTokens === null ||
            usage.totalCost === null
          ? "partial"
          : "complete"
      insert.run(
        run.runKey,
        run.logicalKey,
        run.metadata.adapter,
        firstValue(run.rows, "native_id"),
        run.rootId,
        run.rootFile,
        run.parentRunKey,
        firstValue(run.rows, "parent_native_id"),
        firstValue(run.rows, "workflow_id"),
        firstValue(run.rows, "workflow_step_index"),
        run.depth,
        firstValue(run.rows, "agent_type"),
        firstValue(run.rows, "display_name"),
        firstValue(run.rows, "description"),
        status?.status_raw ?? null,
        status?.status_canonical ?? "unknown",
        [...run.rows]
          .filter((row) => row.started_at)
          .sort(
            (left, right) =>
              timestampTime(left.started_at) - timestampTime(right.started_at)
          )[0]?.started_at ?? null,
        [...run.rows]
          .filter((row) => row.completed_at)
          .sort(
            (left, right) =>
              timestampTime(right.completed_at) -
              timestampTime(left.completed_at)
          )[0]?.completed_at ?? null,
        firstValue(run.rows, "provider"),
        firstValue(run.rows, "model_id"),
        firstValue(run.rows, "model_label"),
        run.usageRow?.channel ?? run.metadata.channel,
        usage?.scope ?? null,
        firstValue(run.rows, "identity_precision") ?? "unknown",
        rootChoicePrecision(run),
        firstValue(run.rows, "model_precision") ?? "unknown",
        run.usageRow?.token_precision ?? "unknown",
        run.usageRow?.cost_precision ?? "unknown",
        coverage,
        Number(run.included),
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        usage?.cacheReadTokens ?? null,
        usage?.cacheWriteTokens ?? null,
        usage?.totalTokens ?? null,
        usage?.totalCost ?? null,
        usage?.requestCount ?? null,
        usage?.toolCount ?? null,
        usage?.turnCount ?? null,
        JSON.stringify([...new Set(run.rows.map((row) => row.channel))])
      )

      const sourcePaths = new Set(
        run.rows
          .filter(
            (row) => row.channel === "output" || row.channel === "legacy-output"
          )
          .map((row) => row.source_path)
      )
      if (run.agentSession) sourcePaths.add(run.agentSession.file_path)
      const selectedSourcePath = selectedRequestPath(run)
      for (const sourcePath of sourcePaths) {
        db.prepare(
          `UPDATE requests SET accounting_session_id = ?, agent_run_key = ?,
            usage_scope = CASE WHEN ? = 1
              THEN CASE WHEN usage_scope = 'unassigned' THEN 'unassigned' ELSE 'self' END
              ELSE 'duplicate' END
          WHERE file_path = ?`
        ).run(
          run.rootId ?? run.metadata.root_session_ref,
          run.runKey,
          Number(sourcePath === selectedSourcePath),
          sourcePath
        )
        for (const table of ["tool_calls", "skill_usages"])
          db.prepare(
            `UPDATE ${table} SET agent_run_key = ?, usage_scope = ? WHERE file_path = ?`
          ).run(
            run.runKey,
            sourcePath === selectedSourcePath ? "self" : "duplicate",
            sourcePath
          )
        db.prepare(
          "UPDATE sessions SET accounting_session_id = ?, agent_run_key = ?, session_kind = 'agent', linkage_precision = ?, name = NULL WHERE file_path = ?"
        ).run(
          run.rootId ?? run.metadata.root_session_ref,
          run.runKey,
          run.agentSession ? "reported" : "estimated",
          sourcePath
        )
      }
    }
  })
  replace()
}

function rootChoicePrecision(run: CanonicalRun): AgentPrecision {
  return (
    [...run.rows].sort(
      (left, right) =>
        precisionRank[right.linkage_precision] -
        precisionRank[left.linkage_precision]
    )[0]?.linkage_precision ?? "unknown"
  )
}
