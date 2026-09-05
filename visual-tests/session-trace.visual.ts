import { mkdir } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"

import type {
  SessionTraceResponse,
  SessionTraceSpan,
  StatsResponse,
} from "../server/types.ts"

const start = Date.parse("2026-08-28T12:00:00.000Z")
const minute = 60_000

const events: SessionTraceSpan[] = Array.from({ length: 256 }, (_, index) => {
  const request = index % 2 === 0
  const offset =
    index < 200
      ? (index / 200) * 25 * minute
      : (75 + ((index - 200) / 56) * 15) * minute
  return {
    id: `${request ? "request" : "tool"}:${index}`,
    parentId: null,
    depth: 0,
    kind: request ? "request" : "tool",
    label: request ? "gpt-5.6-sol" : index % 5 === 1 ? "bash" : "read",
    startedAt: new Date(start + offset).toISOString(),
    durationMs: request ? 5_000 + (index % 7) * 1_000 : 800 + (index % 4) * 300,
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    tokens: request ? 25_000 + index * 50 : null,
    cost: request ? (index < 6 ? 8 : 0) : null,
    isError: !request && index % 37 === 1,
    status: null,
    includedInSessionTotal: request ? true : null,
  }
})

const agents: SessionTraceSpan[] = Array.from({ length: 12 }, (_, index) => ({
  id: `agent:${index}`,
  parentId: null,
  depth: 0,
  kind: "agent",
  label: index % 2 ? "reviewer" : "worker",
  startedAt: new Date(start + (8 + index * 5) * minute).toISOString(),
  durationMs: 8 * minute,
  provider: "openai-codex",
  model: "gpt-5.6-sol",
  tokens: null,
  cost: null,
  isError: false,
  status: "completed",
  includedInSessionTotal: false,
}))

const trace: SessionTraceResponse = {
  session: {
    id: "visual-session",
    name: "Visual QA session",
    project: "/visual",
    label: "visual",
    startedAt: new Date(start).toISOString(),
    durationMs: 90 * minute,
    requests: 128,
    tokens: 4_000_000,
    cost: 24,
  },
  bounds: {
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + 90 * minute).toISOString(),
  },
  spans: [...events, ...agents],
}

const stats: StatsResponse = {
  meta: {
    lastSyncAt: new Date(start + 90 * minute).toISOString(),
    indexedFiles: 1,
    indexedSessions: 1,
  },
  filters: { range: "all", project: "", provider: "", model: "" },
  options: {
    projects: [{ value: "/visual", label: "visual" }],
    providers: ["openai-codex"],
    models: ["gpt-5.6-sol"],
  },
  overview: {
    requests: 128,
    errorRate: 4 / 128,
    totalTokens: 4_000_000,
    cacheReadTokens: 0,
    cacheRate: 0,
    cost: 24,
    averageDurationMs: 8_000,
  },
  timeseries: [],
  models: [],
  hiddenModels: [],
  providers: [],
  projects: [],
  tools: [],
  skills: [],
}

async function mockApi(page: Page, response = trace) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/stats") return route.fulfill({ json: stats })
    if (pathname === "/api/session-trace")
      return route.fulfill({ json: response })
    if (pathname === "/api/sessions")
      return route.fulfill({
        json: {
          rows: [
            {
              ...response.session,
              models: ["gpt-5.6-sol"],
              agents: [],
              accounting: {
                coverage: "complete",
                unassignedTokens: null,
                unassignedCost: null,
              },
            },
          ],
          page: Number(
            new URL(route.request().url()).searchParams.get("page") ?? 1
          ),
          pageSize: 20,
          total: 21,
        },
      })
    if (pathname === "/api/sync/initial" || pathname === "/api/sync")
      return route.fulfill({
        json: { scanned: 1, updated: 0, removed: 0, durationMs: 1 },
      })
    return route.fulfill({ status: 404, json: { error: "Not found" } })
  })
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true)
}

const sessionUrl =
  "/sessions?token=visual-token&sessionId=visual-session&sessionProject=%2Fvisual"

async function capture(page: Page, name: string) {
  await mkdir("visual-output", { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({
    path: `visual-output/${name}.png`,
    fullPage: true,
    animations: "disabled",
  })
}

test("desktop: errors first, grouped events and their costs inspectable, reset", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await mockApi(page)
  await page.goto(sessionUrl)
  const timeline = page.getByRole("region", { name: "Scrollable timeline" })
  await expect(timeline).toBeVisible()
  await expect(
    page.getByRole("group", { name: "Timeline shortcuts" }).getByRole("button")
  ).toHaveCount(0)
  await expect(page.getByRole("combobox")).toHaveCount(0)
  await expect(
    page.getByRole("region", { name: "Selected event", exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Back to sessions", exact: true })
  ).toHaveCount(1)
  await expect(page.getByText("What deserves attention")).toHaveCount(0)
  const timelineBox = await timeline.boundingBox()
  expect(timelineBox!.y).toBeLessThan(720)
  await expect(
    page.getByRole("list", { name: "Most expensive steps" })
  ).toHaveCount(0)
  await capture(page, "session-timeline-desktop")

  await page
    .getByRole("button", { name: "4 failed tool calls", exact: true })
    .click()
  const list = page.getByRole("list", { name: "Events in selection" })
  await expect(list.getByRole("button")).toHaveCount(4)
  await expect(list).not.toContainText(" · Error")
  await list.getByRole("button").nth(2).click()
  const errorId = await list
    .getByRole("button")
    .nth(2)
    .getAttribute("data-span-id")
  await expect(page.locator("[data-selected-span-id]")).toHaveAttribute(
    "data-selected-span-id",
    errorId!
  )
  await page
    .getByRole("button", { name: "Show all events", exact: true })
    .click()
  await expect(list).toHaveCount(0)
  await expect(timeline.getByRole("button", { name: /^Agent ·/ })).toHaveCount(
    16
  )

  // A second click on an error filter also clears it.
  const errors = page.getByRole("button", {
    name: "4 failed tool calls",
    exact: true,
  })
  await errors.click()
  await expect(errors).toHaveAttribute("aria-pressed", "true")
  await errors.click()
  await expect(errors).toHaveAttribute("aria-pressed", "false")
  await expect(list).toHaveCount(0)

  const bucket = timeline
    .getByRole("button", { name: /^\d+ requests? · \d+ tools?/ })
    .first()
  const counts = (await bucket.getAttribute("aria-label"))!.match(
    /^(\d+) requests? · (\d+) tools?/
  )
  await bucket.click()
  await expect(list.getByRole("button")).toHaveCount(
    Number(counts![1]) + Number(counts![2])
  )
  const last = list.getByRole("button").last()
  const lastId = await last.getAttribute("data-span-id")
  await last.focus()
  await page.keyboard.press("Enter")
  await expect(page.locator("[data-selected-span-id]")).toHaveAttribute(
    "data-selected-span-id",
    lastId!
  )
  await capture(page, "session-group-desktop")
  await page
    .getByRole("button", { name: "Show all events", exact: true })
    .click()

  await page
    .getByRole("button", {
      name: "Inspect 256 events in Pi session",
      exact: true,
    })
    .click()
  await expect(list).toContainText(" · Error")
  await list.locator('[data-span-id="request:4"]').click()
  await expect(page.locator("[data-selected-span-id]")).toContainText("$8.00")
  await expect(page.locator("[data-selected-span-id]")).toContainText(":30")
  await expect(page.locator("[data-selected-span-id]")).toHaveAttribute(
    "data-selected-span-id",
    "request:4"
  )
  await expect(timeline.getByRole("button", { pressed: true })).toHaveCount(1)
  await capture(page, "session-cost-desktop")
  await page
    .getByRole("button", { name: "Show all events", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Show 4 more agents", exact: true })
    .click()
  await expect(timeline.getByRole("button", { name: /^Agent ·/ })).toHaveCount(
    24
  )
  await page
    .getByRole("button", { name: "Show fewer agents", exact: true })
    .click()
})

test("mobile: collapsed initially, scrollable timeline and French interactions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await page.goto(sessionUrl)
  await expect(page.locator("summary")).toHaveText("Show timeline · 268 events")
  await expect(
    page.getByRole("region", { name: "Scrollable timeline" })
  ).toBeHidden()
  await expect(
    page.getByRole("button", { name: "4 failed tool calls", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "0 failed requests", exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole("combobox")).toHaveCount(0)
  await capture(page, "session-timeline-mobile")
  await page
    .getByRole("button", { name: "4 failed tool calls", exact: true })
    .click()
  await expect(
    page.getByRole("list", { name: "Events in selection" }).getByRole("button")
  ).toHaveCount(4)
  await page
    .getByRole("button", { name: "Show all events", exact: true })
    .click()
  await page.getByText("Hide timeline", { exact: true }).click()
  await page.getByRole("button", { name: "fr", exact: true }).click()
  await page
    .getByText("Afficher la chronologie · 268 événements", { exact: true })
    .click()
  const timeline = page.getByRole("region", { name: "Chronologie défilante" })
  await expect(timeline).toBeVisible()
  const geometry = await timeline.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }))
  expect(geometry.scroll).toBeGreaterThan(geometry.client)
  await timeline.evaluate((el) => {
    el.scrollLeft = 300
  })
  expect(await timeline.evaluate((el) => el.scrollLeft)).toBe(300)
  await capture(page, "session-timeline-mobile-fr")
  const moreAgents = await page
    .getByRole("button", { name: "Afficher 4 agents de plus", exact: true })
    .boundingBox()
  expect(moreAgents!.x).toBeGreaterThanOrEqual(0)
  expect(moreAgents!.x + moreAgents!.width).toBeLessThanOrEqual(390)
  await timeline.screenshot({
    path: "visual-output/session-timeline-mobile-detail.png",
    animations: "disabled",
  })
  await page
    .getByRole("button", { name: "4 appels d’outil en erreur", exact: true })
    .click()
  const list = page.getByRole("list", { name: "Événements de la sélection" })
  await expect(list.getByRole("button")).toHaveCount(4)
  await expect(list).not.toContainText(" · Erreur")
  await list.getByRole("button").last().click()
  await capture(page, "session-group-mobile-fr")
  await page.getByRole("button", { name: "Tout afficher", exact: true }).click()
  await expect(list).toHaveCount(0)
  await page.getByText("Masquer la chronologie", { exact: true }).click()
  await expect(
    page.getByRole("list", { name: "Principales dépenses" })
  ).toHaveCount(0)
  await page
    .getByText("Afficher la chronologie · 268 événements", { exact: true })
    .click()
  await page
    .getByRole("button", {
      name: "Consulter 256 événements de Session Pi",
      exact: true,
    })
    .click()
  await list.locator('[data-span-id="request:4"]').click()
  await expect(timeline).toBeVisible()
  await expect(page.locator("[data-selected-span-id]")).toHaveAttribute(
    "data-selected-span-id",
    "request:4"
  )
  const viewportBox = (await timeline.boundingBox())!
  const selectedMark = (await timeline
    .locator('[data-trace-mark][aria-pressed="true"]')
    .boundingBox())!
  expect(selectedMark.x).toBeGreaterThanOrEqual(viewportBox.x + 192)
  expect(selectedMark.x + selectedMark.width).toBeLessThanOrEqual(
    viewportBox.x + viewportBox.width
  )
  await expectNoHorizontalOverflow(page)
})

test("agent lanes distinguish failed agents from child errors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const counts = [256, 6, 8, 0, 2]
  const agentRows = agents.slice(0, counts.length).map((agent, index) => ({
    ...agent,
    isError: index === 0 || index === 3,
    status:
      index === 0 || index === 3 ? ("failed" as const) : ("completed" as const),
    startedAt: index === 4 ? null : agent.startedAt,
    durationMs: index === 4 ? null : agent.durationMs,
  }))
  const children = agentRows.flatMap((agent, agentIndex) =>
    Array.from({ length: counts[agentIndex]! }, (_, index) => {
      const request = index % 2 === 0
      return {
        ...events[request ? 0 : 1]!,
        id: `child:${agentIndex}:${index}`,
        parentId: agent.id,
        depth: 1,
        startedAt: agent.startedAt
          ? new Date(
              Date.parse(agent.startedAt) +
                (index / counts[agentIndex]!) * 7 * minute
            ).toISOString()
          : null,
        durationMs: agent.startedAt ? 1000 : null,
        cost: request
          ? index === 0
            ? [10, 3, 2, 0, 0][agentIndex]!
            : 0
          : null,
        isError:
          (agentIndex === 0 && (index === 1 || index === 7)) ||
          (agentIndex === 1 && index === 1),
      }
    })
  )
  await mockApi(page, {
    ...trace,
    session: { ...trace.session, durationMs: 31 * minute, cost: 15 },
    bounds: {
      ...trace.bounds,
      endedAt: new Date(start + 31 * minute).toISOString(),
    },
    spans: [{ ...events[0]!, cost: 0 }, ...agentRows, ...children],
  })
  await page.goto(sessionUrl)
  const timeline = page.getByRole("region", { name: "Scrollable timeline" })
  const lane = timeline.locator('[data-lane-id="agent:0"]')
  await expect(lane.locator("[data-trace-mark]")).toHaveCount(1)
  await expect(
    lane.getByText("128 requests · 128 tools", { exact: true })
  ).toBeVisible()
  await expect(lane.getByText("Failed", { exact: true })).toBeVisible()
  await expect(lane.getByText(/errors?/i)).toHaveCount(0)
  const completedLane = timeline.locator('[data-lane-id="agent:1"]')
  await expect(completedLane.locator("[data-trace-mark]")).toHaveCount(1)
  // A completed agent's failed tool call must not imply the agent failed.
  await expect(completedLane.getByText(/error|failed/i)).toHaveCount(0)
  await expect(
    timeline
      .locator('[data-lane-id="agent:3"]')
      .getByText("Failed", { exact: true })
  ).toBeVisible()
  await capture(page, "session-agent-bars-desktop")
  await timeline.screenshot({
    path: "visual-output/session-agent-bars-detail.png",
    animations: "disabled",
  })

  await lane.locator("[data-trace-mark]").click()
  const list = page.getByRole("list", { name: "Events in selection" })
  await expect(list.getByRole("button")).toHaveCount(256)
  await expect(list).toContainText(" · Error")
  await list.getByRole("button").last().click()
  await expect(page.locator("[data-selected-span-id]")).toHaveAttribute(
    "data-selected-span-id",
    "child:0:255"
  )
  await expect(lane.locator("[data-trace-mark]")).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await capture(page, "session-agent-events-desktop")
  await page
    .getByRole("button", { name: "Show all events", exact: true })
    .click()

  await lane.locator("[data-trace-mark]").click()
  await list.getByRole("button").first().click()
  await expect(page.locator("[data-selected-span-id]")).toContainText("$10.00")
  await expect(page.locator("[data-selected-span-id]")).toHaveAttribute(
    "data-selected-span-id",
    "child:0:0"
  )
  await expect(lane.locator("[data-trace-mark]")).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await page
    .getByRole("button", { name: "Show all events", exact: true })
    .click()

  const untimedLane = timeline.locator('[data-lane-id="agent:4"]')
  await expect(untimedLane.locator("[data-trace-mark]")).toHaveText(
    "Timing unavailable"
  )
  await untimedLane.locator("[data-trace-mark]").focus()
  await page.keyboard.press("Enter")
  await expect(list.getByRole("button")).toHaveCount(2)
  await page
    .getByRole("button", { name: "Show all events", exact: true })
    .click()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "fr", exact: true }).click()
  const mobileTimeline = page.getByRole("region", {
    name: "Chronologie défilante",
  })
  await expect(mobileTimeline).toBeVisible()
  await expect(mobileTimeline.getByText("Échec", { exact: true })).toHaveCount(
    2
  )
  await mobileTimeline.evaluate((el) => {
    el.scrollLeft = 0
  })
  await capture(page, "session-agent-bars-mobile-fr")
  await mobileTimeline
    .locator('[data-lane-id="agent:1"] [data-trace-mark]')
    .click()
  await expect(
    page
      .getByRole("list", { name: "Événements de la sélection" })
      .getByRole("button")
  ).toHaveCount(6)
  await expectNoHorizontalOverflow(page)
})

test("no generic diagnostic; untimed events and an expensive ninth agent remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const unknown = [0, 1].map((index) => ({
    ...events[1]!,
    id: `unknown:${index}`,
    startedAt: null,
    durationMs: null,
    isError: false,
  }))
  const paidAgent = {
    ...agents[8]!,
    cost: 12,
    tokens: 1000,
    includedInSessionTotal: true,
  }
  const response = {
    ...trace,
    session: { ...trace.session, cost: 12 },
    spans: [
      ...unknown,
      ...agents.map((agent, index) =>
        index === 8 ? paidAgent : { ...agent, durationMs: null }
      ),
    ],
  }
  await mockApi(page, response)
  await page.goto(sessionUrl)
  await expect(
    page.getByRole("group", { name: "Timeline shortcuts" })
  ).toHaveCount(0)
  await expect(
    page.getByRole("group", { name: "Failures by event type" })
  ).toHaveCount(0)
  await page
    .getByRole("button", { name: "2 events without timing", exact: true })
    .click()
  const list = page.getByRole("list", { name: "Events in selection" })
  await expect(list.getByRole("button")).toHaveCount(2)
  await list.getByRole("button").last().click()
  await expect(page.locator("[data-selected-span-id]")).toHaveAttribute(
    "data-selected-span-id",
    "unknown:1"
  )
  await page
    .getByRole("button", { name: "Show all events", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Show 4 more agents", exact: true })
    .click()
  await page.locator('[data-lane-id="agent:8"] [data-trace-mark]').click()
  await expect(page.locator("[data-selected-span-id]")).toContainText("$12.00")
  await expect(page.locator("[data-selected-span-id]")).toHaveAttribute(
    "data-selected-span-id",
    "agent:8"
  )
  await expect(
    page
      .getByRole("region", { name: "Scrollable timeline" })
      .getByRole("button", { name: /^Agent · worker/, pressed: true })
  ).toHaveCount(2)
  await capture(page, "session-agent-cost-desktop")
})

test("a final short event does not add horizontal overflow on desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await mockApi(page, {
    ...trace,
    spans: [
      { ...events[0]!, durationMs: 90 * minute },
      { ...events[1]!, startedAt: trace.bounds.endedAt, durationMs: 0 },
    ],
  })
  await page.goto(sessionUrl)
  const timeline = page.getByRole("region", { name: "Scrollable timeline" })
  await expect(timeline).toBeVisible()
  const geometry = await timeline.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }))
  expect(geometry.scroll).toBe(geometry.client)
  await expect(page.locator('details [data-slot="card"]')).toHaveCSS(
    "padding-bottom",
    "0px"
  )
  const lastMark = timeline.locator("[data-trace-mark]").last()
  const markBox = (await lastMark.boundingBox())!
  const trackBox = (await timeline.boundingBox())!
  expect(markBox.width).toBeGreaterThanOrEqual(6)
  expect(markBox.x + markBox.width).toBeLessThanOrEqual(
    trackBox.x + trackBox.width
  )
  await lastMark.click()
  await expect(page.locator("[data-selected-span-id]")).toHaveAttribute(
    "data-selected-span-id",
    "tool:1"
  )
  await capture(page, "session-scrollbars-desktop-fit")
})

test("compressed gaps near the edges do not overflow with all agents expanded", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const firstEventAt = new Date(start + minute + 1000).toISOString()
  await mockApi(page, {
    ...trace,
    bounds: {
      ...trace.bounds,
      endedAt: new Date(start + 122 * minute + 1000).toISOString(),
    },
    spans: [
      { ...events[0]!, startedAt: firstEventAt, durationMs: minute },
      {
        ...events[2]!,
        startedAt: new Date(start + 120 * minute).toISOString(),
        durationMs: minute,
      },
      ...agents.map((agent) => ({
        ...agent,
        startedAt: firstEventAt,
        durationMs: minute,
      })),
    ],
  })
  await page.goto(sessionUrl)
  await page
    .getByRole("button", { name: "Show 4 more agents", exact: true })
    .click()
  const timeline = page.getByRole("region", { name: "Scrollable timeline" })
  await expect(timeline.locator("[data-lane-id]")).toHaveCount(13)
  const geometry = await timeline.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    overflowing: [...el.querySelectorAll("span, button")]
      .filter(
        (child) =>
          child.getBoundingClientRect().right >
          el.getBoundingClientRect().right + 0.5
      )
      .map((child) => child.textContent),
  }))
  expect(geometry, JSON.stringify(geometry)).toMatchObject({
    scroll: geometry.client,
  })
  const gaps = timeline.getByLabel(
    "Gap without timed events; may be a pause or missing timing data"
  )
  await expect(gaps).toHaveCount(3)
  for (const gap of await gaps.all()) {
    const box = (await gap.boundingBox())!
    const axis = (await gap.locator("..").boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(axis.x)
    expect(box.x + box.width).toBeLessThanOrEqual(axis.x + axis.width)
  }
  await capture(page, "session-compressed-edges-desktop")
})

test("native scrollbars match both themes and keep both axes scrollable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 1000 })
  await mockApi(page)
  await page.goto(sessionUrl)
  await page
    .getByRole("button", {
      name: "Inspect 256 events in Pi session",
      exact: true,
    })
    .click()
  const timeline = page.getByRole("region", { name: "Scrollable timeline" })
  const list = page.getByRole("list", { name: "Events in selection" })
  let darkColor = ""
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.keyboard.press("d")
    await expect(page.locator("html")).toHaveCSS("color-scheme", theme)
    for (const scrollable of [timeline, list]) {
      await expect(scrollable).toHaveCSS("scrollbar-width", "thin")
      const color = await scrollable.evaluate(
        (el) => getComputedStyle(el).scrollbarColor
      )
      expect(color).not.toBe("auto")
      if (theme === "dark") darkColor = color
      else expect(color).not.toBe(darkColor)
    }
    await timeline.evaluate((el) => {
      el.scrollLeft = 100
    })
    await list.evaluate((el) => {
      el.scrollTop = 100
    })
    expect(await timeline.evaluate((el) => el.scrollLeft)).toBe(100)
    expect(await list.evaluate((el) => el.scrollTop)).toBe(100)
    await capture(page, `session-scrollbars-${theme}`)
  }
})

test("session click, browser history and return preserve list filters and sorting", async ({
  page,
}) => {
  await mockApi(page)
  await page.goto(
    "/sessions?token=visual-token&range=7d&provider=openai-codex&sort=cost&direction=asc&page=2"
  )
  const listUrl = page.url()
  const session = page.getByRole("button", {
    name: "Analyze Visual QA session",
    exact: true,
  })
  await expect(session).toBeVisible()
  await capture(page, "session-list-before-click")
  await session.focus()
  await page.keyboard.press("Enter")
  await expect(page.locator("h2")).toHaveText("Visual QA session")
  await expect(page.getByRole("combobox")).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get("sessionId")).toBe(
    "visual-session"
  )
  await page.reload()
  await expect(page.locator("h2")).toHaveText("Visual QA session")
  await page.goBack()
  await expect(page).toHaveURL(listUrl)
  await expect(session).toBeVisible()
  await page.goForward()
  await expect(page.locator("h2")).toHaveText("Visual QA session")
  await page
    .getByRole("button", { name: "Back to sessions", exact: true })
    .click()
  await expect(page).toHaveURL(listUrl)
  await expect(page.getByRole("combobox")).toHaveCount(4)
})

test("refresh keeps the selected event visible while its request is pending", async ({
  page,
}) => {
  await mockApi(page)
  await page.goto(sessionUrl)
  await page
    .getByRole("button", {
      name: "Inspect 256 events in Pi session",
      exact: true,
    })
    .click()
  await page
    .getByRole("list", { name: "Events in selection" })
    .locator('[data-span-id="request:4"]')
    .click()
  const selected = page.locator('[data-selected-span-id="request:4"]')
  await expect(selected).toBeVisible()
  let release!: () => void
  let started!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const requested = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route(/\/api\/session-trace\?/, async (route) => {
    started()
    await pending
    await route.fulfill({ json: trace })
  })
  await page.getByRole("button", { name: "fr", exact: true }).click()
  await requested
  try {
    await expect(selected).toBeVisible()
    await expect(
      page.getByRole("region", { name: "Chronologie défilante" })
    ).toBeVisible()
  } finally {
    release()
  }
  await expect(selected).toContainText(":30")
})

test("empty and unavailable sessions explain the state and allow returning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page, {
    ...trace,
    session: { ...trace.session, cost: 0, requests: 0, tokens: 0 },
    spans: [],
  })
  await page.goto(sessionUrl)
  await expect(
    page.getByText("No visible events for this session.", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("list", { name: "Most expensive steps" })
  ).toHaveCount(0)
  await expect(page.locator("summary")).toHaveCount(0)
  await capture(page, "session-empty-mobile")
  await page.route(/\/api\/session-trace\?/, (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } })
  )
  await page.reload()
  await expect(page.getByRole("alert")).toHaveText("Request failed (404)")
  await capture(page, "session-unavailable-mobile")
  await page
    .getByRole("button", { name: "Back to sessions", exact: true })
    .click()
  await expect(page.getByRole("combobox")).toHaveCount(4)
})
