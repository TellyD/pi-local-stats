import { useEffect, useRef, useState } from "react"
import {
  ActivityIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ClockIcon,
  CoinsIcon,
  SparklesIcon,
} from "lucide-react"

import { TraceTimeline } from "@/components/dashboard/TraceTimeline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import {
  buildTraceLanes,
  buildTraceScale,
  laneCostUnknown,
  scrollTraceMarkIntoView,
} from "@/lib/session-trace"
import type { SessionTraceResponse, SessionTraceSpan } from "@/types"

function TraceLegend({ spans }: { spans: SessionTraceSpan[] }) {
  const { messages: t } = useI18n()
  const items = [
    {
      label: t.agent,
      className: "border-primary bg-primary/70",
      visible: spans.some((span) => span.kind === "agent"),
    },
    {
      label: t.traceRequest,
      className: "border-[var(--chart-3)] bg-[var(--chart-3)]/70",
      visible: spans.some((span) => span.kind === "request"),
    },
    {
      label: t.traceTool,
      className: "border-border bg-secondary",
      visible: spans.some((span) => span.kind === "tool"),
    },
    {
      label: t.traceError,
      className: "border-destructive bg-destructive/20",
      visible: spans.some((span) => span.isError),
    },
    {
      label: t.traceNotAccounted,
      className: "border-dashed border-muted-foreground bg-muted",
      visible: spans.some(
        (span) => span.includedInSessionTotal === false && span.tokens !== null
      ),
    },
  ]
  return (
    <div
      aria-label={t.traceLegend}
      className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"
      role="list"
    >
      {items
        .filter((item) => item.visible)
        .map((item) => (
          <span
            key={item.label}
            className="flex items-center gap-1.5"
            role="listitem"
          >
            <span
              className={cn("h-2.5 w-5 rounded-sm border", item.className)}
            />
            {item.label}
          </span>
        ))}
    </div>
  )
}

function TraceDetails({ span }: { span: SessionTraceSpan }) {
  const { messages: t, format } = useI18n()

  const kind =
    span.kind === "agent"
      ? t.agent
      : span.kind === "request"
        ? t.traceRequest
        : t.traceTool
  const rows = [
    [
      t.started,
      span.startedAt
        ? format.dateTime(span.startedAt, true)
        : t.timingUnavailable,
    ],
    [
      t.observedDuration,
      span.durationMs === null
        ? t.timingUnavailable
        : format.duration(span.durationMs),
    ],
    [
      t.model,
      span.kind !== "tool" && span.model !== span.label
        ? span.model || "—"
        : "—",
    ],
    [t.provider, span.kind !== "tool" ? span.provider || "—" : "—"],
    [t.tokens, span.tokens === null ? "—" : format.compact(span.tokens)],
    [t.apiEquivalent, span.cost === null ? "—" : format.currency(span.cost)],
    [t.status, span.isError ? "—" : span.status || "—"],
  ]

  return (
    <div
      data-selected-span-id={span.id}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"
    >
      <div className="flex min-w-40 items-center gap-2">
        <Badge variant="secondary">{kind}</Badge>
        {span.isError ? (
          <Badge
            variant="outline"
            className="border-destructive text-destructive"
          >
            {t.traceError}
          </Badge>
        ) : null}
        <strong className="truncate font-medium">{span.label}</strong>
      </div>
      <dl className="contents">
        {rows
          .filter(([, value]) => value !== "—")
          .map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-mono tabular-nums">{value}</dd>
            </div>
          ))}
      </dl>
      {span.includedInSessionTotal === false && span.tokens !== null ? (
        <Badge variant="outline">{t.traceNotAccounted}</Badge>
      ) : span.includedInSessionTotal === true ? (
        <span className="text-xs text-muted-foreground">
          {t.includedInTotal}
        </span>
      ) : null}
    </div>
  )
}

export function SessionTrace({
  data,
  error,
  isLoading,
  onBack,
}: {
  data: SessionTraceResponse | null
  error: string | null
  isLoading: boolean
  onBack: () => void
}) {
  const { messages: t, format } = useI18n()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ key: string; ids: string[] } | null>(
    null
  )
  const [traceOpen, setTraceOpen] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia ||
      window.matchMedia("(min-width: 768px)").matches
  )
  const detailsRef = useRef<HTMLElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedId || !traceOpen) return
    const viewport = timelineRef.current
    const mark = viewport?.querySelector<HTMLElement>(
      '[data-trace-mark][aria-pressed="true"]'
    )
    if (viewport && mark) scrollTraceMarkIntoView(viewport, mark)
    detailsRef.current?.scrollIntoView({ block: "nearest" })
  }, [selectedId, traceOpen])

  const clearFocus = () => {
    setFocus(null)
    setSelectedId(null)
  }
  const inspectEvents = (key: string, ids: string[]) => {
    if (focus?.key === key) return clearFocus()
    setFocus({ key, ids })
    setSelectedId(ids[0] ?? null)
    setTraceOpen(true)
  }

  if (isLoading && !data)
    return (
      <div className="flex flex-col gap-4">
        <Button variant="outline" className="self-start" onClick={onBack}>
          <ArrowLeftIcon data-icon="inline-start" />
          {t.backToSessions}
        </Button>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    )

  if (error || !data)
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.sessionTrace}</CardTitle>
          <CardDescription role="alert">
            {error ?? t.traceNoEvents}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={onBack}>
            <ArrowLeftIcon data-icon="inline-start" />
            {t.backToSessions}
          </Button>
        </CardContent>
      </Card>
    )

  const sessionName = data.session.name || t.unnamedSession
  const spansById = new Map(data.spans.map((span) => [span.id, span]))
  const selected = selectedId ? (spansById.get(selectedId) ?? null) : null
  const focusedSpans = (focus?.ids ?? []).flatMap((id) => {
    const span = spansById.get(id)
    return span ? [span] : []
  })
  const lanes = buildTraceLanes(data.spans)
  const scale = buildTraceScale(data.spans, data.bounds)
  const kindLabel = (span: SessionTraceSpan) =>
    span.kind === "agent"
      ? t.agent
      : span.kind === "request"
        ? t.traceRequest
        : t.traceTool
  const errorGroups = (["request", "tool", "agent"] as const).map((kind) => ({
    kind,
    spans: data.spans.filter((span) => span.kind === kind && span.isError),
  }))
  const highlightedIds = new Set(focusedSpans.map((span) => span.id))
  const unpricedLanes = lanes.filter(laneCostUnknown)
  const unpricedTokens = unpricedLanes.reduce(
    (total, lane) => total + (lane.agent?.tokens ?? 0),
    0
  )
  const costCoverageComplete = unpricedLanes.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t.backToSessions}
            title={t.backToSessions}
            onClick={onBack}
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0">
            <div className="font-mono text-xs tracking-[0.14em] text-primary uppercase">
              {t.sessionTrace}
            </div>
            <h2 className="mt-1 text-2xl font-medium tracking-tight break-words">
              {sessionName}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <code>{data.session.id.slice(0, 8)}</code> ·{" "}
              {data.session.label || t.noProject} ·{" "}
              {format.dateTime(data.session.startedAt)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t.traceScope}</p>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4">
        {[
          {
            label: t.observedDuration,
            value: format.duration(data.session.durationMs),
            detail: t.observedDurationDetail,
            Icon: ClockIcon,
          },
          {
            label: t.requests,
            value: format.number(data.session.requests),
            detail: t.requestMetricDetail,
            Icon: ActivityIcon,
          },
          {
            label: t.tokens,
            value: format.compact(data.session.tokens),
            detail: t.tokenMetricDetail,
            Icon: SparklesIcon,
          },
          {
            label: t.apiEquivalent,
            value: format.currency(data.session.cost),
            detail: t.costMetricDetail,
            Icon: CoinsIcon,
          },
        ].map(({ label, value, detail, Icon }) => (
          <div key={label} className="bg-card px-4 py-3" title={detail}>
            <dt className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="size-3.5" />
              {label}
            </dt>
            <dd className="mt-1 font-mono text-xl tabular-nums">{value}</dd>
            <dd className="sr-only">{detail}</dd>
          </div>
        ))}
      </dl>

      {errorGroups.some((group) => group.spans.length > 0) ? (
        <div
          role="group"
          aria-label={t.traceErrorsByType}
          className="flex flex-wrap items-center gap-2"
        >
          {errorGroups
            .filter(({ spans }) => spans.length > 0)
            .map(({ kind, spans }) => (
              <Button
                key={kind}
                variant="outline"
                className="h-auto min-h-9 border-destructive/40 text-xs whitespace-normal aria-pressed:border-primary aria-pressed:text-primary"
                aria-pressed={focus?.key === `errors:${kind}`}
                onClick={() =>
                  inspectEvents(
                    `errors:${kind}`,
                    spans.map((span) => span.id)
                  )
                }
              >
                {kind === "request"
                  ? t.traceRequestErrors(spans.length)
                  : kind === "tool"
                    ? t.traceToolErrors(spans.length)
                    : t.traceFailedAgents(spans.length)}
              </Button>
            ))}
        </div>
      ) : null}

      {data.spans.length === 0 ? (
        <p
          role="status"
          className="rounded-lg border bg-card p-4 text-sm text-muted-foreground"
        >
          {t.traceNoEvents}
        </p>
      ) : (
        <details
          className="group min-w-0 overflow-hidden rounded-lg border bg-card"
          open={traceOpen}
          onToggle={(event) => setTraceOpen(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium group-open:border-b marker:hidden hover:bg-muted/40">
            {traceOpen ? t.hideRawTrace : t.showRawTrace(data.spans.length)}
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                traceOpen && "rotate-180"
              )}
            />
          </summary>
          <Card className="min-w-0 rounded-none pb-0 ring-0">
            <CardHeader className="gap-3">
              <CardDescription>{t.traceDescription}</CardDescription>
              <TraceLegend spans={data.spans} />
              {scale.compressed ? (
                <p className="text-xs text-muted-foreground">
                  {t.idleTimeCompressed}
                </p>
              ) : null}
              {costCoverageComplete ? null : (
                <p role="note" className="text-xs text-muted-foreground">
                  {t.traceCostCoverage(
                    unpricedLanes.length,
                    format.compact(unpricedTokens)
                  )}
                </p>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <>
                {selected ? (
                  <section
                    ref={detailsRef}
                    className="border-t p-3"
                    aria-label={t.traceDetails}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <SparklesIcon className="size-4 text-primary" />
                        {t.traceDetails}
                      </span>
                      {focus || selectedId ? (
                        <Button
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={clearFocus}
                        >
                          {t.traceShowAll}
                        </Button>
                      ) : null}
                    </div>
                    <TraceDetails span={selected} />
                    {focusedSpans.length > 1 ? (
                      <div className="mt-3">
                        <h3 className="mb-2 text-xs font-medium">
                          {t.traceSelectedEvents(focusedSpans.length)}
                        </h3>
                        <ul
                          aria-label={t.traceEventList}
                          className="max-h-48 overflow-y-auto rounded-md border"
                        >
                          {focusedSpans.map((span) => (
                            <li key={span.id}>
                              <button
                                type="button"
                                data-span-id={span.id}
                                aria-pressed={selectedId === span.id}
                                className={cn(
                                  "flex w-full cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                                  selectedId === span.id && "bg-primary/10"
                                )}
                                onClick={() => setSelectedId(span.id)}
                              >
                                <span className="min-w-0 break-words">
                                  {kindLabel(span)} ·{" "}
                                  <strong>{span.label}</strong>
                                  {span.isError &&
                                  !focus?.key.startsWith("errors:")
                                    ? ` · ${t.traceError}`
                                    : ""}
                                </span>
                                <span className="font-mono text-muted-foreground tabular-nums">
                                  {span.startedAt
                                    ? format.dateTime(span.startedAt, true)
                                    : t.timingUnavailable}{" "}
                                  ·{" "}
                                  {span.durationMs === null
                                    ? t.timingUnavailable
                                    : format.duration(span.durationMs)}
                                  {span.cost === null
                                    ? ""
                                    : ` · ${format.currency(span.cost)}`}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                <TraceTimeline
                  ref={timelineRef}
                  key={`${data.session.project}:${data.session.id}`}
                  visibleLanes={lanes}
                  scale={scale}
                  selected={selected}
                  highlightedIds={highlightedIds}
                  sessionCost={data.session.cost}
                  costCoverageComplete={costCoverageComplete}
                  onInspectEvents={inspectEvents}
                />
              </>
            </CardContent>
          </Card>
        </details>
      )}
    </div>
  )
}
