import { ActivityIcon, CoinsIcon, ZapIcon } from "lucide-react"

import { CostChart } from "@/components/dashboard/CostChart"
import { MetricCard } from "@/components/dashboard/MetricCard"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"
import type { StatsResponse } from "@/types"

export function CostsPage({
  data,
  rangeLabel,
}: {
  data: StatsResponse
  rangeLabel: string
}) {
  const { messages: t, format } = useI18n()
  const activeCostDays = data.timeseries.filter((point) => point.cost > 0)
  const averageDailyCost = activeCostDays.length
    ? activeCostDays.reduce((total, point) => total + point.cost, 0) /
      activeCostDays.length
    : 0
  const peakCostDay = activeCostDays.reduce<
    (typeof activeCostDays)[number] | null
  >((peak, point) => (!peak || point.cost > peak.cost ? point : peak), null)

  return (
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
          detail={peakCostDay ? format.day(peakCostDay.date) : t.noActivity}
          icon={ZapIcon}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t.apiEquivalentPerDay}</CardTitle>
          <CardDescription>{t.costEstimate}</CardDescription>
          <CardAction>
            <Badge variant="outline">{rangeLabel}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <CostChart data={data.timeseries} />
        </CardContent>
      </Card>
    </div>
  )
}
