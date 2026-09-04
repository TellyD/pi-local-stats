import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { chartTooltip } from "@/components/dashboard/ChartTooltipContent"
import { useI18n } from "@/lib/i18n"
import type { StatsResponse } from "@/types"

export function ModelChart({ data }: { data: StatsResponse["models"] }) {
  const { messages: t, format } = useI18n()
  const chartData = data.slice(0, 7).map((item) => ({
    ...item,
    shortModel:
      item.model.length > 24 ? `${item.model.slice(0, 22)}…` : item.model,
  }))

  return (
    <div className="h-72 w-full text-xs">
      <ResponsiveContainer initialDimension={{ width: 320, height: 200 }}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ left: 10, right: 12 }}
        >
          <CartesianGrid
            horizontal={false}
            stroke="var(--border)"
            strokeDasharray="3 5"
          />
          <XAxis
            type="number"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)" }}
            tickFormatter={format.compact}
          />
          <YAxis
            dataKey="shortModel"
            type="category"
            axisLine={false}
            tickLine={false}
            width={132}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) =>
              active && payload?.length
                ? chartTooltip(
                    String(payload[0]?.payload.model ?? ""),
                    t.tokens,
                    format.compact(Number(payload[0]?.value))
                  )
                : null
            }
          />
          <Bar dataKey="tokens" fill="var(--chart-3)" radius={[0, 5, 5, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
