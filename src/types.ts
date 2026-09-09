export type {
  AgentCoverage,
  AgentPrecision,
  AgentStatus,
  AgentUsageScope,
  SessionAgentSummary,
  SessionPageOptions,
  SessionSortKey,
  SessionSummary,
  SessionTraceResponse,
  SessionTraceSpan,
  SessionTraceSpanKind,
  SessionsResponse,
  SortDirection,
  StatsFilters,
  StatsRange,
  StatsResponse,
  SyncResult,
} from "../server/types.ts"

export interface HideModelResult {
  hidden: boolean
  projects: string[]
  providers: string[]
  models: string[]
}

export interface DeleteModelResult extends Omit<HideModelResult, "hidden"> {
  deleted: boolean
}

export interface ShowModelResult {
  shown: boolean
}
