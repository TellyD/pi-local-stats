import type { SqliteDatabase } from "./database.ts"
import type { AgentObservation } from "./agent-adapters/index.ts"
import { canonicalRunKey, stableKey } from "./agent-keys.ts"

export { reconcileAgentRuns } from "./agent-reconciliation.ts"

function observationKeys(observation: AgentObservation): {
  logicalKey: string
  runKey: string
} {
  const root =
    observation.rootSessionFile ?? observation.rootSessionRef ?? "orphan"
  const logicalKey = stableKey([
    observation.adapter,
    root,
    observation.nativeRunKey,
  ])
  return { logicalKey, runKey: canonicalRunKey(logicalKey) }
}

export function replaceAgentObservations(
  db: SqliteDatabase,
  sourcePath: string,
  observations: AgentObservation[]
): void {
  db.prepare("DELETE FROM agent_observations WHERE source_path = ?").run(
    sourcePath
  )
  const insert = db.prepare(`
    INSERT INTO agent_observations (
      observation_key, logical_key, run_key, native_run_key, native_id,
      adapter, channel, source_path, source_entry_id, artifact_version,
      root_session_ref, root_session_file, session_file, parent_native_id,
      workflow_id, workflow_step_index, agent_type, display_name, description,
      status_raw, status_canonical, started_at, completed_at, provider,
      model_id, model_label, usage_scope, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, total_tokens, total_cost,
      request_count, tool_count, turn_count, identity_precision,
      linkage_precision, model_precision, token_precision, cost_precision,
      metadata_priority, usage_priority
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `)
  for (const item of observations) {
    const { logicalKey, runKey } = observationKeys(item)
    insert.run(
      item.observationKey,
      logicalKey,
      runKey,
      item.nativeRunKey,
      item.nativeId,
      item.adapter,
      item.channel,
      item.sourcePath,
      item.sourceEntryId,
      item.artifactVersion,
      item.rootSessionRef,
      item.rootSessionFile,
      item.sessionFile,
      item.parentNativeId,
      item.workflowId,
      item.workflowStepIndex,
      item.agentType,
      item.displayName,
      item.description,
      item.statusRaw,
      item.status,
      item.startedAt,
      item.completedAt,
      item.provider,
      item.modelId,
      item.modelLabel,
      item.usage?.scope ?? null,
      item.usage?.inputTokens ?? null,
      item.usage?.outputTokens ?? null,
      item.usage?.cacheReadTokens ?? null,
      item.usage?.cacheWriteTokens ?? null,
      item.usage?.totalTokens ?? null,
      item.usage?.totalCost ?? null,
      item.usage?.requestCount ?? null,
      item.usage?.toolCount ?? null,
      item.usage?.turnCount ?? null,
      item.precision.identity,
      item.precision.linkage,
      item.precision.model,
      item.precision.tokens,
      item.precision.cost,
      item.metadataPriority,
      item.usagePriority
    )
  }
}

export function deleteAgentObservations(
  db: SqliteDatabase,
  sourcePath: string
): void {
  db.prepare("DELETE FROM agent_observations WHERE source_path = ?").run(
    sourcePath
  )
}
