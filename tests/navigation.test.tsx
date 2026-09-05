import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DashboardNavigation } from "../src/components/dashboard/DashboardNavigation.tsx"
import { consumeAccessToken } from "../src/hooks/use-stats.ts"
import {
  dashboardPageFromPath,
  dashboardPaths,
  dashboardSearchForPage,
  filtersFromSearch,
  sessionPageFromSearch,
  sessionTraceFromSearch,
  sessionsRequestSearch,
  withFilter,
  withSessionPage,
  withSessionTrace,
} from "../src/lib/dashboard-url.ts"

const labels = {
  overview: "Overview",
  costs: "Costs",
  sessions: "Sessions",
  models: "Models",
  tools: "Tools",
  skills: "Skills",
}

afterEach(() => vi.unstubAllGlobals())

describe("dashboard navigation", () => {
  it("recognizes direct page URLs and rejects unknown paths", () => {
    expect(dashboardPageFromPath("/sessions")?.id).toBe("sessions")
    expect(dashboardPageFromPath("/sessions/")?.id).toBe("sessions")
    expect(dashboardPageFromPath("/unknown")).toBeNull()
  })

  it("preserves global filters but keeps session state on its page", () => {
    const search = "?range=7d&project=pi&page=2&sort=cost&direction=asc"
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={[`${dashboardPaths.sessions}${search}`]}>
        <DashboardNavigation
          label="Statistics sections"
          labels={labels}
          search={search}
        />
      </MemoryRouter>
    )

    expect(markup).toContain('<nav aria-label="Statistics sections"')
    expect(markup).toContain('href="/models?range=7d&amp;project=pi"')
    expect(markup).toContain(
      'href="/sessions?range=7d&amp;project=pi&amp;page=2&amp;sort=cost&amp;direction=asc"'
    )
    expect(markup).not.toContain("/tools?range=7d&amp;direction=asc")
    expect(markup).toContain(
      'aria-current="page" class="relative inline-flex h-8'
    )
    expect(markup).toContain(">Sessions</a>")
  })

  it("cleans session-only parameters from non-session URLs", () => {
    expect(
      dashboardSearchForPage(
        "?range=30d&page=2&sort=cost&direction=asc&sessionId=root&sessionProject=pi",
        "tools"
      )
    ).toBe("?range=30d")
    expect(dashboardSearchForPage("?page=2&direction=asc", "sessions")).toBe(
      "?page=2&direction=asc"
    )
  })

  it("reads validated filters and session options from the URL", () => {
    const search = new URLSearchParams(
      "range=30d&project=agent&provider=openai&model=gpt&page=3&sort=cost&direction=asc"
    )

    expect(filtersFromSearch(search)).toEqual({
      range: "30d",
      project: "agent",
      provider: "openai",
      model: "gpt",
    })
    expect(sessionPageFromSearch(search)).toEqual({
      page: 3,
      pageSize: 20,
      sort: "cost",
      direction: "asc",
    })
    expect(
      sessionPageFromSearch(
        new URLSearchParams(
          "page=9007199254740992&sort=invalid&direction=invalid"
        )
      )
    ).toEqual({
      page: 1,
      pageSize: 20,
      sort: "startedAt",
      direction: "desc",
    })
    expect(
      sessionTraceFromSearch(
        new URLSearchParams(
          "sessionId=root%2Fone&sessionProject=%2Fwork%2Fpi%20stats"
        )
      )
    ).toEqual({ id: "root/one", project: "/work/pi stats" })
    expect(
      sessionTraceFromSearch(new URLSearchParams("sessionId=root"))
    ).toBeNull()
  })

  it("keys session responses by filters as well as pagination", () => {
    const page = sessionPageFromSearch(new URLSearchParams("page=999"))
    const oldRequest = sessionsRequestSearch(
      { range: "7d", project: "old", provider: "", model: "" },
      page
    ).toString()
    const currentRequest = sessionsRequestSearch(
      { range: "7d", project: "new", provider: "", model: "" },
      page
    ).toString()

    expect(oldRequest).not.toBe(currentRequest)
    expect(currentRequest).toContain("project=new")
  })

  it("updates URL state without losing unrelated filters", () => {
    const filtered = withFilter(
      new URLSearchParams("range=7d&project=pi&page=4"),
      "provider",
      "openai"
    )
    expect(filtered.toString()).toBe("range=7d&project=pi&provider=openai")

    const paged = withSessionPage(filtered, {
      page: 2,
      sort: "tokens",
      direction: "asc",
    })
    expect(paged.toString()).toBe(
      "range=7d&project=pi&provider=openai&page=2&sort=tokens&direction=asc"
    )

    const traced = withSessionTrace(paged, {
      id: "root/one",
      project: "/work/pi stats",
    })
    expect(traced.get("sessionId")).toBe("root/one")
    expect(traced.get("sessionProject")).toBe("/work/pi stats")
    expect(withSessionTrace(traced, null).toString()).toBe(paged.toString())

    const changedFilter = withFilter(traced, "range", "all")
    expect(changedFilter.has("range")).toBe(false)
    expect(changedFilter.has("sessionId")).toBe(false)
    expect(changedFilter.has("sessionProject")).toBe(false)
  })

  it("removes the access token before the router reads the URL", () => {
    const replaceState = vi.fn()
    const setItem = vi.fn()
    vi.stubGlobal("window", {
      location: {
        href: "http://127.0.0.1:1234/sessions?token=secret&range=7d#usage",
      },
      history: { replaceState },
      sessionStorage: { getItem: vi.fn(), setItem },
    })

    expect(consumeAccessToken()).toBe("secret")
    expect(setItem).toHaveBeenCalledWith("pi-stats-token", "secret")
    expect(replaceState).toHaveBeenCalledWith(
      {},
      "",
      "/sessions?range=7d#usage"
    )
  })
})
