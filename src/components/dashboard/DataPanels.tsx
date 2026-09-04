import { Fragment, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BookOpenIcon,
  BoxIcon,
  EyeIcon,
  EyeOffIcon,
  WrenchIcon,
} from "lucide-react"

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
import { useI18n } from "@/lib/i18n"
import type {
  SessionSortKey,
  SessionSummary,
  SortDirection,
  StatsResponse,
} from "@/types"

type EmptyKind = "model" | "session" | "tool" | "skill"

function EmptyRows({ kind }: { kind: EmptyKind }) {
  const { messages: t } = useI18n()
  const Icon =
    kind === "tool" ? WrenchIcon : kind === "skill" ? BookOpenIcon : BoxIcon
  const title = {
    model: t.noRequests,
    session: t.noSessions,
    tool: t.noTools,
    skill: t.noSkills,
  }[kind]

  return (
    <div className="flex min-h-56 w-full flex-col items-center justify-center gap-2 rounded-xl p-6 text-center text-balance">
      <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-4">
        <Icon />
      </div>
      <div className="font-heading text-sm font-medium tracking-tight">
        {title}
      </div>
      <div className="text-sm/relaxed text-muted-foreground">
        {t.filteredData}
      </div>
    </div>
  )
}

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
                    <div
                      className="max-w-80 truncate font-medium"
                      title={sessionName}
                    >
                      {sessionName}
                    </div>
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
