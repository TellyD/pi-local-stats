import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SkillsTable } from "../src/components/dashboard/DataPanels.tsx"
import { I18nProvider } from "../src/lib/i18n.tsx"
import type { StatsResponse } from "../server/types.ts"

function renderSkills(rows: StatsResponse["skills"]) {
  return renderToStaticMarkup(
    <I18nProvider>
      <SkillsTable rows={rows} />
    </I18nProvider>
  )
}

const skill: StatsResponse["skills"][number] = {
  name: "ponytail",
  uses: 613,
  sessions: 613,
  lastUsed: "2026-09-09T21:41:00.000Z",
  models: [
    { model: "gpt-6-astra", uses: 426 },
    { model: "gpt-5.6-sol", uses: 187 },
  ],
}

function dots(markup: string) {
  return Array.from(
    markup.matchAll(/aria-hidden="true" class="([^"]+)"/g),
    (match) => match[1]
  )
}

describe("skills table", () => {
  it("separates model names and counts and omits redundant sessions", () => {
    const markup = renderSkills([skill])

    expect(markup).toContain(
      '<code class="text-xs font-medium">ponytail</code>'
    )
    expect(markup).toContain(">Uses</th>")
    expect(markup).not.toContain(">Sessions</th>")
    expect(markup).toContain(">613</td>")
    expect(markup).toContain("gpt-6-astra</span>")
    expect(markup).toContain(">426</span>")
    expect(markup).toContain(">187</span>")
    expect(markup).toContain('<span class="sr-only">: Uses </span>')
  })

  it("keeps model order and colors stable across counts and filters", () => {
    const markup = renderSkills([skill])
    const reversed = renderSkills([
      { ...skill, models: skill.models.toReversed() },
    ])
    const filtered = renderSkills([{ ...skill, models: [skill.models[0]] }])

    expect(markup.indexOf("gpt-5.6-sol")).toBeLessThan(
      markup.indexOf("gpt-6-astra")
    )
    expect(reversed).toBe(markup)
    expect(dots(markup)).toHaveLength(2)
    expect(dots(markup)[0]).not.toBe(dots(markup)[1])
    expect(dots(filtered)).toEqual([dots(markup)[1]])
    expect(skill.models[0].model).toBe("gpt-6-astra")
  })

  it("preserves the empty state", () => {
    expect(renderSkills([])).not.toContain("<table")
  })
})
