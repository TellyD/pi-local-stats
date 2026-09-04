import type {
  SessionPageOptions,
  SessionSortKey,
  SortDirection,
  StatsFilters,
  StatsRange,
} from "@/types"

export const dashboardPaths = {
  overview: "/",
  costs: "/costs",
  sessions: "/sessions",
  models: "/models",
  tools: "/tools",
  skills: "/skills",
} as const

export type DashboardPageId = keyof typeof dashboardPaths

export const dashboardPages = Object.entries(dashboardPaths).map(
  ([id, path]) => ({ id, path })
) as Array<{
  id: DashboardPageId
  path: (typeof dashboardPaths)[DashboardPageId]
}>

export function dashboardSearchForPage(
  search: string | URLSearchParams,
  page: DashboardPageId
) {
  const next = new URLSearchParams(search)
  if (page !== "sessions") {
    next.delete("page")
    next.delete("pageSize")
    next.delete("sort")
    next.delete("direction")
  }
  const value = next.toString()
  return value ? `?${value}` : ""
}

export function dashboardPageFromPath(pathname: string) {
  return (
    dashboardPages.find(({ path }) =>
      path === "/"
        ? pathname === path
        : pathname === path || pathname === `${path}/`
    ) ?? null
  )
}

export const INITIAL_FILTERS: StatsFilters = {
  range: "all",
  project: "",
  provider: "",
  model: "",
}

export const INITIAL_SESSION_PAGE: SessionPageOptions = {
  page: 1,
  pageSize: 20,
  sort: "startedAt",
  direction: "desc",
}

const ranges = new Set<StatsRange>(["today", "7d", "30d", "90d", "all"])
const sessionSorts = new Set<SessionSortKey>([
  "name",
  "startedAt",
  "project",
  "models",
  "requests",
  "tokens",
  "cost",
])
const directions = new Set<SortDirection>(["asc", "desc"])

export function statsRequestSearch(filters: StatsFilters) {
  const search = new URLSearchParams({ range: filters.range })
  if (filters.project) search.set("project", filters.project)
  if (filters.provider) search.set("provider", filters.provider)
  if (filters.model) search.set("model", filters.model)
  return search
}

export function sessionsRequestSearch(
  filters: StatsFilters,
  sessionPage: SessionPageOptions
) {
  const search = statsRequestSearch(filters)
  search.set("page", String(sessionPage.page))
  search.set("pageSize", String(sessionPage.pageSize))
  search.set("sort", sessionPage.sort)
  search.set("direction", sessionPage.direction)
  return search
}

export function filtersFromSearch(search: URLSearchParams): StatsFilters {
  const range = search.get("range") as StatsRange | null
  return {
    range: range && ranges.has(range) ? range : INITIAL_FILTERS.range,
    project: search.get("project") ?? "",
    provider: search.get("provider") ?? "",
    model: search.get("model") ?? "",
  }
}

export function sessionPageFromSearch(
  search: URLSearchParams
): SessionPageOptions {
  const page = Number(search.get("page"))
  const sort = search.get("sort") as SessionSortKey | null
  const direction = search.get("direction") as SortDirection | null
  return {
    ...INITIAL_SESSION_PAGE,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    sort: sort && sessionSorts.has(sort) ? sort : INITIAL_SESSION_PAGE.sort,
    direction:
      direction && directions.has(direction)
        ? direction
        : INITIAL_SESSION_PAGE.direction,
  }
}

export function withFilter(
  search: URLSearchParams,
  key: keyof StatsFilters,
  value: string
): URLSearchParams {
  const next = new URLSearchParams(search)
  next.delete("page")
  if (!value || (key === "range" && value === INITIAL_FILTERS.range))
    next.delete(key)
  else next.set(key, value)
  return next
}

export function withSessionPage(
  search: URLSearchParams,
  updates: Partial<Pick<SessionPageOptions, "page" | "sort" | "direction">>
): URLSearchParams {
  const next = new URLSearchParams(search)
  const current = sessionPageFromSearch(next)
  const page = updates.page ?? current.page
  const sort = updates.sort ?? current.sort
  const direction = updates.direction ?? current.direction

  if (page === INITIAL_SESSION_PAGE.page) next.delete("page")
  else next.set("page", String(page))
  if (sort === INITIAL_SESSION_PAGE.sort) next.delete("sort")
  else next.set("sort", sort)
  if (direction === INITIAL_SESSION_PAGE.direction) next.delete("direction")
  else next.set("direction", direction)
  return next
}
