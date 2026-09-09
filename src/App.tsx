import { useEffect, useMemo } from "react"
import {
  AlertTriangleIcon,
  RefreshCwIcon,
  RotateCwIcon,
  TerminalSquareIcon,
} from "lucide-react"
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router"

import { CostsPage } from "@/components/dashboard/CostsPage"
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation"
import { ModelsPage } from "@/components/dashboard/ModelsPage"
import { OverviewPage } from "@/components/dashboard/OverviewPage"
import { SessionsPage } from "@/components/dashboard/SessionsPage"
import { SkillsPage } from "@/components/dashboard/SkillsPage"
import { ToolsPage } from "@/components/dashboard/ToolsPage"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useStats } from "@/hooks/use-stats"
import {
  dashboardPageFromPath,
  dashboardPaths,
  dashboardSearchForPage,
  filtersFromSearch,
  sessionPageFromSearch,
  sessionTraceFromSearch,
  withFilter,
  withSessionPage,
  withSessionTrace,
} from "@/lib/dashboard-url"
import { catalogs, resolveLanguage, useI18n } from "@/lib/i18n"
import type {
  SessionSortKey,
  SortDirection,
  StatsFilters,
  StatsRange,
} from "@/types"

const ALL_VALUE = "__all__"

interface FilterSelectProps {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  className?: string
  includeAll?: boolean
  onChange: (value: string) => void
}

function FilterSelect({
  label,
  value,
  options,
  className,
  includeAll = true,
  onChange,
}: FilterSelectProps) {
  return (
    <Select
      value={value || ALL_VALUE}
      onValueChange={(nextValue) =>
        onChange(!nextValue || nextValue === ALL_VALUE ? "" : nextValue)
      }
    >
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue placeholder={label}>
          {(selectedValue) =>
            selectedValue === ALL_VALUE
              ? label
              : (options.find((option) => option.value === selectedValue)
                  ?.label ?? "…")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {includeAll ? (
            <SelectItem value={ALL_VALUE}>{label}</SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-40" />
          </CardContent>
        </Card>
      ))}
      <Card className="md:col-span-2 xl:col-span-4">
        <CardHeader>
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

export function App() {
  const { language, setLanguage, messages: t, format } = useI18n()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearch(searchParams), [searchParams])
  const sessionPage = useMemo(
    () => sessionPageFromSearch(searchParams),
    [searchParams]
  )
  const traceSelection = useMemo(
    () => sessionTraceFromSearch(searchParams),
    [searchParams]
  )
  const navigationLabels = {
    overview: t.overview,
    costs: t.costs,
    sessions: t.sessions,
    models: t.models,
    tools: t.tools,
    skills: t.skills,
  }
  const currentPage = dashboardPageFromPath(location.pathname)
  const currentPageLabel = currentPage ? navigationLabels[currentPage.id] : null

  useEffect(() => {
    document.title = currentPageLabel
      ? `${currentPageLabel} · ${t.pageTitle}`
      : t.pageTitle
  }, [currentPageLabel, t.pageTitle])

  useEffect(() => {
    if (!currentPage) return
    const canonicalSearch = dashboardSearchForPage(
      location.search,
      currentPage.id
    )
    if (canonicalSearch !== location.search)
      setSearchParams(canonicalSearch, { replace: true })
  }, [currentPage, location.search, setSearchParams])

  const {
    data,
    sessionsData,
    error,
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
  } = useStats(
    filters,
    sessionPage,
    currentPage?.id === "sessions" && !traceSelection
  )

  useEffect(() => {
    if (
      currentPage?.id !== "sessions" ||
      !sessionsData ||
      loadedSessionsRequest !== currentSessionsRequest ||
      sessionsData.page === sessionPage.page
    )
      return
    setSearchParams(
      (current) => withSessionPage(current, { page: sessionsData.page }),
      { replace: true }
    )
  }, [
    currentPage?.id,
    currentSessionsRequest,
    loadedSessionsRequest,
    sessionPage.page,
    sessionsData,
    setSearchParams,
  ])

  const rangeLabels: Record<StatsRange, string> = {
    today: t.today,
    "7d": t.last7Days,
    "30d": t.last30Days,
    "90d": t.last90Days,
    all: t.allTime,
  }
  const updateFilter = <Key extends keyof StatsFilters>(
    key: Key,
    value: StatsFilters[Key]
  ) => setSearchParams((current) => withFilter(current, key, value))

  const updateSessionSort = (sort: SessionSortKey, direction: SortDirection) =>
    setSearchParams((current) =>
      withSessionPage(current, { page: 1, sort, direction })
    )

  const handleHideModel = async (provider: string, model: string) => {
    const result = await hideModel(provider, model)
    if (!result) return
    setSearchParams((current) => {
      const selected = filtersFromSearch(current)
      const next = new URLSearchParams(current)
      const hidesSelectedPair =
        selected.provider === provider && selected.model === model
      next.delete("page")
      if (selected.project && !result.projects.includes(selected.project))
        next.delete("project")
      if (selected.provider && !result.providers.includes(selected.provider))
        next.delete("provider")
      if (
        selected.model &&
        (!result.models.includes(selected.model) || hidesSelectedPair)
      )
        next.delete("model")
      return next
    })
    await refresh()
  }

  if (!currentPage)
    return (
      <Navigate
        to={{
          pathname: dashboardPaths.overview,
          search: dashboardSearchForPage(location.search, "overview"),
        }}
        replace
      />
    )

  return (
    <main className="min-h-svh bg-background">
      <div className="trace-grid border-b">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <header className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div className="flex flex-col gap-3">
              <div
                aria-label={t.language}
                className="absolute top-0 right-0 flex items-center font-mono text-xs tracking-[0.12em] uppercase"
                role="group"
              >
                {Object.entries(catalogs).map(([value, catalog]) => (
                  <button
                    key={value}
                    type="button"
                    title={catalog.label}
                    aria-pressed={language === value}
                    className="cursor-pointer border-r px-2 text-muted-foreground transition-colors last:border-r-0 hover:text-foreground aria-pressed:text-primary aria-pressed:underline aria-pressed:underline-offset-4"
                    onClick={() => setLanguage(resolveLanguage(value))}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 font-mono text-xs tracking-[0.2em] text-primary uppercase">
                <TerminalSquareIcon className="size-4" />
                Pi / Stats
              </div>
              <div>
                <h1 className="text-3xl font-medium tracking-[-0.035em] sm:text-4xl">
                  {t.usageLog}
                </h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-8 items-center gap-2 rounded-lg border bg-card px-3 text-xs text-muted-foreground">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                {data?.meta.lastSyncAt
                  ? t.indexed(format.dateTime(data.meta.lastSyncAt))
                  : t.indexPending}
              </div>
              <Button
                variant="outline"
                onClick={() => void refresh()}
                disabled={isRefreshing || isLoading}
              >
                <RefreshCwIcon
                  data-icon="inline-start"
                  className={isRefreshing ? "animate-spin" : undefined}
                />
                {t.refresh}
              </Button>
              <Button onClick={() => void sync()} disabled={isSyncing}>
                <RotateCwIcon
                  data-icon="inline-start"
                  className={isSyncing ? "animate-spin" : undefined}
                />
                {t.sync}
              </Button>
            </div>
          </header>

          {currentPage.id !== "sessions" || !traceSelection ? (
            <Card size="sm" className="bg-card/90 backdrop-blur">
              <CardContent className="flex flex-wrap items-center gap-2">
                <FilterSelect
                  className="sm:w-48"
                  label={t.period}
                  value={filters.range}
                  includeAll={false}
                  onChange={(value) =>
                    updateFilter("range", value as StatsRange)
                  }
                  options={Object.entries(rangeLabels).map(
                    ([value, label]) => ({
                      value,
                      label,
                    })
                  )}
                />
                <FilterSelect
                  className="sm:w-48"
                  label={t.allProjects}
                  value={filters.project}
                  onChange={(value) => updateFilter("project", value)}
                  options={data?.options.projects ?? []}
                />
                <FilterSelect
                  className="sm:w-48"
                  label={t.allProviders}
                  value={filters.provider}
                  onChange={(value) => updateFilter("provider", value)}
                  options={(data?.options.providers ?? []).map((value) => ({
                    value,
                    label: value,
                  }))}
                />
                <FilterSelect
                  className="sm:w-48"
                  label={t.allModels}
                  value={filters.model}
                  onChange={(value) => updateFilter("model", value)}
                  options={(data?.options.models ?? []).map((value) => ({
                    value,
                    label: value,
                  }))}
                />
                <span className="ml-auto hidden font-mono text-xs text-muted-foreground lg:inline">
                  {data
                    ? t.indexSummary(
                        format.number(data.meta.indexedSessions),
                        data.meta.indexedSessions
                      )
                    : t.readingIndex}
                </span>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] px-4 pt-6 pb-24 sm:px-6 lg:px-8">
        {error ? (
          <div
            role="alert"
            className="mb-4 grid w-full grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-lg border bg-card px-2.5 py-2 text-sm text-destructive"
          >
            <AlertTriangleIcon className="size-4 translate-y-0.5" />
            <div className="font-medium">{t.statsUnavailable}</div>
            <div className="col-start-2 text-destructive/90">{error}</div>
          </div>
        ) : null}

        {isLoading && !data ? <DashboardSkeleton /> : null}

        {data ? (
          <div className="flex flex-col gap-8">
            <DashboardNavigation
              label={t.sectionsNavigation}
              labels={navigationLabels}
              search={location.search}
            />

            <Routes>
              <Route
                path={dashboardPaths.overview}
                element={
                  <OverviewPage
                    data={data}
                    rangeLabel={rangeLabels[filters.range]}
                    search={location.search}
                  />
                }
              />
              <Route
                path={dashboardPaths.costs}
                element={
                  <CostsPage
                    data={data}
                    rangeLabel={rangeLabels[filters.range]}
                  />
                }
              />
              <Route
                path={dashboardPaths.sessions}
                element={
                  <SessionsPage
                    data={data}
                    sessionsData={sessionsData}
                    sessionPage={sessionPage}
                    rangeLabel={rangeLabels[filters.range]}
                    isLoading={isSessionsLoading}
                    traceSelection={traceSelection}
                    onPageChange={(page) =>
                      setSearchParams((current) =>
                        withSessionPage(current, { page })
                      )
                    }
                    onSortChange={updateSessionSort}
                    onOpenTrace={(selection) =>
                      setSearchParams((current) =>
                        withSessionTrace(current, selection)
                      )
                    }
                    onCloseTrace={() =>
                      setSearchParams((current) =>
                        withSessionTrace(current, null)
                      )
                    }
                  />
                }
              />
              <Route
                path={dashboardPaths.models}
                element={
                  <ModelsPage
                    data={data}
                    hidingModel={hidingModel}
                    showingModel={showingModel}
                    onHide={handleHideModel}
                    onShow={showModel}
                  />
                }
              />
              <Route
                path={dashboardPaths.tools}
                element={
                  <ToolsPage
                    data={data}
                    rangeLabel={rangeLabels[filters.range]}
                  />
                }
              />
              <Route
                path={dashboardPaths.skills}
                element={
                  <SkillsPage
                    data={data}
                    rangeLabel={rangeLabels[filters.range]}
                  />
                }
              />
            </Routes>
          </div>
        ) : null}
      </div>
    </main>
  )
}

export default App
