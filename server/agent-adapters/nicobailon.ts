import { homedir, tmpdir, userInfo } from "node:os"
import { basename, dirname, resolve, sep } from "node:path"
import type {
  AdapterInput,
  AdapterResult,
  AgentAdapter,
  AgentObservation,
  AgentUsageObservation,
} from "./contracts.ts"
import {
  canonicalStatus,
  finiteNumber,
  isoTimestamp,
  modelFields,
  record,
  rootReference,
  stableKey,
  stringValue,
  usageFromUnknown,
} from "./contracts.ts"

function tempScopeId(): string {
  const sanitize = (value: string): string =>
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  if (process.getuid) return `uid-${process.getuid()}`
  for (const key of ["USERNAME", "USER", "LOGNAME"])
    if (process.env[key]) return `user-${sanitize(process.env[key]!)}`
  try {
    if (userInfo().username) return `user-${sanitize(userInfo().username)}`
  } catch {
    // Fall through to the home-directory name.
  }
  return `home-${sanitize(basename(homedir()))}`
}

function nicoRoot(): string {
  const configured = stringValue(process.env.PI_SUBAGENTS_TEMP_ROOT)
  return configured
    ? resolve(configured)
    : resolve(tmpdir(), `pi-subagents-${tempScopeId()}`)
}

function isLifecyclePath(path: string): boolean {
  const normalized = resolve(path).split(sep)
  return (
    (normalized.at(-1) === "status.json" ||
      normalized.at(-1) === "events.jsonl") &&
    normalized.at(-3) === "async-subagent-runs"
  )
}

function isStatusPath(path: string): boolean {
  return resolve(path).endsWith(`${sep}status.json`) && isLifecyclePath(path)
}

function isEventsPath(path: string): boolean {
  return resolve(path).endsWith(`${sep}events.jsonl`) && isLifecyclePath(path)
}

function nicoModelFields(value: unknown): ReturnType<typeof modelFields> {
  const raw = stringValue(value)
  return modelFields(
    raw?.replace(/:(?:off|minimal|low|medium|high|xhigh|max)$/i, "") ?? null
  )
}

function nicoUsage(
  value: Record<string, unknown>
): AgentUsageObservation | null {
  const tokens = usageFromUnknown(value.tokens ?? value.totalTokens)
  const cost = record(value.totalCost)
  const direct = usageFromUnknown(value.usage)
  const inputTokens =
    direct?.inputTokens ??
    tokens?.inputTokens ??
    finiteNumber(cost?.inputTokens)
  const outputTokens =
    direct?.outputTokens ??
    tokens?.outputTokens ??
    finiteNumber(cost?.outputTokens)
  const cacheReadTokens = direct?.cacheReadTokens ?? null
  const cacheWriteTokens = direct?.cacheWriteTokens ?? null
  const totalTokens =
    direct?.totalTokens ??
    tokens?.totalTokens ??
    finiteNumber(value.tokens) ??
    finiteNumber(value.totalTokens)
  const totalCost =
    direct?.totalCost ?? finiteNumber(cost?.costUsd ?? value.totalCost)
  const requestCount =
    direct?.requestCount ?? finiteNumber(value.requestCount ?? value.turnCount)
  const toolCount =
    direct?.toolCount ?? finiteNumber(value.toolCount ?? value.toolUses)
  const turnCount = direct?.turnCount ?? finiteNumber(value.turnCount)
  return inputTokens !== null ||
    outputTokens !== null ||
    cacheReadTokens !== null ||
    cacheWriteTokens !== null ||
    totalTokens !== null ||
    totalCost !== null ||
    toolCount !== null
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
        scope: "self",
      }
    : null
}

function statusFor(value: Record<string, unknown>): string | null {
  const explicit = stringValue(value.status ?? value.state)
  if (explicit) return explicit
  const exitCode = finiteNumber(value.exitCode)
  return exitCode === null ? null : exitCode === 0 ? "complete" : "failed"
}

function observation(
  input: AdapterInput,
  runId: string,
  index: number | null,
  value: Record<string, unknown>,
  rootSession: unknown,
  artifactVersion: string | null,
  channel: string,
  parentNativeId: string | null = null,
  workflowId: string | null = null
): AgentObservation {
  const nativeRunKey = stableKey([
    runId,
    index ?? stringValue(value.id) ?? "run",
  ])
  const nativeId =
    stringValue(
      value.childId ?? value.id ?? value.runId ?? value.workflowKey
    ) ?? (index === null ? runId : `${runId}:${index}`)
  const model = nicoModelFields(value.model)
  const root = rootReference(rootSession)
  const usage = nicoUsage(value)
  const statusRaw = statusFor(value)
  return {
    observationKey: stableKey([
      "nicobailon",
      channel,
      input.filePath,
      runId,
      index,
      nativeId,
    ]),
    nativeRunKey,
    nativeId,
    adapter: "nicobailon",
    channel,
    sourcePath: input.filePath,
    sourceEntryId: null,
    artifactVersion,
    rootSessionRef: root.rootSessionRef,
    rootSessionFile: root.rootSessionFile,
    sessionFile: stringValue(value.sessionFile),
    parentNativeId:
      parentNativeId ?? stringValue(value.parentRunId ?? value.parentAgentId),
    workflowId,
    workflowStepIndex: index,
    agentType: stringValue(value.agent),
    displayName: stringValue(value.agent),
    description: null,
    statusRaw,
    status: canonicalStatus(statusRaw),
    startedAt: isoTimestamp(value.startedAt),
    completedAt: isoTimestamp(value.endedAt ?? value.completedAt),
    provider: model.provider,
    modelId: model.modelId,
    modelLabel: model.modelLabel,
    usage,
    precision: {
      identity: "exact",
      linkage:
        root.rootSessionFile || root.rootSessionRef ? "reported" : "unknown",
      model: model.modelId || model.modelLabel ? "reported" : "unknown",
      tokens: usage?.totalTokens === null || !usage ? "unknown" : "reported",
      cost: usage?.totalCost === null || !usage ? "unknown" : "reported",
    },
    metadataPriority: channel === "status" ? 100 : 60,
    usagePriority: channel === "status" ? 100 : 60,
  }
}

function nestedObservations(
  input: AdapterInput,
  runId: string,
  children: unknown,
  rootSession: unknown,
  artifactVersion: string | null,
  parentNativeId: string | null,
  workflowId: string | null
): AgentObservation[] {
  if (!Array.isArray(children)) return []
  const observations: AgentObservation[] = []
  children.forEach((raw, index) => {
    const child = record(raw)
    if (!child) return
    const nestedRunId = stringValue(child.id ?? child.runId) ?? runId
    const item = observation(
      input,
      nestedRunId,
      finiteNumber(child.parentStepIndex) ?? index,
      child,
      rootSession,
      artifactVersion,
      "status",
      parentNativeId,
      workflowId
    )
    observations.push(item)
    observations.push(
      ...nestedObservations(
        input,
        nestedRunId,
        child.children,
        rootSession,
        artifactVersion,
        item.nativeId,
        workflowId
      )
    )
  })
  return observations
}

function inspectStatus(input: AdapterInput): AgentObservation[] {
  if (!isStatusPath(input.filePath)) return []
  const status = input.records[0]
  const runId =
    stringValue(status?.runId ?? status?.id) ??
    basename(dirname(input.filePath))
  if (!status || !runId) return []
  const versionValue = finiteNumber(status.lifecycleArtifactVersion)
  if (versionValue !== null && ![1, 2, 3].includes(versionValue)) return []
  const artifactVersion = versionValue === null ? null : String(versionValue)
  const rootSession = status.sessionId
  const mode = stringValue(status.mode)
  const workflowId = mode === "workflow" ? runId : null
  const steps = Array.isArray(status.steps) ? status.steps : []
  const observations: AgentObservation[] = []

  if (steps.length) {
    steps.forEach((raw, position) => {
      const step = record(raw)
      if (!step) return
      const index = finiteNumber(step.index) ?? position
      const item = observation(
        input,
        runId,
        index,
        step,
        rootSession,
        artifactVersion,
        "status",
        stringValue(status.parentRunId),
        workflowId
      )
      observations.push(item)
      observations.push(
        ...nestedObservations(
          input,
          runId,
          step.children,
          rootSession,
          artifactVersion,
          item.nativeId,
          workflowId
        )
      )
    })
  } else if (status.agent || status.totalTokens || status.totalCost) {
    observations.push(
      observation(
        input,
        runId,
        null,
        status,
        rootSession,
        artifactVersion,
        "status",
        stringValue(status.parentRunId),
        workflowId
      )
    )
  }

  observations.push(
    ...nestedObservations(
      input,
      runId,
      status.children ?? status.nestedChildren,
      rootSession,
      artifactVersion,
      stringValue(status.parentRunId),
      workflowId
    )
  )
  return observations
}

function inspectEvents(input: AdapterInput): AgentObservation[] {
  if (!isEventsPath(input.filePath)) return []
  const latest = new Map<
    string,
    {
      event: Record<string, unknown>
      status: string
      runId: string
      index: number
      version: number | null
      order: number
    }
  >()
  input.records.forEach((event, order) => {
    const type = stringValue(event.type)
    const match = type?.match(
      /^subagent\.step\.(started|completed|failed|paused|stopped)$/
    )
    const runId = stringValue(event.runId)
    const index = finiteNumber(event.stepIndex ?? event.index)
    if (!match || !runId || index === null) return
    const version = finiteNumber(event.lifecycleArtifactVersion)
    if (version !== null && ![1, 2, 3].includes(version)) return
    const key = stableKey([runId, index])
    const previous = latest.get(key)
    const timestamp = finiteNumber(event.ts) ?? order
    const previousTimestamp = previous
      ? (finiteNumber(previous.event.ts) ?? previous.order)
      : -Infinity
    if (timestamp >= previousTimestamp)
      latest.set(key, {
        event,
        status: match[1]!,
        runId,
        index,
        version,
        order,
      })
  })
  return [...latest.values()].map(({ event, status, runId, index, version }) =>
    observation(
      input,
      runId,
      index,
      { ...event, status, startedAt: event.ts, endedAt: event.ts },
      event.sessionId,
      version === null ? null : String(version),
      "events",
      stringValue(event.parentRunId),
      stringValue(event.workflowId)
    )
  )
}

function inspectSession(input: AdapterInput): AdapterResult {
  const observations: AgentObservation[] = []
  const claimedToolResultEntryIds: string[] = []
  for (const entry of input.records) {
    if (entry.type !== "message") continue
    const message = record(entry.message)
    if (stringValue(message?.role) !== "toolResult") continue
    const details = record(message?.details)
    const runId = stringValue(details?.runId ?? details?.asyncId)
    if (
      stringValue(message?.toolName) !== "subagent" ||
      !details ||
      !runId ||
      !Array.isArray(details.results)
    )
      continue
    const entryId = stringValue(entry.id)
    if (entryId && message?.usage) claimedToolResultEntryIds.push(entryId)
    details.results.forEach((raw, position) => {
      const result = record(raw)
      if (!result) return
      const index = finiteNumber(result.index ?? result.step) ?? position
      observations.push(
        observation(
          input,
          runId,
          index,
          result,
          input.session ? input.filePath : null,
          null,
          "tool-details",
          null,
          stringValue(details.mode) === "workflow" ? runId : null
        )
      )
    })
  }
  return { observations, claimedToolResultEntryIds }
}

export const nicobailonAdapter: AgentAdapter = {
  id: "nicobailon",

  defaultRoots() {
    return [nicoRoot()]
  },

  acceptsArtifact(path) {
    return isLifecyclePath(path)
  },

  retainWhenMissing(path) {
    return isLifecyclePath(path)
  },

  inspect(input) {
    const session = inspectSession(input)
    return {
      observations: [
        ...inspectStatus(input),
        ...inspectEvents(input),
        ...session.observations,
      ],
      claimedToolResultEntryIds: session.claimedToolResultEntryIds,
    }
  },
}
