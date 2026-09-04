import type { AgentAdapter } from "./contracts.ts"
import { nicobailonAdapter } from "./nicobailon.ts"
import { tintinwebAdapter } from "./tintinweb.ts"

export type {
  AdapterInput,
  AgentAdapter,
  AgentCoverage,
  AgentObservation,
  AgentPrecision,
  AgentUsageObservation,
  AgentUsageScope,
  CanonicalAgentStatus,
} from "./contracts.ts"

export const agentAdapters: AgentAdapter[] = [
  nicobailonAdapter,
  tintinwebAdapter,
]

export function defaultAgentArtifactRoots(
  adapters: AgentAdapter[] = agentAdapters
): string[] {
  return [...new Set(adapters.flatMap((adapter) => adapter.defaultRoots()))]
}
