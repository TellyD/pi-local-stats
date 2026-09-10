import type { SessionTraceResponse, SessionTraceSpan } from "@/types"

export interface TraceLane {
  id: string
  agent: SessionTraceSpan | null
  events: SessionTraceSpan[]
  depth: number
}

export interface TraceLaneGroup {
  id: string
  label: string
  lanes: TraceLane[]
}

export interface ActivityBucket {
  index: number
  requests: number
  tools: number
  errors: number
  spans: SessionTraceSpan[]
}

interface ScalePiece {
  realStart: number
  realEnd: number
  displayStart: number
  displayEnd: number
  compressed: boolean
}

export interface TraceScale {
  compressed: boolean
  breaks: number[]
  position: (time: number) => number
  timeAt: (ratio: number) => number
}

export const ACTIVITY_BUCKET_COUNT = 64

/** Center a mark in the visible track, excluding the sticky lane label. */
export function scrollTraceMarkIntoView(
  viewport: HTMLElement,
  mark: HTMLElement
) {
  const rect = mark.getBoundingClientRect()
  const labelWidth =
    mark.parentElement?.previousElementSibling?.getBoundingClientRect().width ??
    0
  viewport.scrollLeft +=
    rect.left +
    rect.width / 2 -
    (viewport.getBoundingClientRect().left +
      (viewport.clientWidth + labelWidth) / 2)
}

export function buildTraceLanes(spans: SessionTraceSpan[]): TraceLane[] {
  const agents = spans.filter((span) => span.kind === "agent")
  const agentIds = new Set(agents.map((agent) => agent.id))
  const eventsByLane = new Map<string, SessionTraceSpan[]>()
  for (const span of spans) {
    if (span.kind === "agent") continue
    const laneId =
      span.parentId && agentIds.has(span.parentId) ? span.parentId : "root"
    const events = eventsByLane.get(laneId) ?? []
    events.push(span)
    eventsByLane.set(laneId, events)
  }

  const lanes: TraceLane[] = []
  const rootEvents = eventsByLane.get("root") ?? []
  if (rootEvents.length)
    lanes.push({ id: "root", agent: null, events: rootEvents, depth: 0 })
  for (const agent of agents)
    lanes.push({
      id: agent.id,
      agent,
      events: eventsByLane.get(agent.id) ?? [],
      depth: agent.depth,
    })
  return lanes
}

export function groupTraceLanes(
  lanes: TraceLane[]
): Array<TraceLane | TraceLaneGroup> {
  const groups = new Map<string, TraceLaneGroup>()
  for (const lane of lanes) {
    if (!lane.agent) continue
    const label = lane.agent.agentType?.trim() || lane.agent.label
    const group = groups.get(label) ?? {
      id: `group:${label}`,
      label,
      lanes: [],
    }
    group.lanes.push(lane)
    groups.set(label, group)
  }
  return [...lanes.filter((lane) => !lane.agent), ...groups.values()]
}

/** Pack bars on the shared scale, reserving room for the 6px minimum mark. */
export function layoutAgentGroup(lanes: TraceLane[], scale: TraceScale) {
  const ends: number[] = []
  return lanes
    .map((lane) => {
      const agent = lane.agent!
      const start = Date.parse(agent.startedAt ?? "")
      const timed = Number.isFinite(start) && agent.durationMs !== null
      // The narrowest track is 831px (64rem timeline minus 12rem labels/border).
      // 0.8% covers a 6px mark even at that width, including at the right edge.
      const left = timed ? Math.min(99.2, scale.position(start)) : 0
      const right = timed
        ? Math.max(
            left + 0.8,
            scale.position(start + Math.max(0, agent.durationMs!))
          )
        : 100
      return { lane, left, right, timed }
    })
    .sort((a, b) => Number(b.timed) - Number(a.timed) || a.left - b.left)
    .map(({ lane, left, right, timed }) => {
      let row = ends.findIndex((end) => left >= end + 0.25)
      if (row === -1) row = ends.length
      ends[row] = right
      return { lane, row, timed }
    })
}

/** Reported totals and indexed events overlap: use their maximum, never their sum. */
export function laneActivityCounts(lane: TraceLane) {
  const requests = lane.events.filter((span) => span.kind === "request").length
  const tools = lane.events.filter((span) => span.kind === "tool").length
  const hasDetails = !lane.agent || lane.events.length > 0
  return {
    requests: hasDetails
      ? Math.max(requests, lane.agent?.requestCount ?? 0)
      : (lane.agent?.requestCount ?? null),
    tools: hasDetails
      ? Math.max(tools, lane.agent?.toolCount ?? 0)
      : (lane.agent?.toolCount ?? null),
  }
}

/** Match the trace's accounting sources, never add unassigned request copies. */
export function laneTokens(lane: TraceLane): number | null {
  const values = [
    ...(lane.agent?.includedInSessionTotal === true ? [lane.agent.tokens] : []),
    ...lane.events
      .filter(
        (span) =>
          span.kind === "request" && span.includedInSessionTotal === true
      )
      .map((span) => span.tokens),
  ].filter((tokens): tokens is number => tokens !== null)
  return values.length
    ? values.reduce((total, tokens) => total + tokens, 0)
    : null
}

/** An agent counted in the session total whose tokens are known but whose cost could not be priced. */
export function laneCostUnknown(lane: TraceLane): boolean {
  const agent = lane.agent
  return (
    agent !== null &&
    agent.includedInSessionTotal === true &&
    agent.cost === null &&
    (agent.tokens ?? 0) > 0
  )
}

/** Cost accounted to the session total for one lane: the agent's own accounted cost plus its accounted requests. */
export function laneAccountedCost(lane: TraceLane): number {
  return lane.events.reduce(
    (total, span) =>
      span.kind === "request" && span.includedInSessionTotal === true
        ? total + (span.cost ?? 0)
        : total,
    lane.agent?.cost ?? 0
  )
}

export function buildActivityBuckets(
  spans: SessionTraceSpan[],
  scale: TraceScale,
  count = ACTIVITY_BUCKET_COUNT
): ActivityBucket[] {
  const buckets = new Map<number, ActivityBucket>()
  for (const span of spans) {
    if (!span.startedAt) continue
    const startedAt = Date.parse(span.startedAt)
    if (!Number.isFinite(startedAt)) continue
    const index = Math.min(
      count - 1,
      Math.max(0, Math.floor((scale.position(startedAt) / 100) * count))
    )
    const bucket = buckets.get(index) ?? {
      index,
      requests: 0,
      tools: 0,
      errors: 0,
      spans: [],
    }
    if (span.kind === "request") bucket.requests += 1
    if (span.kind === "tool") bucket.tools += 1
    if (span.isError) bucket.errors += 1
    bucket.spans.push(span)
    buckets.set(index, bucket)
  }
  return [...buckets.values()].sort((left, right) => left.index - right.index)
}

export function buildTraceScale(
  spans: SessionTraceSpan[],
  bounds: SessionTraceResponse["bounds"]
): TraceScale {
  const intervals = spans
    .flatMap((span) => {
      const start = Date.parse(span.startedAt ?? "")
      return Number.isFinite(start)
        ? [{ start, end: start + Math.max(1_000, span.durationMs ?? 0) }]
        : []
    })
    .sort((left, right) => left.start - right.start)
  for (const time of [bounds.startedAt, bounds.endedAt]) {
    const point = Date.parse(time)
    intervals.push({ start: point, end: point })
  }
  intervals.sort((left, right) => left.start - right.start)

  const merged: Array<{ start: number; end: number }> = []
  for (const interval of intervals) {
    const previous = merged.at(-1)
    if (previous && interval.start <= previous.end)
      previous.end = Math.max(previous.end, interval.end)
    else merged.push({ ...interval })
  }

  const activeDuration = merged.reduce(
    (total, interval) => total + interval.end - interval.start,
    0
  )
  const idleDuration = merged
    .slice(1)
    .reduce(
      (total, interval, index) =>
        total + Math.max(0, interval.start - merged[index]!.end),
      0
    )
  // ponytail: idle time gets at most 20% of the width; add a scale control only if needed.
  const idleBudget = Math.min(
    idleDuration,
    activeDuration > 0 ? activeDuration / 4 : 60_000
  )
  const idleScale = idleDuration ? idleBudget / idleDuration : 1
  const pieces: ScalePiece[] = []
  let displayCursor = 0
  let realCursor = merged[0]!.start
  for (const interval of merged) {
    const gap = Math.max(0, interval.start - realCursor)
    if (gap) {
      const displayedGap = gap * idleScale
      pieces.push({
        realStart: realCursor,
        realEnd: interval.start,
        displayStart: displayCursor,
        displayEnd: displayCursor + displayedGap,
        compressed: idleScale < 1,
      })
      displayCursor += displayedGap
    }
    pieces.push({
      realStart: interval.start,
      realEnd: interval.end,
      displayStart: displayCursor,
      displayEnd: displayCursor + interval.end - interval.start,
      compressed: false,
    })
    displayCursor += interval.end - interval.start
    realCursor = Math.max(realCursor, interval.end)
  }

  const displayDuration = Math.max(1, displayCursor)
  const position = (time: number) => {
    if (time <= pieces[0]!.realStart) return 0
    for (const piece of pieces) {
      if (time > piece.realEnd) continue
      const realDuration = piece.realEnd - piece.realStart
      const displayTime = realDuration
        ? piece.displayStart +
          ((time - piece.realStart) / realDuration) *
            (piece.displayEnd - piece.displayStart)
        : piece.displayStart
      return Math.max(0, Math.min(100, (displayTime / displayDuration) * 100))
    }
    return 100
  }
  const timeAt = (ratio: number) => {
    const displayTime = Math.max(0, Math.min(1, ratio)) * displayDuration
    for (const piece of pieces) {
      if (displayTime > piece.displayEnd) continue
      const displayed = piece.displayEnd - piece.displayStart
      return displayed
        ? piece.realStart +
            ((displayTime - piece.displayStart) / displayed) *
              (piece.realEnd - piece.realStart)
        : piece.realStart
    }
    return pieces.at(-1)!.realEnd
  }

  return {
    compressed: pieces.some((piece) => piece.compressed),
    breaks: pieces
      .filter(
        (piece) => piece.compressed && piece.realEnd - piece.realStart >= 60_000
      )
      .map(
        (piece) =>
          ((piece.displayStart + piece.displayEnd) / 2 / displayDuration) * 100
      )
      // One marker per visible gap: markers closer than 1.5% would overlap.
      .filter(
        (position, index, positions) =>
          index === 0 || position - positions[index - 1]! >= 1.5
      ),
    position,
    timeAt,
  }
}
