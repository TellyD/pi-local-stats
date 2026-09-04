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

export function CostChart({ data }: { data: StatsResponse["timeseries"] }) {
  const { messages: t, format } = useI18n()

  return (
    <div className="h-96 w-full text-xs">
      <ResponsiveContainer initialDimension={{ width: 320, height: 200 }}>
        <BarChart data={data} margin={{ left: 4, right: 8, top: 16 }}>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={28}
            tick={{ fill: "var(--muted-foreground)" }}
            tickFormatter={format.day}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={72}
            tick={{ fill: "var(--muted-foreground)" }}
            tickFormatter={(value: number) => format.currency(value)}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) =>
              active && payload?.length
                ? chartTooltip(
                    format.day(String(payload[0]?.payload.date ?? "")),
                    t.apiEquivalent,
                    format.currency(Number(payload[0]?.value))
                  )
                : null
            }
          />
          <Bar
            dataKey="cost"
            fill="var(--chart-1)"
            radius={[5, 5, 0, 0]}
            maxBarSize={42}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
