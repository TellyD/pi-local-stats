import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildActivityBuckets,
  buildTraceLanes,
  buildTraceScale,
  laneAccountedCost,
  laneCostUnknown,
} from "../src/lib/session-trace.ts"
import { SessionTrace } from "../src/components/dashboard/SessionTrace.tsx"
import { I18nProvider } from "../src/lib/i18n.tsx"
import type { SessionTraceResponse, SessionTraceSpan } from "../server/types.ts"

afterEach(() => vi.unstubAllGlobals())

function renderTrace(data: SessionTraceResponse) {
  vi.stubGlobal("window", {
    localStorage: { getItem: () => "en", setItem: () => undefined },
  })
  return renderToStaticMarkup(
    <I18nProvider>
      <SessionTrace
        data={data}
        error={null}
        isLoading={false}
        onBack={() => undefined}
      />
    </I18nProvider>
  )
}

const trace: SessionTraceResponse = {
  session: {
    id: "trace-root",
    name: "Trace root",
    project: "/work/project",
    label: "project",
    startedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 10_000,
    requests: 1,
    tokens: 20,
    cost: 0.2,
  },
  bounds: {
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:10.000Z",
  },
  spans: [
    {
      id: "agent:parent",
      parentId: null,
      depth: 0,
      kind: "agent",
      label: "worker",
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 10_000,
      provider: "openai",
      model: "gpt",
      tokens: null,
      cost: null,
      isError: false,
      status: "completed",
      includedInSessionTotal: false,
    },
    {
      id: "request:one",
      parentId: "agent:parent",
      depth: 1,
      kind: "request",
      label: "gpt",
      startedAt: "2026-01-01T00:00:02.000Z",
      durationMs: 2_000,
      provider: "openai",
      model: "gpt",
      tokens: 20,
      cost: 0.2,
      isError: false,
      status: null,
      includedInSessionTotal: true,
    },
    {
      id: "tool:one",
      parentId: "agent:parent",
      depth: 1,
      kind: "tool",
      label: "bash",
      startedAt: "2026-01-01T00:00:05.000Z",
      durationMs: 0,
      provider: "openai",
      model: "gpt",
      tokens: null,
      cost: null,
      isError: true,
      status: null,
      includedInSessionTotal: null,
    },
    {
      id: "request:unassigned",
      parentId: null,
      depth: 0,
      kind: "request",
      label: "gpt",
      startedAt: "2026-01-01T00:00:09.000Z",
      durationMs: 0,
      provider: "openai",
      model: "gpt",
      tokens: 5,
      cost: 0.05,
      isError: false,
      status: null,
      includedInSessionTotal: false,
    },
    {
      id: "agent:untimed",
      parentId: null,
      depth: 0,
      kind: "agent",
      label: "reviewer",
      startedAt: null,
      durationMs: null,
      provider: null,
      model: null,
      tokens: null,
      cost: null,
      isError: false,
      status: "unknown",
      includedInSessionTotal: false,
    },
  ],
}

describe("SessionTrace", () => {
  it("ne transforme pas les pauses, durées et erreurs ordinaires en diagnostics", () => {
    const markup = renderTrace(trace)
    expect(markup).not.toContain("Timeline shortcuts")
    expect(markup).not.toContain("What deserves attention")
    expect(markup).not.toContain("No unusual concentration")
  })

  it("conserve le coût total sans classement des dépenses", () => {
    const markup = renderTrace(trace)
    expect(markup).toContain("$0.20")
    expect(markup).not.toContain("Most expensive steps")
    expect(markup).not.toContain("of the session")
  })

  it("affiche le coût comptabilisé et sa part du total sur chaque lane", () => {
    const lanes = buildTraceLanes(trace.spans)
    const root = lanes.find((lane) => lane.id === "root")!
    const worker = lanes.find((lane) => lane.id === "agent:parent")!
    expect(laneAccountedCost(root)).toBe(0)
    expect(laneAccountedCost(worker)).toBeCloseTo(0.2)
    expect(
      laneAccountedCost({
        ...worker,
        agent: { ...worker.agent!, cost: 0.3, includedInSessionTotal: true },
      })
    ).toBeCloseTo(0.5)

    const markup = renderTrace(trace)
    expect(markup).toContain("$0.20 · 100%")
    expect(markup).toContain(
      "Cost accounted to worker: $0.20 (100% of the total)"
    )
    expect(markup).not.toContain("Cost accounted to Pi session")
  })

  it("ne présente pas une part du total quand un agent comptabilisé n’a pas de coût chiffré", () => {
    const unpriced: SessionTraceResponse = {
      ...trace,
      spans: [
        ...trace.spans,
        {
          id: "agent:unpriced",
          parentId: null,
          depth: 0,
          kind: "agent",
          label: "planner",
          startedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 3_000,
          provider: null,
          model: null,
          tokens: 38_794,
          cost: null,
          isError: false,
          status: "completed",
          includedInSessionTotal: true,
        },
      ],
    }
    const lanes = buildTraceLanes(unpriced.spans)
    expect(
      laneCostUnknown(lanes.find((lane) => lane.id === "agent:unpriced")!)
    ).toBe(true)
    expect(
      laneCostUnknown(lanes.find((lane) => lane.id === "agent:parent")!)
    ).toBe(false)

    const markup = renderTrace(unpriced)
    expect(markup).toContain("$0.20")
    expect(markup).not.toContain("$0.20 · 100%")
    expect(markup).toContain("38.8K tokens")
    expect(markup).toContain(
      "planner reports tokens but no priced cost; it counts as zero in the session total"
    )
    expect(markup).toContain(
      "The session total excludes 1 agent with 38.8K tokens but no priced cost"
    )
    expect(renderTrace(trace)).not.toContain("The session total excludes")
  })

  it("nomme l’absence de données d’usage sur un agent sans tokens ni coût", () => {
    const markup = renderTrace(trace)
    const reviewerLane = markup.slice(
      markup.indexOf('data-lane-id="agent:untimed"')
    )
    expect(reviewerLane).toContain("Usage details unavailable")
    const rootLane = markup.slice(
      markup.indexOf('data-lane-id="root"'),
      markup.indexOf('data-lane-id="agent:parent"')
    )
    expect(rootLane).not.toContain("Usage details unavailable")
  })

  it("sépare les échecs de requêtes, outils et agents au lieu de les additionner", () => {
    const markup = renderTrace({
      ...trace,
      spans: trace.spans.map((span) =>
        span.id === "agent:parent" || span.id === "request:one"
          ? { ...span, isError: true }
          : span
      ),
    })
    expect(markup).toContain("1 failed request")
    expect(markup).toContain("1 failed tool call")
    expect(markup).toContain("1 failed agent")
    expect(markup).not.toContain("errors total")
  })

  it("rend une timeline hiérarchique accessible avec erreurs et usage exclu", () => {
    const markup = renderTrace(trace)

    expect(markup).toContain("1 failed tool call")
    expect(markup).toContain(
      "Elapsed time between the first and last observed event."
    )
    expect(markup).toContain("Hide timeline")
    expect(markup).toMatch(/<details[^>]* open=""/)
    expect(markup).toContain('aria-label="Back to sessions"')
    expect(markup).toContain(
      'aria-label="Agent · worker · 10 s" aria-pressed="false"'
    )
    expect(markup).not.toContain('aria-label="Tool · bash · — · Error"')
    expect(markup).toContain(
      'aria-label="Request · gpt · — · Not included in the session total" aria-pressed="false"'
    )
    expect(buildTraceLanes(trace.spans)).toHaveLength(3)
    expect(markup.match(/grid min-h-14/g)).toHaveLength(3)
    expect(markup).toContain("1 request · 1 tool")
    expect(markup).toContain("1 request · 0 tools")
    expect(markup).toContain(
      'aria-label="Agent · worker · 10 s · Inspect 2 events in worker"'
    )
    expect(markup).toContain("width:max(6px,")
    expect(markup).toContain("bg-destructive")
    expect(markup).toContain("Not included in the session total")
    expect(markup).toContain("Timing unavailable")
    expect(markup).toContain(">0 s<")
    expect(markup).toContain("overflow-x-auto")
    expect(markup).toContain("min-w-[64rem]")
    expect(markup).toContain('aria-label="Scrollable timeline" tabindex="0"')
    expect(markup).not.toContain('aria-label="Selected event"')
    expect(markup).not.toContain("0 failed requests")
    expect(markup).not.toContain("0 failed agents")
    expect(markup).not.toContain("0 requests · 0 tools")
    expect(markup.indexOf("1 failed tool call")).toBeLessThan(
      markup.indexOf("<details")
    )
    expect(markup).toContain("metadata only")
    expect(markup).toContain("Timeline")
  })

  it.each([4, 256])(
    "résume %i événements d’agent sans compteur d’erreurs trompeur",
    (count) => {
      const spans: SessionTraceSpan[] = Array.from(
        { length: count },
        (_, index) => ({
          ...trace.spans[index % 2 ? 1 : 2]!,
          id: `child:${index}`,
          cost: null,
          isError: index === 0,
        })
      )
      const markup = renderTrace({
        ...trace,
        spans: [trace.spans[0]!, ...spans],
      })
      expect(markup.match(/data-trace-mark=""/g)).toHaveLength(1)
      expect(markup).toContain(`${count / 2} requests · ${count / 2} tools`)
      expect(markup).toContain(
        `aria-label="Agent · worker · 10 s · Inspect ${count} events in worker"`
      )
      expect(markup).not.toContain(">1 error</span>")
      expect(markup).not.toContain(">Failed</span>")
      expect(markup).not.toContain('aria-label="Tool ·')
      expect(markup).not.toContain('aria-label="Request ·')
    }
  )

  it("limite les agents visibles avant exploration explicite", () => {
    const manyAgents: SessionTraceResponse = {
      ...trace,
      spans: [
        trace.spans[3]!,
        ...Array.from({ length: 12 }, (_, index) => ({
          ...trace.spans[0]!,
          id: `agent:${index}`,
        })),
      ],
    }
    const markup = renderTrace(manyAgents)

    expect(buildTraceLanes(manyAgents.spans)).toHaveLength(13)
    expect(markup.match(/grid min-h-14/g)).toHaveLength(9)
    expect(markup).toContain("Show 4 more agents")
    expect(markup).toContain('aria-expanded="false"')
  })

  it("compresse les longues périodes inactives sans perdre l’heure réelle", () => {
    const start = Date.parse("2026-01-01T00:00:00.000Z")
    const second = start + 2 * 60 * 60 * 1_000
    const spans = [
      {
        ...trace.spans[1]!,
        id: "request:first",
        startedAt: new Date(start).toISOString(),
        durationMs: 60_000,
      },
      {
        ...trace.spans[1]!,
        id: "request:second",
        startedAt: new Date(second).toISOString(),
        durationMs: 60_000,
      },
    ]
    const scale = buildTraceScale(spans, {
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(second + 60_000).toISOString(),
    })

    expect(scale.compressed).toBe(true)
    expect(scale.breaks).toEqual([50])
    expect(scale.position(start + 60_000)).toBeCloseTo(40)
    expect(scale.position(second)).toBeCloseTo(60)
    expect(scale.timeAt(1) - scale.timeAt(0)).toBe(7_260_000)
  })

  it("ne comprime pas une période couverte par un agent sans détail de requêtes", () => {
    const start = Date.parse(trace.bounds.startedAt)
    const agent = { ...trace.spans[0]!, durationMs: 120_000 }
    const scale = buildTraceScale([agent, trace.spans[1]!], {
      ...trace.bounds,
      endedAt: new Date(start + 120_000).toISOString(),
    })
    expect(scale.compressed).toBe(false)
    expect(scale.breaks).toEqual([])
    expect(scale.position(start + 60_000)).toBe(50)
    expect(scale.timeAt(0.5)).toBe(start + 60_000)
  })

  it("conserve les bornes observées avant et après les requêtes chronométrées", () => {
    const start = Date.parse(trace.bounds.startedAt)
    const scale = buildTraceScale([trace.spans[1]!], {
      startedAt: trace.bounds.startedAt,
      endedAt: new Date(start + 120_000).toISOString(),
    })
    expect(scale.timeAt(0)).toBe(start)
    expect(scale.timeAt(1)).toBe(start + 120_000)
    expect(scale.position(start + 30_000)).toBeLessThan(100)
    expect(scale.breaks).toHaveLength(1)
  })

  it("agrège les activités denses dans un nombre borné de colonnes", () => {
    const start = Date.parse("2026-01-01T00:00:00.000Z")
    const spans: SessionTraceSpan[] = Array.from(
      { length: 256 },
      (_, index) => ({
        ...trace.spans[index % 2 ? 1 : 2]!,
        id: `dense:${index}`,
        kind: index % 2 ? "request" : "tool",
        startedAt: new Date(start + index * 1_000).toISOString(),
        isError: index === 42,
      })
    )
    const bounds = {
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(start + 256_000).toISOString(),
    }
    const buckets = buildActivityBuckets(spans, buildTraceScale(spans, bounds))

    expect(buckets).toHaveLength(64)
    expect(buckets.reduce((total, bucket) => total + bucket.requests, 0)).toBe(
      128
    )
    expect(buckets.reduce((total, bucket) => total + bucket.tools, 0)).toBe(128)
    expect(buckets.reduce((total, bucket) => total + bucket.errors, 0)).toBe(1)
  })

  it("explique une session sans événement visible", () => {
    const markup = renderTrace({ ...trace, spans: [] })

    expect(markup).toContain("No visible events for this session.")
    expect(markup).not.toContain('aria-label="Selected event"')
    expect(markup).not.toContain("Most expensive steps")
    expect(markup).not.toContain("Timeline shortcuts")
  })
})
