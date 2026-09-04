import type { ComponentType } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface MetricCardProps {
  label: string
  value: string
  detail: string
  icon: ComponentType
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: MetricCardProps) {
  return (
    <Card className="relative overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-primary/70">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
        <CardTitle className="font-mono text-[0.6875rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
          {label}
        </CardTitle>
        <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">
          <Icon />
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="font-mono text-2xl font-medium tracking-tight tabular-nums">
          {value}
        </div>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}
