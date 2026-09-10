import { useI18n } from "@/lib/i18n"
import { laneActivityCounts, type TraceLane } from "@/lib/session-trace"

export function TraceActivitySummary({
  lanes,
  label,
  onInspectEvents,
}: {
  lanes: TraceLane[]
  label: string
  onInspectEvents: (key: string, ids: string[]) => void
}) {
  const { messages: t } = useI18n()
  const counts = lanes.map(laneActivityCounts)
  const requests = counts.flatMap((count) =>
    count.requests === null ? [] : [count.requests]
  )
  const tools = counts.flatMap((count) =>
    count.tools === null ? [] : [count.tools]
  )
  const text = t.traceActivityCounts(
    requests.length ? requests.reduce((sum, count) => sum + count, 0) : null,
    tools.length ? tools.reduce((sum, count) => sum + count, 0) : null,
    requests.length < lanes.length,
    tools.length < lanes.length
  )
  const ids = lanes.flatMap((lane) => lane.events.map((span) => span.id))
  const className =
    "w-full text-left font-mono text-[0.625rem] text-muted-foreground tabular-nums"
  return ids.length ? (
    <button
      type="button"
      className={`${className} cursor-pointer hover:text-primary`}
      title={t.traceActivityCountsDetail}
      aria-label={t.traceLaneEvents(label, ids.length)}
      onClick={() =>
        onInspectEvents(
          lanes.length === 1 ? `lane:${lanes[0]!.id}` : `group-events:${label}`,
          ids
        )
      }
    >
      {text}
    </button>
  ) : (
    <span className={className} title={t.traceActivityCountsDetail}>
      {text}
    </span>
  )
}
