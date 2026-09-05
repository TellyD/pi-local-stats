import { Fragment, useState } from "react"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react"

import { EmptyRows } from "@/components/dashboard/EmptyRows"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Pagination } from "@/components/ui/pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { SessionTraceSelection } from "@/lib/dashboard-url"
import { useI18n } from "@/lib/i18n"
import type { SessionSortKey, SessionSummary, SortDirection } from "@/types"

export function SessionAgents({ row }: { row: SessionSummary }) {
  const { messages: t, format } = useI18n()
  const precisionLabel = (coverage: string, precision: string) =>
    coverage === "partial"
      ? t.agentPrecisionPartial
      : coverage === "unknown" || precision === "unknown"
        ? t.agentPrecisionUnknown
        : precision === "exact"
          ? t.agentPrecisionExact
          : precision === "reported"
            ? t.agentPrecisionReported
            : t.agentPrecisionEstimated

  return (
    <div className="flex flex-col gap-2">
      {row.accounting.unassignedTokens !== null ||
      row.accounting.unassignedCost !== null ? (
        <div className="text-xs text-muted-foreground">
          {t.unassignedAgentUsage(
            row.accounting.unassignedTokens === null
              ? "—"
              : format.compact(row.accounting.unassignedTokens),
            row.accounting.unassignedCost === null
              ? "—"
              : format.currency(row.accounting.unassignedCost)
          )}
        </div>
      ) : null}
      {row.agents.map((agent) => (
        <div
          key={agent.key}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2"
          style={{ marginLeft: `${Math.max(0, agent.depth - 1) * 16}px` }}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium capitalize">
                {agent.displayName || agent.type || agent.name || t.agent}
              </span>
              <code className="text-xs text-muted-foreground">
                {agent.id.slice(0, 8)}
              </code>
              <Badge variant="outline">{agent.statusRaw || agent.status}</Badge>
              <Badge
                variant="secondary"
                title={agent.provenance.channels.join(", ")}
              >
                {precisionLabel(agent.usage.coverage, agent.precision.tokens)}
              </Badge>
              {agent.models.map((model) => (
                <Badge key={model} variant="secondary">
                  {model}
                </Badge>
              ))}
              {!agent.models.length && agent.modelLabel ? (
                <Badge variant="outline">{agent.modelLabel}</Badge>
              ) : null}
            </div>
            {agent.description ? (
              <div
                className="mt-1 max-w-2xl truncate text-xs text-muted-foreground"
                title={agent.description}
              >
                {agent.description}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              {agent.requests !== null && agent.tokens !== null
                ? t.requestsAndTokens(
                    format.number(agent.requests),
                    agent.requests,
                    format.compact(agent.tokens),
                    agent.tokens
                  )
                : agent.tokens !== null
                  ? t.tokenCount(format.compact(agent.tokens), agent.tokens)
                  : t.agentUsageUnavailable}
            </span>
            <span className="font-mono font-medium text-foreground tabular-nums">
              {agent.cost === null
                ? t.agentCostUnavailable
                : format.currency(agent.cost)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function SessionsTable({
  rows,
  total,
  page,
  pageSize,
  sort,
  direction,
  isLoading,
  onPageChange,
  onSortChange,
  onOpenTrace,
}: {
  rows: SessionSummary[]
  total: number
  page: number
  pageSize: number
  sort: SessionSortKey
  direction: SortDirection
  isLoading: boolean
  onPageChange: (page: number) => void
  onSortChange: (sort: SessionSortKey, direction: SortDirection) => void
  onOpenTrace: (selection: SessionTraceSelection) => void
}) {
  const { messages: t, format } = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  if (total === 0) return <EmptyRows kind="session" />

  const pageCount = Math.ceil(total / pageSize)
  const columns: Array<{
    key: SessionSortKey
    label: string
    numeric?: boolean
  }> = [
    { key: "name", label: t.session },
    { key: "startedAt", label: t.date },
    { key: "project", label: t.project },
    { key: "models", label: t.models },
    { key: "requests", label: t.requests, numeric: true },
    { key: "tokens", label: t.tokens, numeric: true },
    { key: "cost", label: t.apiEquivalent, numeric: true },
  ]

  return (
    <>
      <Table aria-busy={isLoading}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => {
              const active = sort === column.key
              const SortIcon = !active
                ? ArrowUpDownIcon
                : direction === "asc"
                  ? ArrowUpIcon
                  : ArrowDownIcon
              return (
                <TableHead
                  key={column.key}
                  aria-sort={
                    active
                      ? direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={column.numeric ? "text-right" : undefined}
                >
                  <button
                    type="button"
                    className={`flex w-full cursor-pointer items-center gap-1 hover:text-primary ${column.numeric ? "justify-end" : ""}`}
                    aria-label={t.sortBy(column.label)}
                    onClick={() =>
                      onSortChange(
                        column.key,
                        active && direction === "asc" ? "desc" : "asc"
                      )
                    }
                  >
                    {column.label}
                    <SortIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const rowKey = `${row.project}:${row.id}`
            const hasAccountingDetails =
              row.agents.length > 0 ||
              row.accounting.unassignedTokens !== null ||
              row.accounting.unassignedCost !== null
            const isExpanded = hasAccountingDetails && expanded.has(rowKey)
            const sessionName = row.name || t.unnamedSession
            return (
              <Fragment key={rowKey}>
                <TableRow>
                  <TableCell>
                    <button
                      type="button"
                      className="block max-w-80 cursor-pointer truncate text-left font-medium hover:text-primary hover:underline hover:underline-offset-4"
                      aria-label={t.openSessionTrace(sessionName)}
                      title={t.openSessionTrace(sessionName)}
                      onClick={() =>
                        onOpenTrace({ id: row.id, project: row.project })
                      }
                    >
                      {sessionName}
                    </button>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-muted-foreground">
                        {row.id.slice(0, 8)}
                      </code>
                      {row.accounting.coverage !== "complete" ? (
                        <Badge variant="outline">
                          {row.accounting.coverage === "partial"
                            ? t.agentPrecisionPartial
                            : t.agentPrecisionUnknown}
                        </Badge>
                      ) : null}
                      {hasAccountingDetails ? (
                        <Button
                          variant="ghost"
                          className="h-6 px-1.5 text-xs text-primary"
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? t.hideAgentCosts(sessionName)
                              : t.showAgentCosts(sessionName)
                          }
                          title={
                            isExpanded
                              ? t.hideAgentCosts(sessionName)
                              : t.showAgentCosts(sessionName)
                          }
                          onClick={() =>
                            setExpanded((current) => {
                              const next = new Set(current)
                              if (next.has(rowKey)) next.delete(rowKey)
                              else next.add(rowKey)
                              return next
                            })
                          }
                        >
                          {row.agents.length > 0 ? (
                            <>
                              {isExpanded ? t.hideAgents : t.showAgents} (
                              {format.number(row.agents.length)})
                            </>
                          ) : isExpanded ? (
                            t.hideAccountingDetails
                          ) : (
                            t.showAccountingDetails
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {format.dateTime(row.startedAt)}
                  </TableCell>
                  <TableCell title={row.project}>
                    {row.label || t.noProject}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.models.length > 0
                        ? row.models.map((model) => (
                            <Badge key={model} variant="secondary">
                              {model}
                            </Badge>
                          ))
                        : "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {format.number(row.requests)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {format.compact(row.tokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {format.currency(row.cost)}
                  </TableCell>
                </TableRow>
                {isExpanded ? (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={7} className="p-3 pl-4">
                      <SessionAgents row={row} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
      <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={onPageChange}
        disabled={isLoading}
        labels={{
          navigation: t.pagination,
          previous: t.previousPage,
          next: t.nextPage,
          page: t.pageStatus,
        }}
      />
    </>
  )
}
