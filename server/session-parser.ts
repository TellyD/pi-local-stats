import { basename, extname } from "node:path"

import type { AgentPrecision, AgentUsageScope } from "./agent-adapters/index.ts"

interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost: number
}

interface ParsedRequest {
  id: string
  sourceKey: string
  requestKey: string
  sourceEntryId: string | null
  timestamp: string
  provider: string
  model: string
  usage: Usage
  isError: boolean
  durationMs: number
  sourceChannel: string
  usageScope: AgentUsageScope
  tokenPrecision: AgentPrecision
  costPrecision: AgentPrecision
}

interface ParsedToolCall {
  id: string
  sourceKey: string
  name: string
  provider: string
  model: string
  startedAt: string
  durationMs: number
  isError: boolean
}

interface ParsedSkillUsage {
  id: string
  sourceKey: string
  skill: string
  provider: string
  model: string
  usedAt: string
}

export interface ParsedSession {
  id: string
  cwd: string
  name: string | null
  startedAt: string
  parentSession: string | null
  requests: ParsedRequest[]
  tools: ParsedToolCall[]
  skills: ParsedSkillUsage[]
}

const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0
const text = (value: unknown): string =>
  typeof value === "string" ? value : ""
const iso = (value: unknown, fallback: string): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const candidate = new Date(value)
    return Number.isNaN(candidate.getTime())
      ? fallback
      : candidate.toISOString()
  }
  const candidate = text(value)
  return Number.isNaN(Date.parse(candidate)) ? fallback : candidate
}

function skillNameFromPath(value: unknown): string | null {
  const path = text(value)
  if (path.startsWith("skill://"))
    return path.slice("skill://".length).split("/")[0] || null
  const normalized = path.replaceAll("\\", "/")
  const match = normalized.match(/\/([^/]+)\/SKILL\.md$/i)
  return match?.[1] ?? null
}

function usageFrom(value: unknown): Usage | null {
  if (!value || typeof value !== "object") return null
  const source = value as Record<string, unknown>
  const input = number(source.input ?? source.inputTokens)
  const output = number(source.output ?? source.outputTokens)
  const cacheRead = number(source.cacheRead ?? source.cacheReadTokens)
  const cacheWrite = number(source.cacheWrite ?? source.cacheWriteTokens)
  const totalTokens =
    number(source.totalTokens) || input + output + cacheRead + cacheWrite
  const costs =
    source.cost && typeof source.cost === "object"
      ? (source.cost as Record<string, unknown>)
      : {}
  const cost = number(costs.total ?? source.cost)
  return { input, output, cacheRead, cacheWrite, totalTokens, cost }
}

export function parseSourceRecords(
  filePath: string,
  source: string
): Record<string, unknown>[] {
  if (filePath.endsWith(".json")) {
    try {
      const parsed: unknown = JSON.parse(source)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? [parsed as Record<string, unknown>]
        : []
    } catch {
      return []
    }
  }
  return source.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return []
    try {
      const parsed: unknown = JSON.parse(line)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? [parsed as Record<string, unknown>]
        : []
    } catch {
      return []
    }
  })
}

export function parseSessionJsonl(
  filePath: string,
  source: string,
  inferredParentSession: string | null = null,
  records = parseSourceRecords(filePath, source)
): ParsedSession | null {
  const fallbackTime = new Date().toISOString()
  let sessionId = basename(filePath, extname(filePath))
  let cwd = ""
  let name: string | null = null
  let startedAt = fallbackTime
  let parentSession: string | null = inferredParentSession
  let currentProvider = "unknown"
  let currentModel = "unknown"
  let lastActivityAt: string | null = null
  const requests: ParsedRequest[] = []
  const tools = new Map<string, ParsedToolCall>()
  const skills: ParsedSkillUsage[] = []
  let requestCounter = 0
  let lineCounter = 0
  const sourceChannel = filePath.endsWith(".jsonl")
    ? "pi-session"
    : "external-artifact"

  for (const originalEntry of records) {
    let entry = originalEntry
    lineCounter += 1
    if (
      entry.type !== "message" &&
      ["user", "assistant", "toolResult"].includes(text(entry.type)) &&
      entry.message &&
      typeof entry.message === "object"
    ) {
      const wrappedMessage = entry.message as Record<string, unknown>
      cwd = text(entry.cwd) || cwd
      const wrapperTimestamp = iso(entry.timestamp, startedAt)
      if (lineCounter === 1) startedAt = wrapperTimestamp
      const responseIdentity =
        text(wrappedMessage.responseId) || String(lineCounter)
      entry = {
        type: "message",
        id: text(entry.id) || `${sessionId}:${responseIdentity}`,
        parentId: entry.parentId ?? null,
        timestamp: iso(wrappedMessage.timestamp, wrapperTimestamp),
        message: wrappedMessage,
      }
    }

    if (entry.type === "session") {
      sessionId = text(entry.id) || sessionId
      cwd = text(entry.cwd)
      startedAt = iso(entry.timestamp, startedAt)
      parentSession = text(entry.parentSession) || parentSession
      continue
    }
    if (entry.type === "session_info") {
      name = text(entry.name).trim() || null
      continue
    }
    if (entry.type === "model_change") {
      currentProvider = text(entry.provider) || currentProvider
      currentModel = text(entry.modelId) || currentModel
      continue
    }

    const timestamp = iso(entry.timestamp, startedAt)
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      const usage = usageFrom(entry.usage)
      if (usage) {
        requestCounter += 1
        const sourceEntryId = text(entry.id) || null
        const sourceKey = `${sourceEntryId ?? "missing"}:${timestamp}:${entry.type}`
        requests.push({
          id: `${sessionId}:${sourceEntryId ?? requestCounter}:summary`,
          sourceKey,
          requestKey: sourceKey,
          sourceEntryId,
          timestamp,
          provider: currentProvider,
          model: currentModel,
          usage,
          isError: false,
          durationMs: 0,
          sourceChannel,
          usageScope: "self",
          tokenPrecision: "exact",
          costPrecision: "exact",
        })
      }
      // retainedTail is a context checkpoint, not independently billed usage.
      continue
    }
    if (entry.type !== "message") continue
    const message = entry.message
    if (!message || typeof message !== "object") continue
    const item = message as Record<string, unknown>
    const role = text(item.role)

    if (role === "user") {
      lastActivityAt = timestamp
      continue
    }

    if (role === "assistant") {
      currentProvider = text(item.provider) || currentProvider
      currentModel = text(item.model) || currentModel
      const usage = usageFrom(item.usage) ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: 0,
      }
      requestCounter += 1
      const stopReason = text(item.stopReason) || "unknown"
      const hasProviderError = Boolean(text(item.errorMessage))
      const isError = stopReason === "error" || hasProviderError
      const sourceEntryId = text(entry.id) || null
      const sourceKey = `${sourceEntryId ?? "missing"}:${timestamp}:assistant`
      const responseId = text(item.responseId)
      requests.push({
        id: `${sessionId}:${sourceEntryId ?? requestCounter}:assistant`,
        sourceKey,
        requestKey: responseId
          ? JSON.stringify([
              "response",
              currentProvider,
              currentModel,
              responseId,
            ])
          : sourceKey,
        sourceEntryId,
        timestamp,
        provider: currentProvider,
        model: currentModel,
        usage,
        isError,
        durationMs: lastActivityAt
          ? Math.max(0, Date.parse(timestamp) - Date.parse(lastActivityAt))
          : 0,
        sourceChannel,
        usageScope: "self",
        tokenPrecision: "exact",
        costPrecision: "exact",
      })
      const content = Array.isArray(item.content) ? item.content : []
      for (const block of content) {
        if (!block || typeof block !== "object") continue
        const call = block as Record<string, unknown>
        if (call.type !== "toolCall") continue
        const callId = text(call.id)
        if (!callId) continue
        const toolName = text(call.name) || "unknown"
        const argumentsValue = call.arguments
        const argumentsRecord =
          argumentsValue && typeof argumentsValue === "object"
            ? (argumentsValue as Record<string, unknown>)
            : {}
        const recordedTool: ParsedToolCall = {
          id: `${sessionId}:${callId}`,
          sourceKey: `${text(entry.id) || "missing"}:${callId}:${timestamp}:tool`,
          name: toolName,
          provider: currentProvider,
          model: currentModel,
          startedAt: timestamp,
          durationMs: 0,
          isError: false,
        }
        tools.set(callId, recordedTool)
        const skill =
          toolName === "read" ? skillNameFromPath(argumentsRecord.path) : null
        if (skill) {
          skills.push({
            id: `${sessionId}:${callId}:skill`,
            sourceKey: `${text(entry.id) || "missing"}:${callId}:${timestamp}:${skill}:skill`,
            skill,
            provider: currentProvider,
            model: currentModel,
            usedAt: timestamp,
          })
        }
      }
      continue
    }

    if (role !== "toolResult") continue
    const callId = text(item.toolCallId)
    const compositeId = `${sessionId}:${callId}`
    const existing = tools.get(callId)
    const isError = item.isError === true
    if (existing) {
      existing.durationMs = Math.max(
        0,
        Date.parse(timestamp) - Date.parse(existing.startedAt)
      )
      existing.isError = isError
    } else {
      tools.set(callId || `${requestCounter}:${timestamp}`, {
        id: callId
          ? compositeId
          : `${sessionId}:tool:${requestCounter}:${timestamp}`,
        sourceKey: `${text(entry.id) || "missing"}:${callId || "missing"}:${timestamp}:tool`,
        name: text(item.toolName) || "unknown",
        provider: currentProvider,
        model: currentModel,
        startedAt: timestamp,
        durationMs: 0,
        isError,
      })
    }
    const usage = usageFrom(item.usage)
    if (usage) {
      requestCounter += 1
      const sourceEntryId = text(entry.id) || null
      const sourceKey = `${sourceEntryId ?? "missing"}:${timestamp}:tool-usage`
      requests.push({
        id: `${sessionId}:${sourceEntryId ?? requestCounter}:tool`,
        sourceKey,
        requestKey: sourceKey,
        sourceEntryId,
        timestamp,
        provider: currentProvider,
        model: currentModel,
        usage,
        isError,
        durationMs: 0,
        sourceChannel,
        usageScope: "self",
        tokenPrecision: "exact",
        costPrecision: "exact",
      })
    }
    lastActivityAt = timestamp
  }

  return cwd
    ? {
        id: sessionId,
        cwd,
        name,
        startedAt,
        parentSession,
        requests,
        tools: [...tools.values()],
        skills,
      }
    : null
}
