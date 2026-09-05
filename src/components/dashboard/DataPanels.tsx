import { EyeIcon, EyeOffIcon } from "lucide-react"

import { EmptyRows } from "@/components/dashboard/EmptyRows"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useI18n } from "@/lib/i18n"
import type { StatsResponse } from "@/types"

export { SessionAgents, SessionsTable } from "./SessionsTable.tsx"

export function ModelsTable({
  rows,
  hiddenRows,
  hidingModel,
  showingModel,
  onHide,
  onShow,
}: {
  rows: StatsResponse["models"]
  hiddenRows: StatsResponse["hiddenModels"]
  hidingModel: { provider: string; model: string } | null
  showingModel: { provider: string; model: string } | null
  onHide: (provider: string, model: string) => Promise<void>
  onShow: (provider: string, model: string) => Promise<void>
}) {
  const { messages: t, format } = useI18n()
  if (rows.length === 0 && hiddenRows.length === 0)
    return <EmptyRows kind="model" />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.model}</TableHead>
          <TableHead>{t.provider}</TableHead>
          <TableHead className="text-right">{t.requests}</TableHead>
          <TableHead className="text-right">{t.tokens}</TableHead>
          <TableHead className="text-right">{t.cache}</TableHead>
          <TableHead className="text-right">{t.apiEquivalent}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{t.hideModel(t.model)}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.provider}/${row.model}`}>
            <TableCell className="font-medium">{row.model}</TableCell>
            <TableCell>
              <Badge variant="secondary">{row.provider}</Badge>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {format.number(row.requests)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {format.compact(row.tokens)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {format.percent(row.cacheRate)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {format.currency(row.cost)}
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.hideModel(row.model)}
                title={t.hideModel(row.model)}
                disabled={
                  hidingModel?.provider === row.provider &&
                  hidingModel.model === row.model
                }
                onClick={() => {
                  if (
                    window.confirm(t.confirmHideModel(row.model, row.provider))
                  )
                    void onHide(row.provider, row.model)
                }}
              >
                <EyeOffIcon />
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {hiddenRows.map((row) => (
          <TableRow
            key={`hidden:${row.provider}/${row.model}`}
            className="text-muted-foreground"
          >
            <TableCell className="font-medium">{row.model}</TableCell>
            <TableCell>
              <Badge variant="secondary">{row.provider}</Badge>
            </TableCell>
            <TableCell colSpan={4}>
              <Badge variant="outline">{t.hiddenFromStats}</Badge>
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.showModel(row.model)}
                title={t.showModel(row.model)}
                disabled={
                  showingModel?.provider === row.provider &&
                  showingModel.model === row.model
                }
                onClick={() => void onShow(row.provider, row.model)}
              >
                <EyeIcon />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function ToolsTable({ rows }: { rows: StatsResponse["tools"] }) {
  const { messages: t, format } = useI18n()
  if (rows.length === 0) return <EmptyRows kind="tool" />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.tool}</TableHead>
          <TableHead className="text-right">{t.calls}</TableHead>
          <TableHead className="text-right">{t.errors}</TableHead>
          <TableHead className="text-right">{t.errorRate}</TableHead>
          <TableHead className="text-right">{t.averageDuration}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell>
              <code className="rounded-md bg-muted px-2 py-1 text-xs">
                {row.name}
              </code>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {format.number(row.calls)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {format.number(row.errors)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {format.percent(row.errorRate)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {format.duration(row.averageDurationMs)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function SkillsTable({ rows }: { rows: StatsResponse["skills"] }) {
  const { messages: t, format } = useI18n()
  if (rows.length === 0) return <EmptyRows kind="skill" />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.skills}</TableHead>
          <TableHead className="text-right">{t.uses}</TableHead>
          <TableHead className="text-right">{t.sessions}</TableHead>
          <TableHead>{t.models}</TableHead>
          <TableHead className="text-right">{t.lastUsed}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell>
              <code className="rounded-md bg-muted px-2 py-1 text-xs">
                {row.name}
              </code>
            </TableCell>
            <TableCell className="text-right font-mono font-medium tabular-nums">
              {format.number(row.uses)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {format.number(row.sessions)}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {row.models.map((model) => (
                  <Badge key={model.model} variant="secondary">
                    {model.model} · {format.number(model.uses)}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell className="text-right whitespace-nowrap text-muted-foreground">
              {format.dateTime(row.lastUsed)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
