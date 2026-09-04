import {
  ArrowRightIcon,
  Clock3Icon,
  CoinsIcon,
  DatabaseIcon,
  SparklesIcon,
} from "lucide-react"
import { Link } from "react-router"

import { ActivityChart } from "@/components/dashboard/ActivityChart"
import { MetricCard } from "@/components/dashboard/MetricCard"
import { ModelChart } from "@/components/dashboard/ModelChart"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { dashboardPaths, dashboardSearchForPage } from "@/lib/dashboard-url"
import { useI18n } from "@/lib/i18n"
import type { StatsResponse } from "@/types"

export function OverviewPage({
  data,
  rangeLabel,
  search,
}: {
  data: StatsResponse
  rangeLabel: string
  search: string
}) {
  const { messages: t, format } = useI18n()

  return (
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
          detail={t.errorPercentage(format.percent(data.overview.errorRate))}
          icon={Clock3Icon}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t.activitySignal}</CardTitle>
            <CardDescription>{t.dailyRequests}</CardDescription>
            <CardAction>
              <Badge variant="outline">{rangeLabel}</Badge>
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
            <CardDescription>{t.projectDistribution}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.projects.slice(0, 5).map((project, index) => (
              <div key={project.project}>
                {index > 0 ? <hr className="mb-3 border-0 border-t" /> : null}
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
                  search: dashboardSearchForPage(search, "sessions"),
                }}
                className="inline-flex h-7 items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
              >
                {t.sessions}
                <ArrowRightIcon aria-hidden="true" className="size-4" />
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
                {index > 0 ? <hr className="mb-3 border-0 border-t" /> : null}
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
                  search: dashboardSearchForPage(search, "skills"),
                }}
                className="inline-flex h-7 items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
              >
                {t.skills}
                <ArrowRightIcon aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t.providers}</CardTitle>
            <CardDescription>{t.trafficDistribution}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.providers.slice(0, 5).map((provider, index) => (
              <div key={provider.provider}>
                {index > 0 ? <hr className="mb-3 border-0 border-t" /> : null}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{provider.provider}</p>
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
                  search: dashboardSearchForPage(search, "models"),
                }}
                className="inline-flex h-7 items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
              >
                {t.models}
                <ArrowRightIcon aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
