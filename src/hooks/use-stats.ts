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
  sessionPage: SessionPageOptions,
  sessionsActive: boolean
) {
  const { messages: t } = useI18n()
  const [token] = useState(consumeAccessToken)
  const hasDataRef = useRef(false)
  const initialSyncStartedRef = useRef(false)
  const initialSyncFailedRef = useRef(false)
  const latestRequestRef = useRef(0)
  const latestSessionsRequestRef = useRef(0)
  const manualRefreshControllerRef = useRef<AbortController | null>(null)
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
  const [bootstrapped, setBootstrapped] = useState(false)
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
      setSessionsError(null)
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

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal, hasDataRef.current)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    if (!sessionsActive) return
    const controller = new AbortController()
    void Promise.resolve().then(() => loadSessions(controller.signal))
    return () => controller.abort()
  }, [loadSessions, sessionsActive])

  const retryInitialSync = useCallback(
    async (signal: AbortSignal) => {
      try {
        await request<SyncResult>("/api/sync/initial", token, t.requestFailed, {
          signal,
        })
        initialSyncFailedRef.current = false
        setSyncError(null)
        return true
      } catch {
        return false
      }
    },
    [t, token]
  )

  useEffect(() => {
    if (!bootstrapped) return
    let controller: AbortController | null = null
    let timer: number | null = null
    let stopped = false

    const schedule = () => {
      timer = window.setTimeout(() => void poll(), REFRESH_INTERVAL_MS)
    }
    const poll = async () => {
      if (document.hidden) return schedule()
      controller = new AbortController()
      if (
        initialSyncFailedRef.current &&
        !(await retryInitialSync(controller.signal)) &&
        !hasDataRef.current
      ) {
        if (!stopped) schedule()
        return
      }
      if (stopped || controller.signal.aborted) return
      await load(controller.signal, true)
      if (!stopped && sessionsActive) await loadSessions(controller.signal)
      controller = null
      if (!stopped) schedule()
    }

    schedule()
    return () => {
      stopped = true
      controller?.abort()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [bootstrapped, load, loadSessions, retryInitialSync, sessionsActive])

  useEffect(
    () => () => {
      latestRequestRef.current += 1
    },
    [load]
  )

  useEffect(
    () => () => {
      manualRefreshControllerRef.current?.abort()
      manualRefreshControllerRef.current = null
      latestSessionsRequestRef.current += 1
    },
    [loadSessions, sessionsActive]
  )

  const performRefresh = useCallback(async () => {
    const controller = new AbortController()
    manualRefreshControllerRef.current?.abort()
    manualRefreshControllerRef.current = controller
    try {
      if (
        initialSyncFailedRef.current &&
        !(await retryInitialSync(controller.signal)) &&
        !hasDataRef.current
      )
        return
      if (controller.signal.aborted) return
      const requests = [load(controller.signal, true)]
      if (sessionsActive) requests.push(loadSessions(controller.signal))
      await Promise.all(requests)
    } finally {
      if (manualRefreshControllerRef.current === controller)
        manualRefreshControllerRef.current = null
    }
  }, [load, loadSessions, retryInitialSync, sessionsActive])

  const refreshRef = useRef<(() => Promise<void>) | null>(performRefresh)
  useEffect(() => {
    refreshRef.current = performRefresh
    return () => {
      refreshRef.current = null
    }
  }, [performRefresh])

  const refresh = useCallback(async () => {
    await refreshRef.current?.()
  }, [])

  const sync = useCallback(async () => {
    setIsSyncing(true)
    try {
      await request<SyncResult>("/api/sync", token, t.requestFailed, {
        method: "POST",
      })
      if (!refreshRef.current) return
      initialSyncFailedRef.current = false
      setSyncError(null)
      setBootstrapped(true)
      await refreshRef.current()
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : t.syncFailed)
    } finally {
      setIsSyncing(false)
    }
  }, [t, token])

  useEffect(() => {
    if (initialSyncStartedRef.current) return
    initialSyncStartedRef.current = true
    const controller = new AbortController()
    let stopped = false
    setIsSyncing(true)
    void request<SyncResult>("/api/sync/initial", token, t.requestFailed, {
      signal: controller.signal,
    })
      .then(async () => {
        if (stopped || !refreshRef.current) return
        setSyncError(null)
        setBootstrapped(true)
        await refreshRef.current()
      })
      .catch((cause) => {
        if (
          stopped ||
          (cause instanceof DOMException && cause.name === "AbortError")
        )
          return
        initialSyncFailedRef.current = true
        setSyncError(cause instanceof Error ? cause.message : t.syncFailed)
        setBootstrapped(true)
        setIsLoading(false)
      })
      .finally(() => {
        if (!stopped) setIsSyncing(false)
      })
    return () => {
      stopped = true
      controller.abort()
      initialSyncStartedRef.current = false
    }
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
    sessionsData:
      loadedSessionsRequest === currentSessionsRequest ? sessionsData : null,
    error: syncError ?? error ?? (sessionsActive ? sessionsError : null),
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
