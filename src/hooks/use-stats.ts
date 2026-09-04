import { useCallback, useEffect, useRef, useState } from "react"

import { useI18n } from "@/lib/i18n"
import { sessionsRequestSearch, statsRequestSearch } from "@/lib/dashboard-url"
import type {
  HideModelResult,
  SessionPageOptions,
  SessionsResponse,
  ShowModelResult,
  StatsFilters,
  StatsResponse,
  SyncResult,
} from "@/types"

const TOKEN_KEY = "pi-stats-token"
const REFRESH_INTERVAL_MS = 30_000

export function consumeAccessToken() {
  const url = new URL(window.location.href)
  const token = url.searchParams.get("token")

  if (token) {
    window.sessionStorage.setItem(TOKEN_KEY, token)
    url.searchParams.delete("token")
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`
    )
    return token
  }

  return window.sessionStorage.getItem(TOKEN_KEY) ?? ""
}

async function request<T>(
  path: string,
  token: string,
  failureMessage: (status: number) => string,
  init?: RequestInit
) {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  })

  if (!response.ok) throw new Error(failureMessage(response.status))

  return (await response.json()) as T
}

export function useStats(
  filters: StatsFilters,
  sessionPage: SessionPageOptions
) {
  const { messages: t } = useI18n()
  const [token] = useState(consumeAccessToken)
  const hasDataRef = useRef(false)
  const initialSyncRefreshStartedRef = useRef(false)
  const latestRequestRef = useRef(0)
  const latestSessionsRequestRef = useRef(0)
  const [data, setData] = useState<StatsResponse | null>(null)
  const [sessionsData, setSessionsData] = useState<SessionsResponse | null>(
    null
  )
  const [loadedSessionsRequest, setLoadedSessionsRequest] = useState<
    string | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSessionsLoading, setIsSessionsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [hidingModel, setHidingModel] = useState<{
    provider: string
    model: string
  } | null>(null)
  const [showingModel, setShowingModel] = useState<{
    provider: string
    model: string
  } | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal, quietly = false) => {
      const requestId = ++latestRequestRef.current
      if (!quietly) setIsLoading(true)
      else setIsRefreshing(true)

      try {
        const nextData = await request<StatsResponse>(
          `/api/stats?${statsRequestSearch(filters)}`,
          token,
          t.requestFailed,
          { signal }
        )
        if (requestId !== latestRequestRef.current) return
        setData(nextData)
        hasDataRef.current = true
        setError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return
        if (requestId === latestRequestRef.current) {
          setError(cause instanceof Error ? cause.message : t.statsUnavailable)
        }
      } finally {
        if (requestId === latestRequestRef.current) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    },
    [filters, t, token]
  )

  const loadSessions = useCallback(
    async (signal?: AbortSignal) => {
      const requestId = ++latestSessionsRequestRef.current
      setIsSessionsLoading(true)
      const search = sessionsRequestSearch(filters, sessionPage)

      try {
        const nextData = await request<SessionsResponse>(
          `/api/sessions?${search}`,
          token,
          t.requestFailed,
          { signal }
        )
        if (requestId !== latestSessionsRequestRef.current) return
        setSessionsData(nextData)
        setLoadedSessionsRequest(search.toString())
        setSessionsError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return
        if (requestId === latestSessionsRequestRef.current) {
          setSessionsError(
            cause instanceof Error ? cause.message : t.statsUnavailable
          )
        }
      } finally {
        if (requestId === latestSessionsRequestRef.current)
          setIsSessionsLoading(false)
      }
    },
    [filters, sessionPage, t, token]
  )

  const loadSessionsRef = useRef(loadSessions)
  useEffect(() => {
    loadSessionsRef.current = loadSessions
  }, [loadSessions])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal, hasDataRef.current)

    const interval = window.setInterval(() => {
      void load(undefined, true)
      void loadSessionsRef.current()
    }, REFRESH_INTERVAL_MS)

    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [load])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => loadSessions(controller.signal))
    return () => controller.abort()
  }, [loadSessions])

  const refresh = useCallback(async () => {
    await Promise.all([load(undefined, true), loadSessions()])
  }, [load, loadSessions])

  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  const sync = useCallback(async () => {
    setIsSyncing(true)
    try {
      await request<SyncResult>("/api/sync", token, t.requestFailed, {
        method: "POST",
      })
      setSyncError(null)
      await refresh()
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : t.syncFailed)
    } finally {
      setIsSyncing(false)
    }
  }, [refresh, t, token])

  useEffect(() => {
    if (initialSyncRefreshStartedRef.current) return
    initialSyncRefreshStartedRef.current = true
    void request<SyncResult>("/api/sync/initial", token, t.requestFailed)
      .then(() => {
        setSyncError(null)
        return refreshRef.current()
      })
      .catch((cause) =>
        setSyncError(cause instanceof Error ? cause.message : t.syncFailed)
      )
  }, [t, token])

  const hideModel = useCallback(
    async (provider: string, model: string) => {
      setHidingModel({ provider, model })
      const search = new URLSearchParams({ provider, model })
      try {
        return await request<HideModelResult>(
          `/api/models/hide?${search}`,
          token,
          t.requestFailed,
          { method: "POST" }
        )
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t.hideModelFailed)
        return null
      } finally {
        setHidingModel(null)
      }
    },
    [t, token]
  )

  const showModel = useCallback(
    async (provider: string, model: string) => {
      setShowingModel({ provider, model })
      const search = new URLSearchParams({ provider, model })
      try {
        await request<ShowModelResult>(
          `/api/models/show?${search}`,
          token,
          t.requestFailed,
          { method: "POST" }
        )
        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t.showModelFailed)
      } finally {
        setShowingModel(null)
      }
    },
    [refresh, t, token]
  )

  const currentSessionsRequest = sessionsRequestSearch(
    filters,
    sessionPage
  ).toString()

  return {
    data,
    sessionsData,
    error: syncError ?? error ?? sessionsError,
    isLoading,
    isSessionsLoading,
    loadedSessionsRequest,
    currentSessionsRequest,
    isRefreshing,
    isSyncing,
    hidingModel,
    showingModel,
    refresh,
    sync,
    hideModel,
    showModel,
  }
}
