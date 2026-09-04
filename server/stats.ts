import type { SqliteDatabase } from "./database.ts"
export { getSessions } from "./session-stats.ts"
import type {
  SessionPageOptions,
  SessionSortKey,
  StatsFilters,
  StatsRange,
  StatsResponse,
} from "./types.ts"

const ranges: StatsRange[] = ["today", "7d", "30d", "90d", "all"]
const sessionSortKeys: SessionSortKey[] = [
  "name",
  "startedAt",
  "project",
  "models",
  "requests",
  "tokens",
  "cost",
]
const numeric = (value: unknown): number =>
  typeof value === "number" ? value : Number(value ?? 0)
const projectLabel = (project: string): string =>
  project.split(/[/\\]/).filter(Boolean).at(-1) || project
const ratio = (numerator: number, denominator: number): number =>
  denominator ? numerator / denominator : 0

type TimeseriesPoint = StatsResponse["timeseries"][number]

function fillTimeseries(
  points: TimeseriesPoint[],
  range: StatsRange
): TimeseriesPoint[] {
  if (points.length === 0 && range === "all") return []
  if (range === "today") {
    const now = new Date()
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    return [
      points.reduce<TimeseriesPoint>(
        (total, point) => ({
          date,
          requests: total.requests + point.requests,
          cost: total.cost + point.cost,
        }),
        { date, requests: 0, cost: 0 }
      ),
    ]
  }
  const byDate = new Map(points.map((point) => [point.date, point]))
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const start =
    range === "all"
      ? new Date(
          `${points[0]?.date ?? today.toISOString().slice(0, 10)}T00:00:00.000Z`
        )
      : new Date(
          today.getTime() - (Number.parseInt(range, 10) - 1) * 86_400_000
        )
  const filled: TimeseriesPoint[] = []

  for (
    let day = start;
    day <= today;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    const date = day.toISOString().slice(0, 10)
    filled.push(byDate.get(date) ?? { date, requests: 0, cost: 0 })
  }
  return filled
}

export function parseFilters(search: URLSearchParams): StatsFilters {
  const requestedRange = search.get("range") ?? "30d"
  return {
    range: ranges.includes(requestedRange as StatsRange)
      ? (requestedRange as StatsRange)
      : "30d",
    project: search.get("project") ?? "",
    provider: search.get("provider") ?? "",
    model: search.get("model") ?? "",
  }
}

export function parseSessionPageOptions(
  search: URLSearchParams
): SessionPageOptions | null {
  const page = search.has("page") ? Number(search.get("page")) : 1
  const pageSize = search.has("pageSize") ? Number(search.get("pageSize")) : 10
  const sort = search.get("sort") ?? "startedAt"
  const direction = search.get("direction") ?? "desc"

  return Number.isSafeInteger(page) &&
    page >= 1 &&
    Number.isSafeInteger(pageSize) &&
    pageSize >= 1 &&
    pageSize <= 100 &&
    sessionSortKeys.includes(sort as SessionSortKey) &&
    (direction === "asc" || direction === "desc")
    ? {
        page,
        pageSize,
        sort: sort as SessionSortKey,
        direction,
      }
    : null
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
  })) {
    if (value) {
      predicates.push(`${key} = ?`)
      values.push(value)
    }
  }
  return { clause: ` WHERE ${predicates.join(" AND ")}`, values }
}

interface AggregateRow {
  requests: number
  errors: number
  total_tokens: number
  input_tokens: number
  cache_read_tokens: number
  cost: number
  average_duration: number
}

export function getStats(
  db: SqliteDatabase,
  filters: StatsFilters,
  lastSyncAt: string | null
): StatsResponse {
  const requestWhere = where(filters)
  const toolsFilter = where(filters, "started_at")
  const skillsFilter = where(filters, "used_at")
  const aggregate = db
    .prepare(
      `SELECT COALESCE(SUM(request_count), 0) AS requests, COALESCE(SUM(is_error), 0) AS errors, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(CASE WHEN request_count > 0 THEN duration_ms ELSE 0 END) * 1.0 / NULLIF(SUM(CASE WHEN request_count > 0 THEN request_count ELSE 0 END), 0), 0) AS average_duration FROM accounted_usage${requestWhere.clause}`
    )
    .get(...requestWhere.values) as AggregateRow
  const indexedFiles = numeric(
    (
      db.prepare("SELECT COUNT(*) AS count FROM indexed_files").get() as {
        count: number
      }
    ).count
  )
  const indexedSessions = numeric(
    (
      db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as {
        count: number
      }
    ).count
  )
  const lastIndexed = db
    .prepare("SELECT MAX(indexed_at) AS value FROM indexed_files")
    .get() as { value: string | null }
  const allProjects = db
    .prepare(
      "SELECT DISTINCT project FROM accounted_usage WHERE project <> '' ORDER BY project"
    )
    .all() as Array<{ project: string }>
  const providers = db
    .prepare(
      "SELECT DISTINCT provider FROM accounted_usage WHERE provider <> 'unknown' ORDER BY provider"
    )
    .all() as Array<{ provider: string }>
  const models = db
    .prepare(
      "SELECT DISTINCT model FROM accounted_usage WHERE model <> 'unknown' ORDER BY model"
    )
    .all() as Array<{ model: string }>

  const timeseries = fillTimeseries(
    (
      db
        .prepare(
          `SELECT substr(timestamp, 1, 10) AS date, COALESCE(SUM(request_count), 0) AS requests, COALESCE(SUM(cost), 0) AS cost FROM accounted_usage${requestWhere.clause} GROUP BY date ORDER BY date`
        )
        .all(...requestWhere.values) as Array<Record<string, unknown>>
    ).map((row) => ({
      date: String(row.date),
      requests: numeric(row.requests),
      cost: numeric(row.cost),
    })),
    filters.range
  )
  const hiddenModels = db
    .prepare(
      "SELECT model, provider FROM hidden_models ORDER BY model, provider"
    )
    .all() as Array<{ model: string; provider: string }>
  const modelsSummary = (
    db
      .prepare(
        `SELECT model, provider, COALESCE(SUM(request_count), 0) AS requests, COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(is_error), 0) AS errors, COALESCE(SUM(cache_read_tokens), 0) AS cache_read, COALESCE(SUM(input_tokens), 0) AS input FROM (SELECT * FROM accounted_usage${requestWhere.clause}) AS filtered WHERE model <> 'unknown' AND provider <> 'unknown' GROUP BY model, provider ORDER BY cost DESC, requests DESC`
      )
      .all(...requestWhere.values) as Array<Record<string, unknown>>
  ).map((row) => ({
    model: String(row.model),
    provider: String(row.provider),
    requests: numeric(row.requests),
    cost: numeric(row.cost),
    tokens: numeric(row.tokens),
    errors: numeric(row.errors),
    cacheRate: ratio(
      numeric(row.cache_read),
      numeric(row.input) + numeric(row.cache_read)
    ),
  }))
  const providerSummary = (
    db
      .prepare(
        `SELECT provider, COALESCE(SUM(request_count), 0) AS requests, COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens FROM (SELECT * FROM accounted_usage${requestWhere.clause}) AS filtered WHERE provider <> 'unknown' GROUP BY provider ORDER BY cost DESC, requests DESC`
      )
      .all(...requestWhere.values) as Array<Record<string, unknown>>
  ).map((row) => ({
    provider: String(row.provider),
    requests: numeric(row.requests),
    cost: numeric(row.cost),
    tokens: numeric(row.tokens),
  }))
  const projects = (
    db
      .prepare(
        `SELECT project, COUNT(DISTINCT session_id) AS sessions, COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens FROM accounted_usage${requestWhere.clause} GROUP BY project ORDER BY cost DESC`
      )
      .all(...requestWhere.values) as Array<Record<string, unknown>>
  ).map((row) => ({
    project: String(row.project),
    label: projectLabel(String(row.project)),
    sessions: numeric(row.sessions),
    cost: numeric(row.cost),
    tokens: numeric(row.tokens),
  }))
  const tools = (
    db
      .prepare(
        `SELECT name, COUNT(*) AS calls, COALESCE(SUM(is_error), 0) AS errors, COALESCE(AVG(duration_ms), 0) AS duration FROM unique_tool_calls${toolsFilter.clause} GROUP BY name ORDER BY calls DESC`
      )
      .all(...toolsFilter.values) as Array<Record<string, unknown>>
  ).map((row) => ({
    name: String(row.name),
    calls: numeric(row.calls),
    errors: numeric(row.errors),
    errorRate: ratio(numeric(row.errors), numeric(row.calls)),
    averageDurationMs: numeric(row.duration),
  }))
  const skillRows = db
    .prepare(
      `SELECT skill, session_id, model, used_at FROM unique_skill_usages${skillsFilter.clause} ORDER BY used_at DESC`
    )
    .all(...skillsFilter.values) as Array<{
    skill: string
    session_id: string
    model: string
    used_at: string
  }>
  const uniqueSkillSessions = new Map<string, (typeof skillRows)[number]>()
  for (const row of skillRows) {
    const key = `${row.session_id}:${row.skill}`
    if (!uniqueSkillSessions.has(key)) uniqueSkillSessions.set(key, row)
  }
  const skillsByName = new Map<
    string,
    {
      name: string
      uses: number
      sessions: Set<string>
      lastUsed: string
      models: Map<string, number>
    }
  >()
  for (const row of uniqueSkillSessions.values()) {
    const aggregate = skillsByName.get(row.skill) ?? {
      name: row.skill,
      uses: 0,
      sessions: new Set<string>(),
      lastUsed: row.used_at,
      models: new Map<string, number>(),
    }
    aggregate.uses += 1
    aggregate.sessions.add(row.session_id)
    if (row.used_at > aggregate.lastUsed) aggregate.lastUsed = row.used_at
    aggregate.models.set(row.model, (aggregate.models.get(row.model) ?? 0) + 1)
    skillsByName.set(row.skill, aggregate)
  }
  const skills = [...skillsByName.values()]
    .map((skill) => ({
      name: skill.name,
      uses: skill.uses,
      sessions: skill.sessions.size,
      lastUsed: skill.lastUsed,
      models: [...skill.models]
        .map(([model, uses]) => ({ model, uses }))
        .sort((left, right) => right.uses - left.uses),
    }))
    .sort(
      (left, right) =>
        right.uses - left.uses || left.name.localeCompare(right.name)
    )
  const inputTokens = numeric(aggregate.input_tokens)
  const cacheReadTokens = numeric(aggregate.cache_read_tokens)
  const requestsCount = numeric(aggregate.requests)
  const errorsCount = numeric(aggregate.errors)
  return {
    meta: {
      lastSyncAt: lastSyncAt ?? lastIndexed.value,
      indexedFiles,
      indexedSessions,
    },
    filters,
    options: {
      projects: allProjects.map(({ project }) => ({
        value: project,
        label: projectLabel(project),
      })),
      providers: providers.map(({ provider }) => provider),
      models: models.map(({ model }) => model),
    },
    overview: {
      requests: requestsCount,
      errorRate: ratio(errorsCount, requestsCount),
      totalTokens: numeric(aggregate.total_tokens),
      cacheReadTokens,
      cacheRate: ratio(cacheReadTokens, inputTokens + cacheReadTokens),
      cost: numeric(aggregate.cost),
      averageDurationMs: numeric(aggregate.average_duration),
    },
    timeseries,
    models: modelsSummary,
    hiddenModels,
    providers: providerSummary,
    projects,
    tools,
    skills,
  }
}
