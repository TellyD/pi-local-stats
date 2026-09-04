import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const hooks = vi.hoisted(() => {
  let states: unknown[] = []
  let refs: Array<{ current: unknown }> = []
  let stateIndex = 0
  let refIndex = 0
  let effects: Array<{
    run: () => void | (() => void)
    dependencies?: readonly unknown[]
  }> = []
  let cleanups: Array<{
    run: () => void
    dependencies?: readonly unknown[]
  }> = []

  return {
    reset() {
      states = []
      refs = []
      cleanups = []
    },
    beginRender() {
      stateIndex = 0
      refIndex = 0
      effects = []
    },
    useState(initial: unknown) {
      const index = stateIndex++
      if (!(index in states))
        states[index] = typeof initial === "function" ? initial() : initial
      return [
        states[index],
        (value: unknown) => {
          states[index] = value
        },
      ]
    },
    useRef(initial: unknown) {
      const index = refIndex++
      return (refs[index] ??= { current: initial })
    },
    useEffect(
      effect: () => void | (() => void),
      dependencies?: readonly unknown[]
    ) {
      effects.push({ run: effect, dependencies })
    },
    flushEffects() {
      cleanups = effects.flatMap(({ run, dependencies }) => {
        const cleanup = run()
        return typeof cleanup === "function"
          ? [{ run: cleanup, dependencies }]
          : []
      })
    },
    cleanupEffectsWithDependency(dependency: unknown) {
      for (const cleanup of cleanups)
        if (cleanup.dependencies?.includes(dependency)) cleanup.run()
    },
    cleanupEffects() {
      for (const cleanup of cleanups) cleanup.run()
      cleanups = []
    },
  }
})

vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: hooks.useEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}))

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      requestFailed: (status: number) => `Request failed: ${status}`,
      statsUnavailable: "Statistics unavailable",
      syncFailed: "Sync failed",
      hideModelFailed: "Hide failed",
      showModelFailed: "Show failed",
    },
  }),
}))

import { useStats } from "../src/hooks/use-stats.ts"
import type { StatsFilters } from "../src/types.ts"

const filters = { range: "all" as const, project: "", provider: "", model: "" }
const sessionPage = {
  page: 1,
  pageSize: 20,
  sort: "startedAt" as const,
  direction: "desc" as const,
}
const ok = (body: unknown = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
})

function render(sessionsActive: boolean, nextFilters: StatsFilters = filters) {
  hooks.beginRender()
  // eslint-disable-next-line react-hooks/rules-of-hooks -- React is mocked by this hook harness.
  return useStats(nextFilters, sessionPage, sessionsActive)
}

beforeEach(() => {
  hooks.reset()
  vi.stubGlobal("document", { hidden: true })
  vi.stubGlobal("window", {
    location: { href: "http://127.0.0.1/overview" },
    history: { replaceState: vi.fn() },
    sessionStorage: { getItem: () => "token", setItem: vi.fn() },
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
  })
})

afterEach(() => {
  hooks.cleanupEffects()
  vi.unstubAllGlobals()
})

describe("useStats", () => {
  it("loads cached stats without waiting for the initial sync", () => {
    const fetchMock = vi.fn((input: string | URL) =>
      String(input).startsWith("/api/sync/initial")
        ? new Promise(() => undefined)
        : Promise.resolve(ok())
    )
    vi.stubGlobal("fetch", fetchMock)

    render(false)
    hooks.flushEffects()

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      "/api/stats?range=all"
    )
  })

  it("reloads aggregate stats after the initial sync succeeds", async () => {
    let finishInitialSync!: (response: ReturnType<typeof ok>) => void
    const initialSync = new Promise<ReturnType<typeof ok>>((resolve) => {
      finishInitialSync = resolve
    })
    const fetchMock = vi.fn((input: string | URL) =>
      String(input).startsWith("/api/sync/initial")
        ? initialSync
        : Promise.resolve(ok())
    )
    vi.stubGlobal("fetch", fetchMock)

    render(false)
    hooks.flushEffects()
    finishInitialSync(ok())
    await initialSync
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith("/api/stats")
      )
    ).toHaveLength(2)
  })

  it("does not let polling accidentally retry a failed initial sync", async () => {
    let recovered = false
    const fetchMock = vi.fn((input: string | URL) =>
      !recovered &&
      (String(input).startsWith("/api/sync/initial") ||
        String(input).startsWith("/api/stats"))
        ? Promise.reject(new Error("Initial sync failed"))
        : Promise.resolve(ok())
    )
    vi.stubGlobal("document", { hidden: false })
    vi.stubGlobal("fetch", fetchMock)

    render(false)
    hooks.flushEffects()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(window.setTimeout).not.toHaveBeenCalled()

    render(false)
    hooks.flushEffects()
    let timer = vi.mocked(window.setTimeout).mock.calls.at(-1)?.[0]
    expect(timer).toBeTypeOf("function")

    fetchMock.mockClear()
    if (typeof timer === "function") timer()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/sync/initial",
    ])

    recovered = true
    fetchMock.mockClear()
    timer = vi.mocked(window.setTimeout).mock.calls.at(-1)?.[0]
    if (typeof timer === "function") timer()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/sync/initial",
      "/api/stats?range=all",
    ])
    expect(render(false).error).toBeNull()
  })

  it("retries a failed initial sync before a manual refresh", async () => {
    let initialAttempts = 0
    const fetchMock = vi.fn((input: string | URL) => {
      const path = String(input)
      if (path.startsWith("/api/sync/initial")) {
        initialAttempts += 1
        return initialAttempts < 3
          ? Promise.reject(new Error("Initial sync failed"))
          : Promise.resolve(ok())
      }
      return initialAttempts < 3
        ? Promise.reject(new Error("Initial sync failed"))
        : Promise.resolve(ok())
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = render(false)
    hooks.flushEffects()
    await new Promise<void>((resolve) => setImmediate(resolve))

    fetchMock.mockClear()
    await result.refresh()
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/sync/initial",
    ])
    expect(render(false).error).toBe("Initial sync failed")

    fetchMock.mockClear()
    await result.refresh()
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/sync/initial",
      "/api/stats?range=all",
    ])
    expect(render(false).error).toBeNull()
  })

  it("reloads aggregate stats after the first manual sync succeeds", async () => {
    const fetchMock = vi.fn((input: string | URL) =>
      String(input).startsWith("/api/sync/initial")
        ? Promise.reject(new Error("Initial sync failed"))
        : Promise.resolve(ok())
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = render(false)
    hooks.flushEffects()
    await Promise.resolve()
    await result.sync()

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith("/api/stats")
      )
    ).toHaveLength(2)
    expect(render(false).error).toBeNull()
  })

  it("loads cached sessions while the initial sync is pending", async () => {
    const fetchMock = vi.fn((input: string | URL) =>
      String(input).startsWith("/api/sync/initial")
        ? new Promise(() => undefined)
        : Promise.resolve(ok({ rows: [] }))
    )
    vi.stubGlobal("fetch", fetchMock)

    render(true)
    hooks.flushEffects()
    await Promise.resolve()

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      "/api/sessions?range=all&page=1&pageSize=20&sort=startedAt&direction=desc"
    )
  })

  it("does not expose sessions loaded for old filters", async () => {
    const oldSessions = { rows: [], total: 12, page: 1, pageSize: 20 }
    const fetchMock = vi.fn((input: string | URL) => {
      const path = String(input)
      if (path.startsWith("/api/sync/initial"))
        return new Promise(() => undefined)
      if (path.startsWith("/api/sessions?range=7d"))
        return Promise.reject(new Error("Session failed"))
      return Promise.resolve(
        ok(path.startsWith("/api/sessions") ? oldSessions : {})
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    render(true)
    hooks.flushEffects()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(render(true).sessionsData).toBe(oldSessions)

    render(false, { ...filters, range: "7d" })
    hooks.flushEffects()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(render(true, { ...filters, range: "7d" }).sessionsData).toBeNull()
    hooks.flushEffects()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(render(true, { ...filters, range: "7d" }).sessionsData).toBeNull()
  })

  it("uses the latest filters and route after a long-running sync", async () => {
    let finishSync!: (response: ReturnType<typeof ok>) => void
    const syncResponse = new Promise<ReturnType<typeof ok>>((resolve) => {
      finishSync = resolve
    })
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      if (String(input) === "/api/sync" && init?.method === "POST")
        return syncResponse
      if (String(input).startsWith("/api/sync/initial"))
        return new Promise(() => undefined)
      return Promise.resolve(ok({ rows: [] }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = render(false)
    hooks.flushEffects()
    const syncing = result.sync()
    render(true, { ...filters, range: "7d" })
    hooks.flushEffects()
    await Promise.resolve()
    fetchMock.mockClear()
    finishSync(ok())
    await syncing

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/stats?range=7d",
      "/api/sessions?range=7d&page=1&pageSize=20&sort=startedAt&direction=desc",
    ])
  })

  it("uses the latest route after a long-running model update", async () => {
    let finishShow!: (response: ReturnType<typeof ok>) => void
    const showResponse = new Promise<ReturnType<typeof ok>>((resolve) => {
      finishShow = resolve
    })
    const fetchMock = vi.fn((input: string | URL) => {
      if (String(input).startsWith("/api/models/show")) return showResponse
      if (String(input).startsWith("/api/sync/initial"))
        return new Promise(() => undefined)
      return Promise.resolve(ok({ rows: [] }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = render(true)
    hooks.flushEffects()
    await Promise.resolve()
    const showing = result.showModel("provider", "model")
    render(false)
    hooks.flushEffects()
    await Promise.resolve()
    fetchMock.mockClear()
    finishShow(ok())
    await showing

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/stats?range=all",
    ])
  })

  it("does not refresh after unmounting during a sync", async () => {
    let finishSync!: (response: ReturnType<typeof ok>) => void
    const syncResponse = new Promise<ReturnType<typeof ok>>((resolve) => {
      finishSync = resolve
    })
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      if (String(input) === "/api/sync" && init?.method === "POST")
        return syncResponse
      if (String(input).startsWith("/api/sync/initial"))
        return new Promise(() => undefined)
      return Promise.resolve(ok())
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = render(false)
    hooks.flushEffects()
    fetchMock.mockClear()
    const syncing = result.sync()
    hooks.cleanupEffects()
    finishSync(ok())
    await syncing

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("aborts startup sync without post-unmount updates and retries", async () => {
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      if (!String(input).startsWith("/api/sync/initial"))
        return new Promise(() => undefined)
      return new Promise((_, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        )
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    render(false)
    hooks.flushEffects()
    const initialCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith("/api/sync/initial")
    )
    hooks.cleanupEffects()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(initialCall?.[1]?.signal?.aborted).toBe(true)
    expect(render(false).isSyncing).toBe(true)
    hooks.flushEffects()
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith("/api/sync/initial")
      )
    ).toHaveLength(2)
  })

  it("does not load stale aggregates after aborting an initial-sync poll retry", async () => {
    let initialAttempts = 0
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/sync/initial")) {
        initialAttempts += 1
        if (initialAttempts === 1)
          return Promise.reject(new Error("Initial sync failed"))
        return new Promise((_, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        )
      }
      return Promise.resolve(ok())
    })
    vi.stubGlobal("document", { hidden: false })
    vi.stubGlobal("fetch", fetchMock)

    render(false)
    hooks.flushEffects()
    await new Promise<void>((resolve) => setImmediate(resolve))
    render(false)
    hooks.flushEffects()
    await Promise.resolve()

    const timer = vi.mocked(window.setTimeout).mock.calls.at(-1)?.[0]
    fetchMock.mockClear()
    if (typeof timer === "function") timer()
    await Promise.resolve()

    hooks.cleanupEffects()
    render(false, { ...filters, range: "7d" })
    hooks.flushEffects()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/sync/initial",
      "/api/stats?range=7d",
    ])
  })

  it("does not load aggregates after aborting a manual initial-sync retry", async () => {
    let initialAttempts = 0
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/sync/initial")) {
        initialAttempts += 1
        if (initialAttempts === 1)
          return Promise.reject(new Error("Initial sync failed"))
        if (initialAttempts === 2)
          return new Promise((_, reject) =>
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true }
            )
          )
      }
      return Promise.resolve(ok())
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = render(false)
    hooks.flushEffects()
    await new Promise<void>((resolve) => setImmediate(resolve))
    fetchMock.mockClear()

    const staleRefresh = result.refresh()
    await Promise.resolve()
    const currentRefresh = result.refresh()
    await Promise.all([staleRefresh, currentRefresh])

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/sync/initial",
      "/api/sync/initial",
      "/api/stats?range=all",
    ])
  })

  it("clears aggregate refresh state after leaving sessions", async () => {
    let manual = false
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/sync/initial"))
        return new Promise(() => undefined)
      if (manual && String(input).startsWith("/api/stats"))
        return new Promise((_, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        )
      return Promise.resolve(ok({ rows: [] }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = render(true)
    hooks.flushEffects()
    await Promise.resolve()
    manual = true

    const refresh = result.refresh()
    expect(render(true).isRefreshing).toBe(true)

    hooks.cleanupEffectsWithDependency(true)
    await refresh

    expect(render(false).isRefreshing).toBe(false)
  })

  it("aborts a manual aggregate refresh on unmount", async () => {
    let manual = false
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/sync/initial"))
        return new Promise(() => undefined)
      if (manual && String(input).startsWith("/api/stats"))
        return new Promise((_, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        )
      return Promise.resolve(ok())
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = render(false)
    hooks.flushEffects()
    await Promise.resolve()
    manual = true

    const refresh = result.refresh()
    const aggregateCall = fetchMock.mock.calls.findLast(([input]) =>
      String(input).startsWith("/api/stats")
    )
    const signal = aggregateCall?.[1]?.signal
    hooks.cleanupEffects()

    expect(signal).toBeDefined()
    expect(signal?.aborted).toBe(true)
    await refresh
  })

  it("aborts a manual session refresh when filters change", async () => {
    let manual = false
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/sync/initial"))
        return new Promise(() => undefined)
      if (manual && String(input).startsWith("/api/sessions"))
        return new Promise((_, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        )
      return Promise.resolve(ok({ rows: [] }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = render(true)
    hooks.flushEffects()
    await Promise.resolve()
    manual = true

    const refresh = result.refresh()
    const aggregateCall = fetchMock.mock.calls.findLast(([input]) =>
      String(input).startsWith("/api/stats")
    )
    const sessionCall = fetchMock.mock.calls.findLast(([input]) =>
      String(input).startsWith("/api/sessions")
    )
    const signal = sessionCall?.[1]?.signal
    expect(signal).toBe(aggregateCall?.[1]?.signal)

    hooks.cleanupEffects()
    render(true, { ...filters, range: "7d" })
    hooks.flushEffects()

    expect(signal?.aborted).toBe(true)
    await refresh
  })

  it("clears a stale session error when a new session load starts", async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const path = String(input)
      if (path.startsWith("/api/sync/initial"))
        return new Promise(() => undefined)
      if (path.startsWith("/api/sessions?range=all"))
        return Promise.reject(new Error("Session failed"))
      if (path.startsWith("/api/sessions")) return new Promise(() => undefined)
      return Promise.resolve(ok())
    })
    vi.stubGlobal("fetch", fetchMock)

    render(true)
    hooks.flushEffects()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(render(true).error).toBe("Session failed")

    render(true, { ...filters, range: "7d" })
    hooks.flushEffects()
    await Promise.resolve()

    expect(render(true, { ...filters, range: "7d" }).error).toBeNull()
  })

  it("aborts manual session loads and hides session errors off-route", async () => {
    let sessionFailure = false
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      void init
      if (String(input).startsWith("/api/sessions")) {
        if (sessionFailure) return Promise.reject(new Error("Session failed"))
        return Promise.resolve(ok({ rows: [] }))
      }
      return Promise.resolve(ok())
    })
    vi.stubGlobal("fetch", fetchMock)

    let result = render(true)
    hooks.flushEffects()
    await Promise.resolve()

    const refresh = result.refresh()
    const sessionCall = fetchMock.mock.calls.findLast(([input]) =>
      String(input).startsWith("/api/sessions")
    )
    const signal = sessionCall?.[1]?.signal
    hooks.cleanupEffects()
    expect(signal?.aborted).toBe(true)
    await refresh

    sessionFailure = true
    result = render(true)
    hooks.flushEffects()
    await result.refresh()
    expect(render(true).error).toBe("Session failed")
    expect(render(false).error).toBeNull()
  })
})
