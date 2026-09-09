export type StatsRange = "today" | "7d" | "30d" | "90d" | "all"

export interface StatsFilters {
  range: StatsRange
  project: string
  provider: string
  model: string
}

export interface SyncResult {
  scanned: number
  updated: number
  removed: number
  durationMs: number
}

export type SessionSortKey =
  "name" | "startedAt" | "project" | "models" | "requests" | "tokens" | "cost"
export type SortDirection = "asc" | "desc"

export interface SessionPageOptions {
  page: number
  pageSize: number
  sort: SessionSortKey
  direction: SortDirection
}

export type AgentPrecision = "exact" | "reported" | "estimated" | "unknown"
export type AgentUsageScope = "self" | "subtree" | "unassigned"
export type AgentCoverage = "complete" | "partial" | "unknown"
export type AgentStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown"

export interface SessionAgentSummary {
  id: string
  key: string
  source: string
  name: string
  type: string | null
  displayName: string | null
  description: string
  parentAgentId: string | null
  depth: number
  workflowId: string | null
  status: AgentStatus
  statusRaw: string | null
  provider: string | null
  modelId: string | null
  modelLabel: string | null
  models: string[]
  requests: number | null
  cost: number | null
  tokens: number | null
  precision: {
    linkage: AgentPrecision
    model: AgentPrecision
    tokens: AgentPrecision
    cost: AgentPrecision
  }
  provenance: {
    channels: string[]
    artifactVersion: string | null
  }
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    cacheReadTokens: number | null
    cacheWriteTokens: number | null
    totalTokens: number | null
    totalCost: number | null
    source: string | null
    scope: AgentUsageScope | null
    tokenPrecision: AgentPrecision
    costPrecision: AgentPrecision
    coverage: AgentCoverage
    includedInSessionTotal: boolean
  }
}

export interface SessionSummary {
  id: string
  name: string
  project: string
  label: string
  models: string[]
  startedAt: string
  requests: number
  cost: number
  tokens: number
  agents: SessionAgentSummary[]
  accounting: {
    coverage: AgentCoverage
    unassignedTokens: number | null
    unassignedCost: number | null
  }
}

export interface SessionsResponse {
  rows: SessionSummary[]
  page: number
  pageSize: number
  total: number
}

export type SessionTraceSpanKind = "agent" | "request" | "tool"

export interface SessionTraceSpan {
  id: string
  parentId: string | null
  depth: number
  kind: SessionTraceSpanKind
  label: string
  agentType?: string | null
  startedAt: string | null
  durationMs: number | null
  provider: string | null
  model: string | null
  tokens: number | null
  cost: number | null
  isError: boolean
  status: AgentStatus | null
  includedInSessionTotal: boolean | null
}

export interface SessionTraceResponse {
  session: {
    id: string
    name: string
    project: string
    label: string
    startedAt: string
    durationMs: number
    requests: number
    tokens: number
    cost: number
  }
  bounds: {
    startedAt: string
    endedAt: string
  }
  spans: SessionTraceSpan[]
}

export interface StatsResponse {
  meta: {
    lastSyncAt: string | null
    indexedFiles: number
    indexedSessions: number
  }
  filters: StatsFilters
  options: {
    projects: Array<{ value: string; label: string }>
    providers: string[]
    models: string[]
  }
  overview: {
    requests: number
    errorRate: number
    totalTokens: number
    cacheReadTokens: number
    cacheRate: number
    cost: number
    averageDurationMs: number
  }
  timeseries: Array<{ date: string; requests: number; cost: number }>
  models: Array<{
    model: string
    provider: string
    requests: number
    cost: number
    tokens: number
    errors: number
    cacheRate: number
  }>
  hiddenModels: Array<{ model: string; provider: string }>
  providers: Array<{
    provider: string
    requests: number
    cost: number
    tokens: number
  }>
  projects: Array<{
    project: string
    label: string
    sessions: number
    cost: number
    tokens: number
  }>
  tools: Array<{
    name: string
    calls: number
    errors: number
    errorRate: number
    averageDurationMs: number
  }>
  skills: Array<{
    name: string
    uses: number
    sessions: number
    lastUsed: string
    models: Array<{ model: string; uses: number }>
  }>
}
