import { useEffect, useMemo } from "react"
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  Clock3Icon,
  CoinsIcon,
  DatabaseIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SparklesIcon,
  TerminalSquareIcon,
  ZapIcon,
} from "lucide-react"
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router"

import { ActivityChart } from "@/components/dashboard/ActivityChart"
import { CostChart } from "@/components/dashboard/CostChart"
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation"
import {
  ModelsTable,
  SessionsTable,
  SkillsTable,
  ToolsTable,
} from "@/components/dashboard/DataPanels"
import { MetricCard } from "@/components/dashboard/MetricCard"
import { ModelChart } from "@/components/dashboard/ModelChart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  withFilter,
  withSessionPage,
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
                  ?.label ?? selectedValue)
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
  } = useStats(filters, sessionPage)

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
  const activeCostDays =
    data?.timeseries.filter((point) => point.cost > 0) ?? []
  const averageDailyCost =
    activeCostDays.length > 0
      ? activeCostDays.reduce((total, point) => total + point.cost, 0) /
        activeCostDays.length
      : 0
  const peakCostDay = activeCostDays.reduce<
    (typeof activeCostDays)[number] | null
  >((peak, point) => (!peak || point.cost > peak.cost ? point : peak), null)

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

          <Card size="sm" className="bg-card/90 backdrop-blur">
            <CardContent className="flex flex-wrap items-center gap-2">
              <FilterSelect
                className="sm:w-48"
                label={t.period}
                value={filters.range}
                includeAll={false}
                onChange={(value) => updateFilter("range", value as StatsRange)}
                options={Object.entries(rangeLabels).map(([value, label]) => ({
                  value,
                  label,
                }))}
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
                  <div className="flex flex-col gap-4">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <MetricCard
                        label={t.apiEquivalent}
                        value={format.currency(data.overview.cost)}
                        detail={t.perRequest(
                          format.currency(
                            data.overview.requests
                              ? data.overview.cost / data.overview.requests
                              : 0
                          )
                        )}
                        icon={CoinsIcon}
                      />
                      <MetricCard
                        label={t.tokens}
                        value={format.compact(data.overview.totalTokens)}
                        detail={t.requestCount(
                          format.compact(data.overview.requests),
                          data.overview.requests
                        )}
                        icon={SparklesIcon}
                      />
                      <MetricCard
                        label={t.cache}
                        value={format.percent(data.overview.cacheRate)}
                        detail={t.tokensRead(
                          format.compact(data.overview.cacheReadTokens),
                          data.overview.cacheReadTokens
                        )}
                        icon={DatabaseIcon}
                      />
                      <MetricCard
                        label={t.averageDuration}
                        value={format.duration(data.overview.averageDurationMs)}
                        detail={t.errorPercentage(
                          format.percent(data.overview.errorRate)
                        )}
                        icon={Clock3Icon}
                      />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]">
                      <Card>
                        <CardHeader>
                          <CardTitle>{t.activitySignal}</CardTitle>
                          <CardDescription>{t.dailyRequests}</CardDescription>
                          <CardAction>
                            <Badge variant="outline">
                              {rangeLabels[filters.range]}
                            </Badge>
                          </CardAction>
                        </CardHeader>
                        <CardContent>
                          <ActivityChart data={data.timeseries} />
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>{t.modelFootprint}</CardTitle>
                          <CardDescription>{t.tokensByModel}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ModelChart data={data.models} />
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                      <Card>
                        <CardHeader>
                          <CardTitle>{t.activeProjects}</CardTitle>
                          <CardDescription>
                            {t.projectDistribution}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                          {data.projects.slice(0, 5).map((project, index) => (
                            <div key={project.project}>
                              {index > 0 ? (
                                <hr className="mb-3 border-0 border-t" />
                              ) : null}
                              <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="truncate font-medium">
                                    {project.label || t.noProject}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {t.sessionsAndTokens(
                                      format.number(project.sessions),
                                      project.sessions,
                                      format.compact(project.tokens),
                                      project.tokens
                                    )}
                                  </p>
                                </div>
                                <span className="font-mono text-sm tabular-nums">
                                  {format.currency(project.cost)}
                                </span>
                              </div>
                            </div>
                          ))}
                          <div className="flex justify-end border-t pt-3">
                            <Link
                              to={{
                                pathname: dashboardPaths.sessions,
                                search: dashboardSearchForPage(
                                  location.search,
                                  "sessions"
                                ),
                              }}
                              className="inline-flex h-7 items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              {t.sessions}
                              <ArrowRightIcon
                                aria-hidden="true"
                                className="size-4"
                              />
                            </Link>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>{t.mostUsedSkills}</CardTitle>
                          <CardDescription>{t.skillUsageRule}</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                          {data.skills.slice(0, 6).map((skill, index) => (
                            <div key={skill.name}>
                              {index > 0 ? (
                                <hr className="mb-3 border-0 border-t" />
                              ) : null}
                              <div className="flex items-center justify-between gap-4">
                                <code className="truncate text-xs text-foreground">
                                  {skill.name}
                                </code>
                                <span className="font-mono text-sm text-foreground tabular-nums">
                                  {format.number(skill.uses)}
                                </span>
                              </div>
                            </div>
                          ))}
                          <div className="flex justify-end border-t pt-3">
                            <Link
                              to={{
                                pathname: dashboardPaths.skills,
                                search: dashboardSearchForPage(
                                  location.search,
                                  "skills"
                                ),
                              }}
                              className="inline-flex h-7 items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              {t.skills}
                              <ArrowRightIcon
                                aria-hidden="true"
                                className="size-4"
                              />
                            </Link>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>{t.providers}</CardTitle>
                          <CardDescription>
                            {t.trafficDistribution}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                          {data.providers.slice(0, 5).map((provider, index) => (
                            <div key={provider.provider}>
                              {index > 0 ? (
                                <hr className="mb-3 border-0 border-t" />
                              ) : null}
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <p className="font-medium">
                                    {provider.provider}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {t.requestsAndTokens(
                                      format.number(provider.requests),
                                      provider.requests,
                                      format.compact(provider.tokens),
                                      provider.tokens
                                    )}
                                  </p>
                                </div>
                                <span className="font-mono text-sm tabular-nums">
                                  {format.currency(provider.cost)}
                                </span>
                              </div>
                            </div>
                          ))}
                          <div className="flex justify-end border-t pt-3">
                            <Link
                              to={{
                                pathname: dashboardPaths.models,
                                search: dashboardSearchForPage(
                                  location.search,
                                  "models"
                                ),
                              }}
                              className="inline-flex h-7 items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              {t.models}
                              <ArrowRightIcon
                                aria-hidden="true"
                                className="size-4"
                              />
                            </Link>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                }
              />

              <Route
                path={dashboardPaths.costs}
                element={
                  <div className="flex flex-col gap-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <MetricCard
                        label={t.apiEquivalent}
                        value={format.currency(data.overview.cost)}
                        detail={t.catalogRates}
                        icon={CoinsIcon}
                      />
                      <MetricCard
                        label={t.averagePerActiveDay}
                        value={format.currency(averageDailyCost)}
                        detail={t.activeDays(
                          format.number(activeCostDays.length),
                          activeCostDays.length
                        )}
                        icon={ActivityIcon}
                      />
                      <MetricCard
                        label={t.dailyPeak}
                        value={format.currency(peakCostDay?.cost ?? 0)}
                        detail={
                          peakCostDay
                            ? format.day(peakCostDay.date)
                            : t.noActivity
                        }
                        icon={ZapIcon}
                      />
                    </div>
                    <Card>
                      <CardHeader>
                        <CardTitle>{t.apiEquivalentPerDay}</CardTitle>
                        <CardDescription>{t.costEstimate}</CardDescription>
                        <CardAction>
                          <Badge variant="outline">
                            {rangeLabels[filters.range]}
                          </Badge>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        <CostChart data={data.timeseries} />
                      </CardContent>
                    </Card>
                  </div>
                }
              />

              <Route
                path={dashboardPaths.sessions}
                element={
                  <Card>
                    <CardHeader>
                      <CardTitle>{t.costBySession}</CardTitle>
                      <CardDescription>{t.sessionCostDetails}</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      {sessionsData ? (
                        <SessionsTable
                          rows={sessionsData.rows}
                          total={sessionsData.total}
                          page={sessionsData.page}
                          pageSize={sessionsData.pageSize}
                          sort={sessionPage.sort}
                          direction={sessionPage.direction}
                          isLoading={isSessionsLoading}
                          onPageChange={(page) =>
                            setSearchParams((current) =>
                              withSessionPage(current, { page })
                            )
                          }
                          onSortChange={updateSessionSort}
                        />
                      ) : (
                        <Skeleton className="h-56 w-full" />
                      )}
                    </CardContent>
                  </Card>
                }
              />

              <Route
                path={dashboardPaths.models}
                element={
                  <Card>
                    <CardHeader>
                      <CardTitle>{t.models}</CardTitle>
                      <CardDescription>{t.modelDetails}</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <ModelsTable
                        rows={data.models}
                        hiddenRows={data.hiddenModels}
                        hidingModel={hidingModel}
                        showingModel={showingModel}
                        onHide={handleHideModel}
                        onShow={showModel}
                      />
                    </CardContent>
                  </Card>
                }
              />

              <Route
                path={dashboardPaths.tools}
                element={
                  <Card>
                    <CardHeader>
                      <CardTitle>{t.tools}</CardTitle>
                      <CardDescription>{t.toolDetails}</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <ToolsTable rows={data.tools} />
                    </CardContent>
                  </Card>
                }
              />

              <Route
                path={dashboardPaths.skills}
                element={
                  <Card>
                    <CardHeader>
                      <CardTitle>{t.mostUsedSkills}</CardTitle>
                      <CardDescription>{t.skillDetails}</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <SkillsTable rows={data.skills} />
                    </CardContent>
                  </Card>
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
