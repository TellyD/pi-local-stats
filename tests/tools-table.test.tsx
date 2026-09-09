import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ToolsTable } from "../src/components/dashboard/DataPanels.tsx"
import { I18nProvider } from "../src/lib/i18n.tsx"
import type { StatsResponse } from "../server/types.ts"

function renderTools(rows: StatsResponse["tools"]) {
  return renderToStaticMarkup(
    <I18nProvider>
      <ToolsTable rows={rows} />
    </I18nProvider>
  )
}

const tool: StatsResponse["tools"][number] = {
  name: "bash",
  calls: 100,
  errors: 10,
  errorRate: 0.1,
  averageDurationMs: 10_600,
}

describe("tools table", () => {
  it("combines errors and their rate while keeping duration secondary", () => {
    const markup = renderTools([tool])

    expect(markup.match(/<th /g)).toHaveLength(4)
    expect(markup).toContain('<code class="text-xs font-medium">bash</code>')
    expect(markup).toContain(">Errors</th>")
    expect(markup).not.toContain(">Error rate</th>")
    expect(markup).toContain(">10</span>")
    expect(markup).toContain('class="min-w-16 text-destructive">10%</span>')
    expect(markup).toContain('<span class="sr-only">Error rate: </span>')
    expect(markup).toMatch(
      /<td[^>]*class="[^"]*text-muted-foreground[^"]*">10\.6 s<\/td>/
    )
  })

  it("scales decorative call bars against the maximum regardless of order", () => {
    const markup = renderTools([
      { ...tool, name: "read", calls: 50 },
      tool,
      { ...tool, name: "todo", calls: 0, errors: 0, errorRate: 0 },
    ])

    expect(
      Array.from(markup.matchAll(/style="width:([^"]+)"/g), (match) => match[1])
    ).toEqual(["50%", "100%", "0%"])
    expect(markup.match(/aria-hidden="true" class="h-1 /g)).toHaveLength(3)
  })

  it("keeps zero errors visible but muted and handles zero calls", () => {
    const markup = renderTools([{ ...tool, calls: 0, errors: 0, errorRate: 0 }])

    expect(markup).toContain('class="text-muted-foreground">0</span>')
    expect(markup).toContain('class="min-w-16 text-muted-foreground">0%</span>')
    expect(markup).not.toContain("text-destructive")
    expect(markup).toContain('style="width:0%"')
    expect(markup).not.toMatch(/NaN|Infinity/)
  })

  it("preserves the empty state", () => {
    expect(renderTools([])).not.toContain("<table")
  })
})
