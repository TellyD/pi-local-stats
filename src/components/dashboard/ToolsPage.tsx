import {
  ActivityIcon,
  AlertTriangleIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react"

import { ToolsTable } from "@/components/dashboard/DataPanels"
import { MetricCard } from "@/components/dashboard/MetricCard"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"
import type { StatsResponse } from "@/types"

export function ToolsPage({
  data,
  rangeLabel,
}: {
  data: StatsResponse
  rangeLabel: string
}) {
  const { messages: t, format } = useI18n()
  const toolCalls = data.tools.reduce((total, tool) => total + tool.calls, 0)
  const toolErrors = data.tools.reduce((total, tool) => total + tool.errors, 0)
  const topTool = data.tools.toSorted(
    (left, right) => right.calls - left.calls
  )[0]
  const topToolShare = topTool && toolCalls ? topTool.calls / toolCalls : 0

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t.activeTools}
          value={format.number(data.tools.length)}
          detail={rangeLabel}
          icon={WrenchIcon}
        />
        <MetricCard
          label={t.calls}
          value={format.compact(toolCalls)}
          detail={t.averageCallsPerTool(
            format.number(toolCalls / Math.max(data.tools.length, 1))
          )}
          icon={ActivityIcon}
        />
        <MetricCard
          label={t.topTool}
          value={format.percent(topToolShare)}
          detail={topTool?.name ?? t.noActivity}
          icon={ZapIcon}
        />
        <MetricCard
          label={t.errorRate}
          value={format.percent(toolCalls > 0 ? toolErrors / toolCalls : 0)}
          detail={t.errorCount(format.number(toolErrors), toolErrors)}
          icon={AlertTriangleIcon}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t.tools}</CardTitle>
          <CardDescription>{t.toolDetails}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <ToolsTable rows={data.tools} />
        </CardContent>
      </Card>
    </div>
  )
}
