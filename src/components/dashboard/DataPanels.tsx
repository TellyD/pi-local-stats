import { Menu } from "@base-ui/react/menu"
import { EllipsisIcon, EyeIcon, EyeOffIcon, Trash2Icon } from "lucide-react"

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

function ModelIdentity({
  model,
  provider,
}: {
  model: string
  provider: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${modelDotClass(model)}`}
      />
      <div className="min-w-0">
        <div className="font-medium break-words">{model}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{provider}</div>
      </div>
    </div>
  )
}

function ModelActions({
  model,
  provider,
  hidden = false,
  disabled,
  onToggle,
  onDelete,
}: {
  model: string
  provider: string
  hidden?: boolean
  disabled: boolean
  onToggle: () => Promise<void>
  onDelete: () => Promise<void>
}) {
  const { messages: t } = useI18n()
  const label = `${t.modelActions}: ${model} (${provider})`

  return (
    <Menu.Root>
      <Menu.Trigger
        render={<Button variant="ghost" size="icon-sm" />}
        aria-label={label}
        title={label}
        disabled={disabled}
      >
        <EllipsisIcon />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4} className="z-50">
          <Menu.Popup className="max-w-[calc(100vw-2rem)] min-w-48 rounded-lg border bg-card p-1 text-sm text-card-foreground shadow-md outline-none">
            <Menu.Item
              disabled={disabled}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-disabled:opacity-50 data-highlighted:bg-muted"
              onClick={() => {
                if (
                  hidden ||
                  window.confirm(t.confirmHideModel(model, provider))
                )
                  void onToggle()
              }}
            >
              {hidden ? (
                <EyeIcon className="size-4 shrink-0" />
              ) : (
                <EyeOffIcon className="size-4 shrink-0" />
              )}
              {hidden ? t.showModel(model) : t.hideModel(model)}
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-border/60" />
            <Menu.Item
              disabled={disabled}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-destructive outline-none data-disabled:opacity-50 data-highlighted:bg-destructive/10"
              onClick={() => {
                if (window.confirm(t.confirmDeleteModel(model, provider)))
                  void onDelete()
              }}
            >
              <Trash2Icon className="size-4 shrink-0" />
              {t.deleteModel(model)}…
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

export function ModelsTable({
  rows,
  hiddenRows,
  hidingModel,
  showingModel,
  deletingModel,
  onHide,
  onShow,
  onDelete,
}: {
  rows: StatsResponse["models"]
  hiddenRows: StatsResponse["hiddenModels"]
  hidingModel: { provider: string; model: string } | null
  showingModel: { provider: string; model: string } | null
  deletingModel: { provider: string; model: string } | null
  onDelete: (provider: string, model: string) => Promise<void>
  onHide: (provider: string, model: string) => Promise<void>
  onShow: (provider: string, model: string) => Promise<void>
}) {
  const { messages: t, format } = useI18n()
  const isMutating = !!(hidingModel || showingModel || deletingModel)
  if (rows.length === 0 && hiddenRows.length === 0)
    return <EmptyRows kind="model" />

  const maxTokens = rows.reduce((max, row) => Math.max(max, row.tokens), 1)

  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.model}</TableHead>
              <TableHead className="text-right">{t.requests}</TableHead>
              <TableHead className="text-right">{t.tokens}</TableHead>
              <TableHead className="text-right">{t.cache}</TableHead>
              <TableHead className="text-right">{t.apiEquivalent}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t.modelActions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={`${row.provider}/${row.model}`}
                className="border-border/50"
              >
                <TableCell className="py-3">
                  <ModelIdentity model={row.model} provider={row.provider} />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {format.number(row.requests)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  <div className="flex flex-col items-end gap-1.5">
                    {format.compact(row.tokens)}
                    <span
                      aria-hidden="true"
                      className="h-1 w-20 overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className={`block h-full rounded-full ${modelDotClass(row.model)}`}
                        style={{ width: `${(row.tokens / maxTokens) * 100}%` }}
                      />
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                  {format.percent(row.cacheRate)}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">
                  {format.currency(row.cost)}
                </TableCell>
                <TableCell className="text-right">
                  <ModelActions
                    model={row.model}
                    provider={row.provider}
                    disabled={isMutating}
                    onToggle={() => onHide(row.provider, row.model)}
                    onDelete={() => onDelete(row.provider, row.model)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyRows kind="model" />
      )}
      {hiddenRows.length > 0 ? (
        <details className="rounded-lg border border-border/50">
          <summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
            {t.hiddenModels} · {format.number(hiddenRows.length)}
          </summary>
          <ul className="divide-y divide-border/50 border-t border-border/50 px-3">
            {hiddenRows.map((row) => (
              <li
                key={`${row.provider}/${row.model}`}
                className="flex items-center justify-between gap-4 py-3"
              >
                <ModelIdentity model={row.model} provider={row.provider} />
                <ModelActions
                  model={row.model}
                  provider={row.provider}
                  hidden
                  disabled={isMutating}
                  onToggle={() => onShow(row.provider, row.model)}
                  onDelete={() => onDelete(row.provider, row.model)}
                />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

export function ToolsTable({ rows }: { rows: StatsResponse["tools"] }) {
  const { messages: t, format } = useI18n()
  if (rows.length === 0) return <EmptyRows kind="tool" />
  const maxCalls = rows.reduce((max, row) => Math.max(max, row.calls), 1)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.tool}</TableHead>
          <TableHead className="text-right">
            <span className="pr-16 sm:pr-24">{t.calls}</span>
          </TableHead>
          <TableHead className="text-right">{t.errors}</TableHead>
          <TableHead className="text-right">{t.averageDuration}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name} className="border-border/50">
            <TableCell>
              <code className="text-xs font-medium">{row.name}</code>
            </TableCell>
            <TableCell className="text-right font-mono font-medium tabular-nums">
              <div className="flex items-center justify-end gap-4">
                {format.number(row.calls)}
                <span
                  aria-hidden="true"
                  className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-muted sm:w-20"
                >
                  <span
                    className="block h-full rounded-full bg-primary/60"
                    style={{ width: `${(row.calls / maxCalls) * 100}%` }}
                  />
                </span>
              </div>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              <div className="flex items-center justify-end gap-2">
                <span
                  className={
                    row.errors === 0 ? "text-muted-foreground" : undefined
                  }
                >
                  {format.number(row.errors)}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                <span className="sr-only">{t.errorRate}: </span>
                <span
                  className={`min-w-16 ${row.errors > 0 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {format.percent(row.errorRate)}
                </span>
              </div>
            </TableCell>
            <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
              {format.duration(row.averageDurationMs)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function modelDotClass(model: string) {
  const hash = Array.from(model).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0
  )
  // ponytail: colors may repeat; names remain the model identifiers.
  return [
    "bg-sky-600 dark:bg-sky-400",
    "bg-violet-600 dark:bg-violet-400",
    "bg-emerald-600 dark:bg-emerald-400",
    "bg-amber-600 dark:bg-amber-400",
    "bg-rose-600 dark:bg-rose-400",
  ][hash % 5]
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
          <TableHead>{t.models}</TableHead>
          <TableHead className="text-right">{t.lastUsed}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name} className="border-border/50">
            <TableCell>
              <code className="text-xs font-medium">{row.name}</code>
            </TableCell>
            <TableCell className="text-right font-mono font-medium tabular-nums">
              {format.number(row.uses)}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                {row.models
                  .toSorted((left, right) =>
                    left.model.localeCompare(right.model)
                  )
                  .map((model) => (
                    <Badge
                      key={model.model}
                      variant="outline"
                      className="h-6 gap-0 rounded-md border-border/60 p-0 font-normal"
                    >
                      <span className="inline-flex items-center gap-1.5 px-2 text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className={`size-1.5 shrink-0 rounded-full ${modelDotClass(model.model)}`}
                        />
                        {model.model}
                      </span>
                      <span className="sr-only">: {t.uses} </span>
                      <span className="min-w-9 border-l border-border/60 bg-muted/60 px-1.5 py-0.5 text-right font-mono font-medium tabular-nums">
                        {format.number(model.uses)}
                      </span>
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
