import { isAbsolute } from "node:path"

export type AgentPrecision = "exact" | "reported" | "estimated" | "unknown"
export type AgentUsageScope = "self" | "subtree" | "unassigned"
export type AgentCoverage = "complete" | "partial" | "unknown"
export type CanonicalAgentStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown"

export interface AgentUsageObservation {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  totalTokens: number | null
  totalCost: number | null
  requestCount: number | null
  toolCount: number | null
  turnCount: number | null
  scope: AgentUsageScope
}

export interface AgentObservation {
  observationKey: string
  nativeRunKey: string
  nativeId: string
  adapter: string
  channel: string
  sourcePath: string
  sourceEntryId: string | null
  artifactVersion: string | null
  rootSessionRef: string | null
  rootSessionFile: string | null
  sessionFile: string | null
  parentNativeId: string | null
  workflowId: string | null
  workflowStepIndex: number | null
  agentType: string | null
  displayName: string | null
  description: string | null
  statusRaw: string | null
  status: CanonicalAgentStatus
  startedAt: string | null
  completedAt: string | null
  provider: string | null
  modelId: string | null
  modelLabel: string | null
  usage: AgentUsageObservation | null
  precision: {
    identity: AgentPrecision
    linkage: AgentPrecision
    model: AgentPrecision
    tokens: AgentPrecision
    cost: AgentPrecision
  }
  metadataPriority: number
  usagePriority: number
}

export interface AdapterInput {
  filePath: string
  records: Record<string, unknown>[]
  session: {
    id: string
    cwd: string
    name: string | null
    startedAt: string
    parentSession: string | null
  } | null
}

export interface AdapterResult {
  observations: AgentObservation[]
  claimedToolResultEntryIds?: string[]
}

export interface AgentAdapter {
  readonly id: string
  defaultRoots(): string[]
  acceptsArtifact(path: string): boolean
  retainWhenMissing(path: string): boolean
  inspect(input: AdapterInput): AdapterResult
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 4096 ? trimmed : null
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function compactNumber(value: unknown): number | null {
  const direct = finiteNumber(value)
  if (direct !== null) return direct
  const raw = stringValue(value)
  const match = raw?.match(/^(\d+(?:\.\d+)?)\s*([kmb])?/i)
  if (!match) return null
  const scale =
    { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[
      match[2]?.toLowerCase() as "k" | "m" | "b"
    ] ?? 1
  return Math.round(Number(match[1]) * scale)
}

export function isoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const raw = stringValue(value)
  return raw && !Number.isNaN(Date.parse(raw))
    ? new Date(raw).toISOString()
    : null
}

export function canonicalStatus(value: unknown): CanonicalAgentStatus {
  switch (stringValue(value)?.toLowerCase()) {
    case "queued":
    case "pending":
      return "queued"
    case "running":
    case "background":
      return "running"
    case "paused":
      return "paused"
    case "complete":
    case "completed":
    case "steered":
      return "completed"
    case "failed":
    case "error":
    case "partial":
    case "rejected":
      return "failed"
    case "aborted":
    case "stopped":
    case "cancelled":
    case "canceled":
      return "cancelled"
    default:
      return "unknown"
  }
}

export function modelFields(value: unknown): {
  provider: string | null
  modelId: string | null
  modelLabel: string | null
} {
  const raw = stringValue(value)
  if (!raw) return { provider: null, modelId: null, modelLabel: null }
  const slash = raw.indexOf("/")
  return slash > 0 && slash < raw.length - 1
    ? {
        provider: raw.slice(0, slash),
        modelId: raw.slice(slash + 1),
        modelLabel: null,
      }
    : { provider: null, modelId: null, modelLabel: raw }
}

export function usageFromUnknown(
  value: unknown,
  scope: AgentUsageScope = "self"
): AgentUsageObservation | null {
  const source = record(value)
  if (!source) return null
  const inputTokens = finiteNumber(source.input ?? source.inputTokens)
  const outputTokens = finiteNumber(source.output ?? source.outputTokens)
  const cacheReadTokens = finiteNumber(
    source.cacheRead ?? source.cacheReadTokens
  )
  const cacheWriteTokens = finiteNumber(
    source.cacheWrite ?? source.cacheWriteTokens
  )
  const totalTokens = finiteNumber(source.total ?? source.totalTokens)
  const cost = record(source.cost)
  const totalCost = finiteNumber(
    source.totalCost ?? source.costUsd ?? cost?.total ?? source.cost
  )
  const requestCount = finiteNumber(source.requestCount ?? source.requests)
  const toolCount = finiteNumber(source.toolCount ?? source.toolUses)
  const turnCount = finiteNumber(source.turnCount ?? source.turns)
  return inputTokens !== null ||
    outputTokens !== null ||
    cacheReadTokens !== null ||
    cacheWriteTokens !== null ||
    totalTokens !== null ||
    totalCost !== null ||
    toolCount !== null ||
    turnCount !== null
    ? {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        totalCost,
        requestCount,
        toolCount,
        turnCount,
        scope,
      }
    : null
}

export function rootReference(value: unknown): {
  rootSessionRef: string | null
  rootSessionFile: string | null
} {
  const raw = stringValue(value)
  if (!raw) return { rootSessionRef: null, rootSessionFile: null }
  return isAbsolute(raw) && raw.endsWith(".jsonl")
    ? { rootSessionRef: null, rootSessionFile: raw }
    : { rootSessionRef: raw, rootSessionFile: null }
}

export function stableKey(parts: unknown[]): string {
  return JSON.stringify(parts)
}
