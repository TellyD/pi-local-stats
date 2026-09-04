export type {
  AgentCoverage,
  AgentPrecision,
  AgentStatus,
  AgentUsageScope,
  SessionAgentSummary,
  SessionPageOptions,
  SessionSortKey,
  SessionSummary,
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

export interface ShowModelResult {
  shown: boolean
}
