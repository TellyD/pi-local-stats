import { ActivityIcon, BoxIcon, CoinsIcon, SparklesIcon } from "lucide-react"

import { SessionsTable } from "@/components/dashboard/SessionsTable"
import { MetricCard } from "@/components/dashboard/MetricCard"
import { SessionTrace } from "@/components/dashboard/SessionTrace"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSessionTrace } from "@/hooks/use-stats"
import { useI18n } from "@/lib/i18n"
import type { SessionTraceSelection } from "@/lib/dashboard-url"
import type {
  SessionPageOptions,
  SessionsResponse,
  SessionSortKey,
  SortDirection,
  StatsResponse,
} from "@/types"

export function SessionsPage({
  data,
  sessionsData,
  sessionPage,
  rangeLabel,
  isLoading,
  traceSelection,
  onPageChange,
  onSortChange,
  onOpenTrace,
  onCloseTrace,
}: {
  data: StatsResponse
  sessionsData: SessionsResponse | null
  sessionPage: SessionPageOptions
  rangeLabel: string
  isLoading: boolean
  traceSelection: SessionTraceSelection | null
  onPageChange: (page: number) => void
  onSortChange: (sort: SessionSortKey, direction: SortDirection) => void
  onOpenTrace: (selection: SessionTraceSelection) => void
  onCloseTrace: () => void
}) {
  const { messages: t, format } = useI18n()
  const trace = useSessionTrace(traceSelection, data.meta.lastSyncAt)
  const sessionCount = sessionsData?.total ?? 0
  const averagePerSession = (value: number) =>
    sessionCount > 0 ? value / sessionCount : 0

  if (traceSelection)
    return (
      <SessionTrace
        key={JSON.stringify(traceSelection)}
        data={trace.data}
        error={trace.error}
        isLoading={trace.isLoading}
        onBack={onCloseTrace}
      />
    )

  return (
    <div className="flex flex-col gap-4">
      {sessionsData ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={t.sessions}
            value={format.number(sessionCount)}
            detail={rangeLabel}
            icon={BoxIcon}
          />
          <MetricCard
            label={t.averageRequestsPerSession}
            value={format.number(averagePerSession(data.overview.requests))}
            detail={t.requestCount(
              format.compact(data.overview.requests),
              data.overview.requests
            )}
            icon={ActivityIcon}
          />
          <MetricCard
            label={t.averageTokensPerSession}
            value={format.compact(averagePerSession(data.overview.totalTokens))}
            detail={t.tokenCount(
              format.compact(data.overview.totalTokens),
              data.overview.totalTokens
            )}
            icon={SparklesIcon}
          />
          <MetricCard
            label={t.averageCostPerSession}
            value={format.currency(averagePerSession(data.overview.cost))}
            detail={`${format.currency(data.overview.cost)} · ${t.apiEquivalent}`}
            icon={CoinsIcon}
          />
        </div>
      ) : null}
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
              isLoading={isLoading}
              onPageChange={onPageChange}
              onSortChange={onSortChange}
              onOpenTrace={onOpenTrace}
            />
          ) : (
            <Skeleton className="h-56 w-full" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
