import type { SqliteDatabase } from "./database.ts"
import type {
  AgentCoverage,
  AgentPrecision,
  SessionPageOptions,
  SessionSortKey,
  SessionsResponse,
  StatsFilters,
} from "./types.ts"
import { nullableNumber, numeric, projectLabel } from "./stats-values.ts"

export { getSessionTrace } from "./session-trace.ts"

const sessionOrderBy: Record<SessionSortKey, string> = {
  name: "COALESCE(NULLIF(name, ''), id) COLLATE NOCASE",
  startedAt: "started_at",
  project: "project COLLATE NOCASE",
  models: "models COLLATE NOCASE",
  requests: "requests",
  tokens: "tokens",
  cost: "cost",
}

function where(
  filters: StatsFilters,
  timestampColumn = "timestamp"
): { clause: string; values: string[] } {
  const predicates: string[] = []
  const values: string[] = []
  let tomorrow = new Date()
  if (filters.range === "today") {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    tomorrow = new Date(start)
    tomorrow.setDate(tomorrow.getDate() + 1)
    predicates.push(`${timestampColumn} >= ?`)
    values.push(start.toISOString())
  } else {
    if (filters.range !== "all") {
      const days = Number.parseInt(filters.range, 10)
      const start = new Date()
      start.setUTCHours(0, 0, 0, 0)
      start.setUTCDate(start.getUTCDate() - (days - 1))
      predicates.push(`${timestampColumn} >= ?`)
      values.push(start.toISOString())
    }
    tomorrow.setUTCHours(0, 0, 0, 0)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  }
  predicates.push(`${timestampColumn} < ?`)
  values.push(tomorrow.toISOString())
  for (const [key, value] of Object.entries({
    project: filters.project,
    provider: filters.provider,
    model: filters.model,
  }))
    if (value) {
      predicates.push(`${key} = ?`)
      values.push(value)
    }
  return { clause: ` WHERE ${predicates.join(" AND ")}`, values }
}

function parseChannels(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? "[]"))
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function placeholders(values: string[]): string {
  return values.map(() => "?").join(", ")
}

export function getSessions(
  db: SqliteDatabase,
  filters: StatsFilters,
  options: SessionPageOptions
): SessionsResponse {
  const usageWhere = where(filters)
  const runWhere = where(filters)
  const summaryValues = [...usageWhere.values, ...runWhere.values]
  const runSource = `SELECT run.run_key,
      run.root_session_id AS id,
      COALESCE(alias.project, root.cwd, '') AS project,
      COALESCE(run.started_at, root.started_at) AS timestamp,
      COALESCE(run.provider, 'unknown') AS provider,
      COALESCE(run.model_id, 'unknown') AS model,
      EXISTS (
        SELECT 1 FROM hidden_models AS hidden
        WHERE hidden.provider = COALESCE(run.provider, 'unknown')
          AND hidden.model = COALESCE(run.model_id, 'unknown')
      ) AS hidden
    FROM agent_runs AS run
    LEFT JOIN sessions AS root ON root.file_path = run.root_session_file
      OR (run.root_session_file IS NULL AND root.session_id = run.root_session_id)
    LEFT JOIN project_aliases AS alias ON alias.cwd = root.cwd`
  const summaryQuery = `WITH root_info AS (
    SELECT session_id AS id, MAX(name) AS name, MIN(started_at) AS started_at
    FROM sessions WHERE session_kind <> 'agent' GROUP BY session_id
  ), usage_summaries AS (
    SELECT filtered.session_id AS id, filtered.project,
      GROUP_CONCAT(DISTINCT filtered.model ORDER BY filtered.model) AS models,
      MIN(filtered.timestamp) AS started_at,
      COALESCE(SUM(filtered.request_count), 0) AS requests,
      COALESCE(SUM(filtered.cost), 0) AS cost,
      COALESCE(SUM(filtered.total_tokens), 0) AS tokens
    FROM (SELECT * FROM accounted_usage${usageWhere.clause}) AS filtered
    GROUP BY filtered.session_id, filtered.project
  ), agent_roots AS (
    SELECT filtered.id, filtered.project, MIN(filtered.timestamp) AS started_at
    FROM (${runSource}${runWhere.clause}) AS filtered
    WHERE filtered.id IS NOT NULL AND filtered.hidden = 0
      AND NOT EXISTS (
        SELECT 1 FROM requests AS linked
        WHERE linked.agent_run_key = filtered.run_key
          AND linked.usage_scope = 'self'
      )
    GROUP BY filtered.id, filtered.project
  ), session_keys AS (
    SELECT id, project FROM usage_summaries
    UNION SELECT id, project FROM agent_roots
  ), session_summaries AS (
    SELECT keys.id, keys.project, root.name,
      COALESCE(usage.models, '') AS models,
      COALESCE(root.started_at, usage.started_at, agents.started_at) AS started_at,
      COALESCE(usage.requests, 0) AS requests,
      COALESCE(usage.cost, 0) AS cost,
      COALESCE(usage.tokens, 0) AS tokens
    FROM session_keys AS keys
    LEFT JOIN usage_summaries AS usage
      ON usage.id = keys.id AND usage.project = keys.project
    LEFT JOIN agent_roots AS agents
      ON agents.id = keys.id AND agents.project = keys.project
    LEFT JOIN root_info AS root ON root.id = keys.id
  )`
  const total = numeric(
    (
      db
        .prepare(
          `${summaryQuery} SELECT COUNT(*) AS count FROM session_summaries`
        )
        .get(...summaryValues) as { count: number }
    ).count
  )
  const pageCount = Math.max(1, Math.ceil(total / options.pageSize))
  const page = Math.min(options.page, pageCount)
  const direction = options.direction === "asc" ? "ASC" : "DESC"
  const rows: SessionsResponse["rows"] = (
    db
      .prepare(
        `${summaryQuery} SELECT * FROM session_summaries ORDER BY ${sessionOrderBy[options.sort]} ${direction}, id, project LIMIT ? OFFSET ?`
      )
      .all(
        ...summaryValues,
        options.pageSize,
        (page - 1) * options.pageSize
      ) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    project: String(row.project),
    label: projectLabel(String(row.project)),
    name: String(row.name ?? ""),
    models: String(row.models ?? "")
      .split(",")
      .filter((model) => Boolean(model) && model !== "unknown"),
    startedAt: String(row.started_at),
    requests: numeric(row.requests),
    cost: numeric(row.cost),
    tokens: numeric(row.tokens),
    agents: [],
    accounting: {
      coverage: "complete",
      unassignedTokens: null,
      unassignedCost: null,
    },
  }))

  if (!rows.length) return { rows, page, pageSize: options.pageSize, total }

  const parentIds = [...new Set(rows.map((row) => row.id))]
  const ids = placeholders(parentIds)
  const rowsBySession = new Map(
    rows.map((row) => [`${row.id}\0${row.project}`, row])
  )
  const filteredRequestRows = db
    .prepare(
      `SELECT agent_run_key, project,
        GROUP_CONCAT(DISTINCT provider ORDER BY provider) AS providers,
        GROUP_CONCAT(DISTINCT model ORDER BY model) AS models,
        COUNT(*) AS requests, SUM(total_tokens) AS tokens, SUM(cost) AS cost,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens
      FROM (SELECT * FROM unique_requests${usageWhere.clause})
      WHERE usage_scope = 'self' AND agent_run_key IS NOT NULL
        AND accounting_session_id IN (${ids})
      GROUP BY agent_run_key, project`
    )
    .all(...usageWhere.values, ...parentIds) as Array<Record<string, unknown>>
  const filteredRequests = new Map(
    filteredRequestRows.map((row) => [String(row.agent_run_key), row])
  )
  const globallyLinked = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT agent_run_key FROM requests
          WHERE usage_scope = 'self' AND agent_run_key IS NOT NULL
            AND accounting_session_id IN (${ids})`
        )
        .pluck()
        .all(...parentIds) as string[]
    ).map(String)
  )
  const filteredRunKeys = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT run_key FROM (${runSource}${runWhere.clause})
          WHERE hidden = 0 AND id IN (${ids})`
        )
        .pluck()
        .all(...runWhere.values, ...parentIds) as string[]
    ).map(String)
  )
  const runRows = db
    .prepare(
      `SELECT run.*,
        COALESCE(alias.project, root.cwd, '') AS project,
        (SELECT MAX(artifact_version) FROM agent_observations AS observation
          WHERE observation.logical_key = run.logical_key) AS artifact_version
      FROM agent_runs AS run
      LEFT JOIN sessions AS root ON root.file_path = run.root_session_file
        OR (run.root_session_file IS NULL AND root.session_id = run.root_session_id)
      LEFT JOIN project_aliases AS alias ON alias.cwd = root.cwd
      WHERE run.root_session_id IN (${ids})
      GROUP BY run.run_key
      ORDER BY run.depth, run.started_at, run.run_key`
    )
    .all(...parentIds) as Array<Record<string, unknown>>

  for (const run of runRows) {
    const runKey = String(run.run_key)
    const exact = filteredRequests.get(runKey)
    if (globallyLinked.has(runKey) ? !exact : !filteredRunKeys.has(runKey))
      continue
    const session = rowsBySession.get(
      `${String(run.root_session_id)}\0${String(exact?.project ?? run.project)}`
    )
    if (!session) continue
    const exactModels = exact
      ? String(exact.models ?? "")
          .split(",")
          .filter((model) => Boolean(model) && model !== "unknown")
      : []
    const exactProviders = exact
      ? String(exact.providers ?? "")
          .split(",")
          .filter((provider) => Boolean(provider) && provider !== "unknown")
      : []
    const models = exactModels.length
      ? exactModels
      : run.model_id
        ? [String(run.model_id)]
        : []
    const requests = exact
      ? numeric(exact.requests)
      : nullableNumber(run.request_count)
    const tokens = exact
      ? numeric(exact.tokens)
      : nullableNumber(run.total_tokens)
    const cost = exact ? numeric(exact.cost) : nullableNumber(run.total_cost)
    const tokenPrecision = (
      exact ? "exact" : run.token_precision
    ) as AgentPrecision
    const costPrecision = (
      exact ? "exact" : run.cost_precision
    ) as AgentPrecision
    const exactComponents = exact
      ? [
          exact.input_tokens,
          exact.output_tokens,
          exact.cache_read_tokens,
          exact.cache_write_tokens,
        ]
      : []
    const coverage = exact
      ? exactComponents.every((value) => value !== null && value !== undefined)
        ? "complete"
        : "partial"
      : (String(run.coverage) as AgentCoverage)
    session.agents.push({
      id: String(run.native_id),
      key: runKey,
      source: String(run.adapter),
      name: String(run.display_name ?? run.agent_type ?? ""),
      type: run.agent_type == null ? null : String(run.agent_type),
      displayName: run.display_name == null ? null : String(run.display_name),
      description: String(run.description ?? ""),
      parentAgentId:
        run.parent_run_key == null ? null : String(run.parent_run_key),
      depth: numeric(run.depth),
      workflowId: run.workflow_id == null ? null : String(run.workflow_id),
      status:
        run.status_canonical as SessionsResponse["rows"][number]["agents"][number]["status"],
      statusRaw: run.status_raw == null ? null : String(run.status_raw),
      provider:
        exactProviders.length === 1
          ? exactProviders[0]!
          : run.provider == null
            ? null
            : String(run.provider),
      modelId:
        exactModels.length === 1
          ? exactModels[0]!
          : run.model_id == null
            ? null
            : String(run.model_id),
      modelLabel: run.model_label == null ? null : String(run.model_label),
      models,
      requests,
      tokens,
      cost,
      precision: {
        linkage: run.linkage_precision as AgentPrecision,
        model:
          exactModels.length > 0
            ? "exact"
            : (run.model_precision as AgentPrecision),
        tokens: tokenPrecision,
        cost: costPrecision,
      },
      provenance: {
        channels: parseChannels(run.provenance_json),
        artifactVersion:
          run.artifact_version == null ? null : String(run.artifact_version),
      },
      usage: {
        inputTokens: exact
          ? nullableNumber(exact.input_tokens)
          : nullableNumber(run.input_tokens),
        outputTokens: exact
          ? nullableNumber(exact.output_tokens)
          : nullableNumber(run.output_tokens),
        cacheReadTokens: exact
          ? nullableNumber(exact.cache_read_tokens)
          : nullableNumber(run.cache_read_tokens),
        cacheWriteTokens: exact
          ? nullableNumber(exact.cache_write_tokens)
          : nullableNumber(run.cache_write_tokens),
        totalTokens: tokens,
        totalCost: cost,
        source: exact ? "pi-session" : String(run.selected_channel ?? ""),
        scope:
          run.usage_scope == null
            ? null
            : (String(
                run.usage_scope
              ) as SessionsResponse["rows"][number]["agents"][number]["usage"]["scope"]),
        tokenPrecision,
        costPrecision,
        coverage,
        includedInSessionTotal: Boolean(run.included_in_session_total),
      },
    })
  }

  const unassignedRows = db
    .prepare(
      `SELECT accounting_session_id AS id, project,
        SUM(total_tokens) AS tokens, SUM(cost) AS cost
      FROM (SELECT * FROM unique_requests${usageWhere.clause})
      WHERE usage_scope = 'unassigned'
        AND accounting_session_id IN (${ids})
      GROUP BY accounting_session_id, project`
    )
    .all(...usageWhere.values, ...parentIds) as Array<Record<string, unknown>>
  for (const unassigned of unassignedRows) {
    const session = rowsBySession.get(
      `${String(unassigned.id)}\0${String(unassigned.project)}`
    )
    if (!session) continue
    session.accounting.unassignedTokens = nullableNumber(unassigned.tokens)
    session.accounting.unassignedCost = nullableNumber(unassigned.cost)
    session.accounting.coverage = "partial"
  }
  for (const row of rows) {
    if (
      row.accounting.coverage === "complete" &&
      row.agents.some((agent) => agent.usage.coverage !== "complete")
    )
      row.accounting.coverage = row.agents.every(
        (agent) => agent.usage.coverage === "unknown"
      )
        ? "unknown"
        : "partial"
  }

  return { rows, page, pageSize: options.pageSize, total }
}
