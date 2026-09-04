import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { chartTooltip } from "@/components/dashboard/ChartTooltipContent"
import { useI18n } from "@/lib/i18n"
import type { StatsResponse } from "@/types"

export function ActivityChart({ data }: { data: StatsResponse["timeseries"] }) {
  const { messages: t, format } = useI18n()

  return (
    <div className="h-72 w-full text-xs">
      <ResponsiveContainer initialDimension={{ width: 320, height: 200 }}>
        <AreaChart data={data} margin={{ left: 0, right: 4, top: 12 }}>
          <defs>
            <linearGradient id="requests-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop
                offset="95%"
                stopColor="var(--chart-1)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
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
            width={42}
            allowDecimals={false}
            tick={{ fill: "var(--muted-foreground)" }}
            tickFormatter={format.number}
          />
          <Tooltip
            cursor={false}
            content={({ active, payload }) =>
              active && payload?.length
                ? chartTooltip(
                    format.day(String(payload[0]?.payload.date ?? "")),
                    t.requests,
                    format.number(Number(payload[0]?.value))
                  )
                : null
            }
          />
          <Area
            dataKey="requests"
            type="monotone"
            fill="url(#requests-fill)"
            stroke="var(--chart-1)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
