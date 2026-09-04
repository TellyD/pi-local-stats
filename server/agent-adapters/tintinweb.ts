import { tmpdir } from "node:os"
import { resolve, sep } from "node:path"
import type {
  AdapterInput,
  AdapterResult,
  AgentAdapter,
  AgentObservation,
  AgentUsageObservation,
} from "./contracts.ts"
import {
  canonicalStatus,
  compactNumber,
  finiteNumber,
  isoTimestamp,
  modelFields,
  record,
  stableKey,
  stringValue,
  usageFromUnknown,
} from "./contracts.ts"

const TOOL_NAMES = new Set(["Agent", "get_subagent_result", "steer_subagent"])

function message(
  entry: Record<string, unknown>
): Record<string, unknown> | null {
  return record(entry.message)
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value
    .map((part) => record(part))
    .map((part) => stringValue(part?.text) ?? "")
    .join("\n")
    .slice(0, 8192)
}

function transcriptRoot(filePath: string): string | null {
  const parts = resolve(filePath).split(sep)
  return parts.at(-2) === "tasks" ? (parts.at(-3) ?? null) : null
}

function rootFields(input: AdapterInput): {
  rootSessionRef: string | null
  rootSessionFile: string | null
} {
  return input.filePath.endsWith(".output")
    ? { rootSessionRef: transcriptRoot(input.filePath), rootSessionFile: null }
    : {
        rootSessionRef: input.session?.id ?? null,
        rootSessionFile: input.session ? input.filePath : null,
      }
}

function addUsage(
  total: AgentUsageObservation | null,
  value: AgentUsageObservation | null
): AgentUsageObservation | null {
  if (!value) return total
  const sum = (left: number | null, right: number | null): number | null =>
    left === null && right === null ? null : (left ?? 0) + (right ?? 0)
  return {
    inputTokens: sum(total?.inputTokens ?? null, value.inputTokens),
    outputTokens: sum(total?.outputTokens ?? null, value.outputTokens),
    cacheReadTokens: sum(total?.cacheReadTokens ?? null, value.cacheReadTokens),
    cacheWriteTokens: sum(
      total?.cacheWriteTokens ?? null,
      value.cacheWriteTokens
    ),
    totalTokens: sum(total?.totalTokens ?? null, value.totalTokens),
    totalCost: sum(total?.totalCost ?? null, value.totalCost),
    requestCount: sum(total?.requestCount ?? null, 1),
    toolCount: total?.toolCount ?? null,
    turnCount: sum(total?.turnCount ?? null, 1),
    scope: "self",
  }
}

interface ToolCallRecord {
  entryId: string
  callId: string
  name: string
  args: Record<string, unknown>
}

function callRecords(records: Record<string, unknown>[]): ToolCallRecord[] {
  const calls: ToolCallRecord[] = []
  for (const entry of records) {
    const item = message(entry)
    if (
      stringValue(item?.role) !== "assistant" ||
      !Array.isArray(item?.content)
    )
      continue
    for (const value of item.content) {
      const call = record(value)
      const callId = stringValue(call?.id)
      if (call?.type !== "toolCall" || !callId) continue
      calls.push({
        entryId: stringValue(entry.id) ?? "",
        callId,
        name: stringValue(call.name) ?? "",
        args: record(call.arguments) ?? {},
      })
    }
  }
  return calls
}

function isAncestor(
  ancestorId: string,
  entry: Record<string, unknown>,
  byId: Map<string, Record<string, unknown>>
): boolean {
  let parentId = stringValue(entry.parentId)
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    if (parentId === ancestorId) return true
    seen.add(parentId)
    parentId = stringValue(byId.get(parentId)?.parentId)
  }
  return false
}

function matchingCall(
  entry: Record<string, unknown>,
  callId: string,
  calls: ToolCallRecord[],
  byId: Map<string, Record<string, unknown>>
): ToolCallRecord | null {
  const candidates = calls.filter((call) => call.callId === callId)
  return (
    candidates.find(
      (call) => call.entryId && isAncestor(call.entryId, entry, byId)
    ) ?? (candidates.length === 1 ? candidates[0]! : null)
  )
}

function detailObservation(
  input: AdapterInput,
  entry: Record<string, unknown>,
  details: Record<string, unknown>,
  call: ToolCallRecord | null,
  parentNativeId: string | null
): AgentObservation | null {
  const legacyId = contentText(message(entry)?.content).match(
    /Agent ID:\s*([^\s]+)/
  )?.[1]
  const nativeId = stringValue(details.agentId) ?? legacyId ?? null
  if (!nativeId) return null
  const agentType =
    stringValue(details.subagentType) ?? stringValue(call?.args.subagent_type)
  const displayName = stringValue(details.displayName) ?? agentType
  const model = modelFields(details.modelId)
  const modelLabel = model.modelId
    ? null
    : (stringValue(details.modelName) ?? stringValue(call?.args.model))
  const tokens = compactNumber(details.tokens)
  const cost = finiteNumber(details.cost ?? details.totalCost)
  const usage =
    tokens === null && cost === null
      ? null
      : {
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          totalTokens: tokens,
          totalCost: cost,
          requestCount: null,
          toolCount: finiteNumber(details.toolUses),
          turnCount: finiteNumber(details.turnCount),
          scope: "subtree" as const,
        }
  const sourceEntryId = stringValue(entry.id)
  const statusRaw = stringValue(details.status)
  const root = rootFields(input)
  return {
    observationKey: stableKey([
      "tintinweb",
      "tool-details",
      input.filePath,
      sourceEntryId,
      nativeId,
    ]),
    nativeRunKey: nativeId,
    nativeId,
    adapter: "tintinweb",
    channel: "tool-details",
    sourcePath: input.filePath,
    sourceEntryId,
    artifactVersion: null,
    rootSessionRef: root.rootSessionRef,
    rootSessionFile: root.rootSessionFile,
    sessionFile: null,
    parentNativeId,
    workflowId: null,
    workflowStepIndex: null,
    agentType,
    displayName,
    description:
      stringValue(details.description) ?? stringValue(call?.args.description),
    statusRaw,
    status: canonicalStatus(statusRaw),
    startedAt: null,
    completedAt: isoTimestamp(entry.timestamp),
    provider: model.provider,
    modelId: model.modelId,
    modelLabel,
    usage,
    precision: {
      identity: "exact",
      linkage: parentNativeId ? "exact" : "reported",
      model: model.modelId ? "reported" : modelLabel ? "reported" : "unknown",
      tokens:
        tokens === null
          ? "unknown"
          : typeof details.tokens === "number"
            ? "reported"
            : "estimated",
      cost: cost === null ? "unknown" : "reported",
    },
    metadataPriority: 40,
    usagePriority: 40,
  }
}

function notificationObservations(
  input: AdapterInput,
  entry: Record<string, unknown>,
  value: Record<string, unknown>
): AgentObservation[] {
  const all = [value, ...(Array.isArray(value.others) ? value.others : [])]
  return all.flatMap((raw) => {
    const details = record(raw)
    const nativeId = stringValue(details?.id)
    if (!details || !nativeId) return []
    const tokens = finiteNumber(details.totalTokens)
    const cost = finiteNumber(details.totalCost)
    const statusRaw = stringValue(details.status)
    return [
      {
        observationKey: stableKey([
          "tintinweb",
          "notification",
          input.filePath,
          stringValue(entry.id),
          nativeId,
        ]),
        nativeRunKey: nativeId,
        nativeId,
        adapter: "tintinweb",
        channel: "notification",
        sourcePath: input.filePath,
        sourceEntryId: stringValue(entry.id),
        artifactVersion: null,
        rootSessionRef: rootFields(input).rootSessionRef,
        rootSessionFile: rootFields(input).rootSessionFile,
        sessionFile: null,
        parentNativeId: null,
        workflowId: null,
        workflowStepIndex: null,
        agentType: null,
        displayName: null,
        description: stringValue(details.description),
        statusRaw,
        status: canonicalStatus(statusRaw),
        startedAt: null,
        completedAt: isoTimestamp(entry.timestamp),
        provider: null,
        modelId: null,
        modelLabel: null,
        usage:
          tokens === null && cost === null
            ? null
            : {
                inputTokens: null,
                outputTokens: null,
                cacheReadTokens: null,
                cacheWriteTokens: null,
                totalTokens: tokens,
                totalCost: cost,
                requestCount: null,
                toolCount: finiteNumber(details.toolUses),
                turnCount: finiteNumber(details.turnCount),
                scope: "subtree",
              },
        precision: {
          identity: "exact",
          linkage: "reported",
          model: "unknown",
          tokens: tokens === null ? "unknown" : "reported",
          cost: cost === null ? "unknown" : "reported",
        },
        metadataPriority: 50,
        usagePriority: 50,
      } satisfies AgentObservation,
    ]
  })
}

function transcriptObservation(input: AdapterInput): AgentObservation[] {
  const sidechains = input.records.filter((entry) => entry.isSidechain === true)
  if (!sidechains.length) return []
  const nativeId = sidechains
    .map((entry) => stringValue(entry.agentId))
    .find(Boolean)
  if (!nativeId) return []
  let usage: AgentUsageObservation | null = null
  let provider: string | null = null
  let modelId: string | null = null
  let startedAt: string | null = null
  let completedAt: string | null = null
  for (const entry of sidechains) {
    const timestamp = isoTimestamp(entry.timestamp)
    startedAt ??= timestamp
    completedAt = timestamp ?? completedAt
    const item = message(entry)
    if (stringValue(item?.role) !== "assistant") continue
    provider = stringValue(item?.provider) ?? provider
    modelId = stringValue(item?.model) ?? modelId
    usage = addUsage(usage, usageFromUnknown(item?.usage))
  }
  const rootSessionRef = transcriptRoot(input.filePath)
  return [
    {
      observationKey: stableKey([
        "tintinweb",
        "output",
        input.filePath,
        nativeId,
      ]),
      nativeRunKey: nativeId,
      nativeId,
      adapter: "tintinweb",
      channel: "output",
      sourcePath: input.filePath,
      sourceEntryId: null,
      artifactVersion: null,
      rootSessionRef,
      rootSessionFile: null,
      sessionFile: input.filePath,
      parentNativeId: null,
      workflowId: null,
      workflowStepIndex: null,
      agentType: null,
      displayName: null,
      description: null,
      statusRaw: null,
      status: "unknown",
      startedAt,
      completedAt,
      provider,
      modelId,
      modelLabel: null,
      usage,
      precision: {
        identity: "exact",
        linkage: rootSessionRef ? "estimated" : "unknown",
        model: modelId ? "exact" : "unknown",
        tokens: usage?.totalTokens === null || !usage ? "unknown" : "exact",
        cost: usage?.totalCost === null || !usage ? "unknown" : "exact",
      },
      metadataPriority: 80,
      usagePriority: 80,
    },
  ]
}

export const tintinwebAdapter: AgentAdapter = {
  id: "tintinweb",

  defaultRoots() {
    return [resolve(tmpdir(), `pi-subagents-${process.getuid?.() ?? 0}`)]
  },

  acceptsArtifact(path) {
    return path.endsWith(".output")
  },

  retainWhenMissing(path) {
    return path.endsWith(".output")
  },

  inspect(input): AdapterResult {
    const observations = transcriptObservation(input)
    const calls = callRecords(input.records)
    const byId = new Map(
      input.records.flatMap((entry) => {
        const id = stringValue(entry.id)
        return id ? [[id, entry] as const] : []
      })
    )
    const claimedToolResultEntryIds: string[] = []
    const containerAgentId =
      input.records.map((entry) => stringValue(entry.agentId)).find(Boolean) ??
      null

    for (const entry of input.records) {
      if (entry.type === "custom" && entry.customType === "subagents:record") {
        const data = record(entry.data)
        const nativeId = stringValue(data?.id)
        if (data && nativeId) {
          const statusRaw = stringValue(data.status)
          observations.push({
            observationKey: stableKey([
              "tintinweb",
              "record",
              input.filePath,
              stringValue(entry.id),
              nativeId,
            ]),
            nativeRunKey: nativeId,
            nativeId,
            adapter: "tintinweb",
            channel: "record",
            sourcePath: input.filePath,
            sourceEntryId: stringValue(entry.id),
            artifactVersion: null,
            rootSessionRef: rootFields(input).rootSessionRef,
            rootSessionFile: rootFields(input).rootSessionFile,
            sessionFile: null,
            parentNativeId: containerAgentId,
            workflowId: null,
            workflowStepIndex: null,
            agentType: stringValue(data.type),
            displayName: stringValue(data.type),
            description: stringValue(data.description),
            statusRaw,
            status: canonicalStatus(statusRaw),
            startedAt: isoTimestamp(data.startedAt),
            completedAt: isoTimestamp(data.completedAt),
            provider: null,
            modelId: null,
            modelLabel: null,
            usage: null,
            precision: {
              identity: "exact",
              linkage: containerAgentId ? "exact" : "reported",
              model: "unknown",
              tokens: "unknown",
              cost: "unknown",
            },
            metadataPriority: 30,
            usagePriority: 0,
          })
        }
      }

      if (
        entry.type === "custom_message" &&
        entry.customType === "subagent-notification"
      ) {
        const details = record(entry.details)
        if (details)
          observations.push(...notificationObservations(input, entry, details))
      }

      const item = message(entry)
      if (stringValue(item?.role) !== "toolResult") continue
      const callId = stringValue(item?.toolCallId) ?? ""
      const call = matchingCall(entry, callId, calls, byId)
      const toolName = stringValue(item?.toolName) ?? call?.name ?? ""
      if (TOOL_NAMES.has(toolName) && item?.usage) {
        const entryId = stringValue(entry.id)
        if (entryId) claimedToolResultEntryIds.push(entryId)
      }
      if (toolName !== "Agent") continue
      const details = record(item?.details) ?? {}
      const observation = detailObservation(
        input,
        entry,
        details,
        call,
        containerAgentId
      )
      if (observation) observations.push(observation)
    }

    return { observations, claimedToolResultEntryIds }
  },
}
