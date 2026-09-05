import type { SqliteDatabase } from "./database.ts"
import type { SessionTraceResponse, SessionTraceSpan } from "./types.ts"
import { nullableNumber, numeric, projectLabel } from "./stats-values.ts"

function timestamp(value: unknown): number | null {
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : null
}

function traceSpanOrder(left: SessionTraceSpan, right: SessionTraceSpan) {
  const leftTime = timestamp(left.startedAt) ?? Number.POSITIVE_INFINITY
  const rightTime = timestamp(right.startedAt) ?? Number.POSITIVE_INFINITY
  if (leftTime !== rightTime) return leftTime - rightTime
  const kindOrder = { agent: 0, request: 1, tool: 2 }
  return (
    kindOrder[left.kind] - kindOrder[right.kind] ||
    left.label.localeCompare(right.label)
  )
}

export function getSessionTrace(
  db: SqliteDatabase,
  sessionId: string,
  project: string
): SessionTraceResponse | null {
  const rootRows = db
    .prepare(
      `SELECT session.name, session.started_at,
        COALESCE(alias.project, session.cwd, '') AS project
      FROM sessions AS session
      LEFT JOIN project_aliases AS alias ON alias.cwd = session.cwd
      WHERE session.session_id = ? AND session.session_kind <> 'agent'
      ORDER BY session.started_at, session.file_path`
    )
    .all(sessionId) as Array<Record<string, unknown>>
  const requestRows = db
    .prepare(
      `SELECT id, source_key, agent_run_key, timestamp, duration_ms,
        provider, model, total_tokens, cost, is_error, usage_scope
      FROM unique_requests
      WHERE accounting_session_id = ? AND project = ?
        AND usage_scope IN ('self', 'unassigned')
      ORDER BY timestamp, id, source_key`
    )
    .all(sessionId, project) as Array<Record<string, unknown>>
  const toolRows = db
    .prepare(
      `SELECT tool.id, tool.source_key, tool.agent_run_key, tool.name,
        tool.provider, tool.model, tool.started_at, tool.duration_ms,
        tool.is_error
      FROM unique_tool_calls AS tool
      JOIN sessions AS owner ON owner.file_path = tool.file_path
      WHERE owner.accounting_session_id = ? AND tool.project = ?
      ORDER BY tool.started_at, tool.id, tool.source_key`
    )
    .all(sessionId, project) as Array<Record<string, unknown>>
  const indexedRequestRows = db
    .prepare(
      `SELECT COALESCE(alias.project, candidate.cwd) AS project
      FROM requests AS candidate
      LEFT JOIN project_aliases AS alias ON alias.cwd = candidate.cwd
      WHERE candidate.accounting_session_id = ?
        AND candidate.usage_scope = 'self'
        AND candidate.rowid = (
          SELECT original.rowid FROM requests AS original
          JOIN sessions AS owner ON owner.file_path = original.file_path
          WHERE original.request_key = candidate.request_key
          ORDER BY CASE original.source_channel
              WHEN 'pi-session' THEN 0 WHEN 'external-artifact' THEN 1 ELSE 2 END,
            owner.parent_session IS NOT NULL, owner.started_at,
            original.file_path, original.rowid
          LIMIT 1
        )`
    )
    .all(sessionId) as Array<Record<string, unknown>>
  const globallyLinked = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT agent_run_key FROM requests
          WHERE accounting_session_id = ? AND usage_scope = 'self'
            AND agent_run_key IS NOT NULL`
        )
        .pluck()
        .all(sessionId) as string[]
    ).map(String)
  )
  const visibleLinkedRuns = new Set(
    requestRows
      .filter((row) => row.usage_scope === "self" && row.agent_run_key != null)
      .map((row) => String(row.agent_run_key))
  )
  const allAgentRows = db
    .prepare(
      `SELECT run.*,
        COALESCE(alias.project, root.cwd, '') AS root_project,
        EXISTS (
          SELECT 1 FROM hidden_models AS hidden
          WHERE hidden.provider = COALESCE(run.provider, 'unknown')
            AND hidden.model = COALESCE(run.model_id, 'unknown')
        ) AS hidden
      FROM agent_runs AS run
      LEFT JOIN sessions AS root ON root.file_path = run.root_session_file
        OR (run.root_session_file IS NULL
          AND root.session_id = run.root_session_id
          AND root.session_kind <> 'agent')
      LEFT JOIN project_aliases AS alias ON alias.cwd = root.cwd
      WHERE run.root_session_id = ?
      GROUP BY run.run_key
      ORDER BY run.started_at, run.run_key`
    )
    .all(sessionId) as Array<Record<string, unknown>>
  const agentRows = allAgentRows.filter((row) => {
    const runKey = String(row.run_key)
    if (globallyLinked.has(runKey)) return visibleLinkedRuns.has(runKey)
    return numeric(row.hidden) === 0 && String(row.root_project) === project
  })
  const pairExists =
    rootRows.some((row) => String(row.project) === project) ||
    indexedRequestRows.some((row) => String(row.project) === project) ||
    allAgentRows.some(
      (row) =>
        !globallyLinked.has(String(row.run_key)) &&
        String(row.root_project) === project
    )
  if (!pairExists) return null

  const spans: SessionTraceSpan[] = []
  for (const row of agentRows) {
    const runKey = String(row.run_key)
    const startedMs = timestamp(row.started_at)
    const completedMs = timestamp(row.completed_at)
    const durationMs =
      startedMs !== null && completedMs !== null && completedMs >= startedMs
        ? completedMs - startedMs
        : null
    const included =
      Boolean(row.included_in_session_total) && !globallyLinked.has(runKey)
    spans.push({
      id: `agent:${runKey}`,
      parentId:
        row.parent_run_key == null
          ? null
          : `agent:${String(row.parent_run_key)}`,
      depth: 0,
      kind: "agent",
      label: String(
        row.display_name ?? row.agent_type ?? row.native_id ?? "Agent"
      ),
      startedAt: startedMs === null ? null : new Date(startedMs).toISOString(),
      durationMs,
      provider: row.provider == null ? null : String(row.provider),
      model: row.model_id == null ? null : String(row.model_id),
      tokens: included ? nullableNumber(row.total_tokens) : null,
      cost: included ? nullableNumber(row.total_cost) : null,
      isError: String(row.status_canonical) === "failed",
      status: row.status_canonical as SessionTraceSpan["status"],
      includedInSessionTotal: included,
    })
  }
  for (const row of requestRows) {
    const endedMs = timestamp(row.timestamp)
    const durationMs = Math.max(0, numeric(row.duration_ms))
    const startedMs = endedMs === null ? null : endedMs - durationMs
    spans.push({
      id: `request:${String(row.id)}:${String(row.source_key)}`,
      parentId:
        row.agent_run_key == null ? null : `agent:${String(row.agent_run_key)}`,
      depth: 0,
      kind: "request",
      label: String(row.model || row.provider || "Request"),
      startedAt: startedMs === null ? null : new Date(startedMs).toISOString(),
      durationMs: startedMs === null ? null : durationMs,
      provider: String(row.provider),
      model: String(row.model),
      tokens: numeric(row.total_tokens),
      cost: numeric(row.cost),
      isError: Boolean(row.is_error),
      status: null,
      includedInSessionTotal: String(row.usage_scope) === "self",
    })
  }
  for (const row of toolRows) {
    const startedMs = timestamp(row.started_at)
    spans.push({
      id: `tool:${String(row.id)}:${String(row.source_key)}`,
      parentId:
        row.agent_run_key == null ? null : `agent:${String(row.agent_run_key)}`,
      depth: 0,
      kind: "tool",
      label: String(row.name),
      startedAt: startedMs === null ? null : new Date(startedMs).toISOString(),
      durationMs:
        startedMs === null ? null : Math.max(0, numeric(row.duration_ms)),
      provider: String(row.provider),
      model: String(row.model),
      tokens: null,
      cost: null,
      isError: Boolean(row.is_error),
      status: null,
      includedInSessionTotal: null,
    })
  }

  const agentIds = new Set(
    spans.filter((span) => span.kind === "agent").map((span) => span.id)
  )
  const children = new Map<string | null, SessionTraceSpan[]>()
  for (const span of spans) {
    const parentId =
      span.parentId && agentIds.has(span.parentId) ? span.parentId : null
    span.parentId = parentId
    const siblings = children.get(parentId) ?? []
    siblings.push(span)
    children.set(parentId, siblings)
  }
  for (const siblings of children.values()) siblings.sort(traceSpanOrder)
  const ordered: SessionTraceSpan[] = []
  const visited = new Set<string>()
  const visit = (span: SessionTraceSpan, depth: number) => {
    if (visited.has(span.id)) return
    visited.add(span.id)
    span.depth = depth
    ordered.push(span)
    for (const child of children.get(span.id) ?? []) visit(child, depth + 1)
  }
  for (const span of children.get(null) ?? []) visit(span, 0)
  for (const span of spans)
    if (!visited.has(span.id)) {
      span.parentId = null
      visit(span, 0)
    }

  const rootTimes = rootRows
    .map((row) => timestamp(row.started_at))
    .filter((value): value is number => value !== null)
  const spanStarts = spans
    .map((span) => timestamp(span.startedAt))
    .filter((value): value is number => value !== null)
  const fallbackStart = Math.min(...spanStarts)
  const startedMs = Math.min(...rootTimes, fallbackStart)
  if (!Number.isFinite(startedMs)) return null
  const endedMs = Math.max(
    startedMs,
    ...agentRows.flatMap((row) => {
      const completed = timestamp(row.completed_at)
      return completed === null ? [] : [completed]
    }),
    ...spans.flatMap((span) => {
      const start = timestamp(span.startedAt)
      return start === null ? [] : [start + (span.durationMs ?? 0)]
    })
  )
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(request_count), 0) AS requests,
        COALESCE(SUM(total_tokens), 0) AS tokens,
        COALESCE(SUM(cost), 0) AS cost
      FROM accounted_usage WHERE session_id = ? AND project = ?`
    )
    .get(sessionId, project) as Record<string, unknown>
  const rootName = rootRows.find((row) => String(row.name ?? "").trim())?.name

  return {
    session: {
      id: sessionId,
      name: String(rootName ?? ""),
      project,
      label: projectLabel(project),
      startedAt: new Date(startedMs).toISOString(),
      durationMs: endedMs - startedMs,
      requests: numeric(totals.requests),
      tokens: numeric(totals.tokens),
      cost: numeric(totals.cost),
    },
    bounds: {
      startedAt: new Date(startedMs).toISOString(),
      endedAt: new Date(endedMs).toISOString(),
    },
    spans: ordered,
  }
}
