import type { Ref } from "react"
import { ActivityIcon, BotIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import {
  ACTIVITY_BUCKET_COUNT,
  buildActivityBuckets,
  laneAccountedCost,
  laneCostUnknown,
  type TraceLane,
  type TraceScale,
} from "@/lib/session-trace"
import type { SessionTraceSpan } from "@/types"

const DENSE_EVENT_THRESHOLD = 120

function spanStyle(span: SessionTraceSpan, scale: TraceScale) {
  if (!span.startedAt) return null
  const start = Date.parse(span.startedAt)
  if (!Number.isFinite(start)) return null
  const left = scale.position(start)
  const right = scale.position(start + Math.max(0, span.durationMs ?? 0))
  return {
    left: `min(${left}%, calc(100% - 6px))`,
    width: `max(6px, ${Math.max(0, right - left)}%)`,
  }
}

export function TraceTimeline({
  ref,
  visibleLanes,
  scale,
  selected,
  highlightedIds,
  sessionCost,
  costCoverageComplete,
  onInspectEvents,
}: {
  ref: Ref<HTMLDivElement>
  visibleLanes: TraceLane[]
  scale: TraceScale
  selected: SessionTraceSpan | null
  highlightedIds: Set<string>
  sessionCost: number
  costCoverageComplete: boolean
  onInspectEvents: (key: string, ids: string[]) => void
}) {
  const { messages: t, format } = useI18n()
  const selectedId = selected?.id ?? null
  const hasHighlights = highlightedIds.size > 0
  const scaleStart = scale.timeAt(0)
  const ticks = Array.from({ length: 5 }, (_, index) => ({
    left: index * 25,
    label:
      index === 0
        ? "0 s"
        : format.duration(scale.timeAt(index / 4) - scaleStart),
  }))
  const kindLabel = (span: SessionTraceSpan) =>
    span.kind === "agent"
      ? t.agent
      : span.kind === "request"
        ? t.traceRequest
        : t.traceTool

  return (
    <div
      ref={ref}
      className="w-full overflow-x-auto border-t"
      role="region"
      aria-label={t.traceScrollableTimeline}
      tabIndex={0}
    >
      <div className="min-w-[64rem]">
        <div className="grid grid-cols-[12rem_minmax(0,1fr)] border-b bg-muted/40 text-xs text-muted-foreground">
          <div className="sticky left-0 z-20 bg-muted px-4 py-3">
            {t.evidenceTimeline}
          </div>
          <div className="relative h-10 border-l">
            {scale.breaks.map((position) => (
              <span
                key={position}
                title={t.traceGap}
                aria-label={t.traceGap}
                className="absolute bottom-0 w-4 text-center text-xs text-muted-foreground"
                style={{
                  left: `clamp(0.5rem, ${position}%, calc(100% - 0.5rem))`,
                  transform: "translateX(-50%)",
                }}
              >
                //
              </span>
            ))}
            {ticks.map((tick, index) => (
              <span
                key={tick.left}
                className="absolute top-0 flex h-full flex-col items-center whitespace-nowrap"
                style={{
                  left: `${tick.left}%`,
                  transform: `translateX(${index === 0 ? "0" : index === 4 ? "-100%" : "-50%"})`,
                }}
              >
                <span className="h-2 border-l" />
                <span className="px-1 font-mono tabular-nums">
                  {tick.label}
                </span>
              </span>
            ))}
          </div>
        </div>
        {visibleLanes.map((lane) => {
          const requests = lane.events.filter(
            (span) => span.kind === "request"
          ).length
          const tools = lane.events.length - requests
          const dense =
            !lane.agent && lane.events.length > DENSE_EVENT_THRESHOLD
          const buckets = dense ? buildActivityBuckets(lane.events, scale) : []
          const maxBucketSize = Math.max(
            1,
            ...buckets.map((bucket) => bucket.spans.length)
          )
          const untimedEvents = lane.agent
            ? []
            : lane.events.filter((span) => !spanStyle(span, scale))
          const laneCost = laneAccountedCost(lane)
          const laneShare =
            costCoverageComplete && sessionCost > 0
              ? format.percent(laneCost / sessionCost)
              : null
          const laneName = lane.agent?.label ?? t.mainSession
          const laneSelected =
            selected?.id === lane.agent?.id ||
            lane.events.some((span) => span.id === selectedId)
          const laneHighlighted =
            highlightedIds.has(lane.id) ||
            lane.events.some((span) => highlightedIds.has(span.id))
          const agentStyle =
            lane.agent && lane.agent.durationMs !== null
              ? spanStyle(lane.agent, scale)
              : null
          const inspectLane = () =>
            onInspectEvents(
              `lane:${lane.id}`,
              lane.events.length
                ? lane.events.map((span) => span.id)
                : [lane.agent!.id]
            )
          const laneTitle = lane.agent
            ? `${t.agent} · ${laneName} · ${
                lane.agent.durationMs === null
                  ? t.timingUnavailable
                  : format.duration(lane.agent.durationMs)
              }`
            : laneName
          return (
            <div
              key={lane.id}
              data-lane-id={lane.id}
              className="grid min-h-14 grid-cols-[12rem_minmax(0,1fr)] border-b last:border-b-0"
            >
              <div
                className="sticky left-0 z-20 flex min-w-0 flex-col justify-center gap-0.5 bg-card px-3 py-1.5"
                style={{ paddingLeft: `${16 + lane.depth * 16}px` }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {lane.agent ? (
                    <button
                      type="button"
                      aria-label={laneTitle}
                      aria-pressed={laneSelected}
                      title={laneTitle}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                      onClick={() =>
                        onInspectEvents(`event:${lane.agent!.id}`, [
                          lane.agent!.id,
                        ])
                      }
                    >
                      <BotIcon className="size-3.5 shrink-0 text-primary" />
                      <span className="truncate text-xs font-medium">
                        {laneName}
                      </span>
                    </button>
                  ) : (
                    <>
                      <ActivityIcon className="size-3.5 shrink-0 text-primary" />
                      <span className="truncate text-xs font-medium">
                        {laneName}
                      </span>
                    </>
                  )}
                  {lane.agent?.status === "failed" ? (
                    <Badge
                      variant="outline"
                      className="shrink-0 border-destructive/60 bg-destructive/10 px-1 text-[0.625rem] text-destructive"
                    >
                      {t.traceAgentFailed}
                    </Badge>
                  ) : null}
                </div>
                {lane.events.length > 0 ? (
                  <button
                    type="button"
                    className="w-full cursor-pointer text-left font-mono text-[0.625rem] text-muted-foreground tabular-nums hover:text-primary"
                    aria-label={t.traceLaneEvents(laneName, lane.events.length)}
                    onClick={inspectLane}
                  >
                    {t.activityBucket(requests, tools, 0)}
                  </button>
                ) : null}
                {laneCostUnknown(lane) ? (
                  <span
                    className="truncate font-mono text-[0.625rem] text-muted-foreground tabular-nums"
                    aria-label={t.traceLaneCostUnknown(laneName)}
                    title={t.traceLaneCostUnknown(laneName)}
                  >
                    {t.tokenCount(
                      format.compact(lane.agent!.tokens ?? 0),
                      lane.agent!.tokens ?? 0
                    )}{" "}
                    · —
                  </span>
                ) : laneCost > 0 ? (
                  <span
                    className="truncate font-mono text-[0.625rem] text-muted-foreground tabular-nums"
                    aria-label={t.traceLaneCost(
                      laneName,
                      format.currency(laneCost),
                      laneShare
                    )}
                    title={t.traceLaneCost(
                      laneName,
                      format.currency(laneCost),
                      laneShare
                    )}
                  >
                    {format.currency(laneCost)}
                    {laneShare ? ` · ${laneShare}` : ""}
                  </span>
                ) : lane.agent ? (
                  <span className="truncate font-mono text-[0.625rem] text-muted-foreground tabular-nums">
                    {t.agentUsageUnavailable}
                  </span>
                ) : null}
              </div>
              <div className="relative h-full min-h-14 border-l bg-[linear-gradient(to_right,color-mix(in_oklch,var(--border)_40%,transparent)_1px,transparent_1px)] bg-[length:25%_100%]">
                {lane.agent ? (
                  <button
                    type="button"
                    aria-label={
                      lane.events.length
                        ? `${laneTitle} · ${t.traceLaneEvents(laneName, lane.events.length)}`
                        : laneTitle
                    }
                    aria-pressed={laneSelected}
                    title={laneTitle}
                    className={cn(
                      "absolute top-1 h-12 cursor-pointer rounded-sm border border-primary/60 bg-primary/10 hover:bg-primary/20",
                      !agentStyle &&
                        "left-2 border-dashed px-2 text-xs text-muted-foreground",
                      hasHighlights && !laneHighlighted && "opacity-20",
                      laneHighlighted && "border-primary bg-primary/25",
                      laneSelected && "ring-2 ring-ring ring-inset"
                    )}
                    data-trace-mark=""
                    style={agentStyle ?? undefined}
                    onClick={inspectLane}
                  >
                    {!agentStyle ? t.timingUnavailable : null}
                  </button>
                ) : (
                  <>
                    {dense ? (
                      <>
                        {buckets.map((bucket) => {
                          const isSelected = bucket.spans.some(
                            (span) => span.id === selected?.id
                          )
                          const isHighlighted = bucket.spans.some((span) =>
                            highlightedIds.has(span.id)
                          )
                          const title = t.activityBucket(
                            bucket.requests,
                            bucket.tools,
                            bucket.errors
                          )
                          return (
                            <button
                              key={bucket.index}
                              data-trace-mark=""
                              type="button"
                              aria-label={title}
                              aria-pressed={isSelected}
                              title={title}
                              className={cn(
                                "absolute inset-y-1 z-10 cursor-pointer overflow-hidden rounded-sm border border-border/70 bg-card/40 hover:z-20 hover:border-primary focus-visible:z-30",
                                bucket.errors > 0 && "border-destructive",
                                hasHighlights && !isHighlighted && "opacity-20",
                                isHighlighted &&
                                  "ring-2 ring-primary ring-inset",
                                isSelected && "ring-2 ring-ring ring-inset"
                              )}
                              style={{
                                left: `${(bucket.index / ACTIVITY_BUCKET_COUNT) * 100}%`,
                                width: `${100 / ACTIVITY_BUCKET_COUNT}%`,
                              }}
                              onClick={() =>
                                onInspectEvents(
                                  `bucket:${lane.id}:${bucket.index}`,
                                  bucket.spans.map((span) => span.id)
                                )
                              }
                            >
                              {bucket.requests ? (
                                <span
                                  className="absolute inset-x-px top-px h-[calc(50%-2px)] bg-[var(--chart-3)]"
                                  style={{
                                    opacity:
                                      0.2 +
                                      (bucket.requests / maxBucketSize) * 0.8,
                                  }}
                                />
                              ) : null}
                              {bucket.tools ? (
                                <span
                                  className="absolute inset-x-px bottom-px h-[calc(50%-2px)] bg-secondary"
                                  style={{
                                    opacity:
                                      0.2 +
                                      (bucket.tools / maxBucketSize) * 0.8,
                                  }}
                                />
                              ) : null}
                            </button>
                          )
                        })}
                      </>
                    ) : (
                      lane.events.map((span, index) => {
                        const style = spanStyle(span, scale)
                        const isSelected = selected?.id === span.id
                        const isUnaccounted =
                          span.includedInSessionTotal === false &&
                          span.tokens !== null
                        const title = `${kindLabel(span)} · ${span.label} · ${
                          span.durationMs === null
                            ? t.timingUnavailable
                            : format.duration(span.durationMs)
                        }${span.isError ? ` · ${t.traceError}` : ""}${
                          isUnaccounted ? ` · ${t.traceNotAccounted}` : ""
                        }`
                        const sameKindIndex = lane.events
                          .slice(0, index)
                          .filter((item) => item.kind === span.kind).length
                        return style ? (
                          <button
                            key={span.id}
                            data-trace-mark=""
                            type="button"
                            aria-label={title}
                            aria-pressed={isSelected}
                            title={title}
                            className={cn(
                              "absolute z-10 h-2.5 min-w-1.5 cursor-pointer rounded-sm border transition-[filter,box-shadow] hover:z-20 hover:brightness-125 focus-visible:z-30",
                              span.kind === "request" &&
                                "border-[var(--chart-3)] bg-[var(--chart-3)]",
                              span.kind === "tool" &&
                                "border-border bg-secondary",
                              span.isError &&
                                "border-destructive bg-destructive",
                              isUnaccounted && "border-dashed opacity-70",
                              hasHighlights &&
                                !highlightedIds.has(span.id) &&
                                "opacity-20",
                              highlightedIds.has(span.id) &&
                                "ring-2 ring-primary ring-offset-1",
                              isSelected &&
                                "ring-2 ring-ring ring-offset-1 ring-offset-background"
                            )}
                            style={{
                              ...style,
                              top: `${span.kind === "request" ? 7 + (sameKindIndex % 2) * 11 : 34 + (sameKindIndex % 2) * 11}px`,
                            }}
                            onClick={() =>
                              onInspectEvents(`event:${span.id}`, [span.id])
                            }
                          />
                        ) : null
                      })
                    )}
                    {untimedEvents.length > 0 ? (
                      <button
                        type="button"
                        aria-label={t.traceUntimedEvents(untimedEvents.length)}
                        title={t.timingUnavailable}
                        className="absolute top-1 right-1 z-20 h-6 min-w-6 cursor-pointer rounded-sm border border-dashed bg-card px-1 text-xs text-muted-foreground"
                        onClick={() =>
                          onInspectEvents(
                            `untimed:${lane.id}`,
                            untimedEvents.map((span) => span.id)
                          )
                        }
                      >
                        ? {untimedEvents.length}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
