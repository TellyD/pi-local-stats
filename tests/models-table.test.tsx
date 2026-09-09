import type { ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ModelsTable } from "../src/components/dashboard/DataPanels.tsx"
import { catalogs, I18nProvider } from "../src/lib/i18n.tsx"

const props: ComponentProps<typeof ModelsTable> = {
  rows: [
    {
      provider: "provider",
      model: "active-model",
      requests: 1,
      tokens: 10,
      cost: 0.01,
      errors: 0,
      cacheRate: 0,
    },
  ],
  hiddenRows: [{ provider: "provider", model: "hidden-model" }],
  hidingModel: null,
  showingModel: null,
  deletingModel: null,
  onHide: async () => {},
  onShow: async () => {},
  onDelete: async () => {},
}

function render(overrides: Partial<typeof props> = {}) {
  return renderToStaticMarkup(
    <I18nProvider>
      <ModelsTable {...props} {...overrides} />
    </I18nProvider>
  )
}

describe("model history actions", () => {
  it("offers labeled action menus and separates hidden models into a closed disclosure", () => {
    const markup = render()
    for (const model of ["active-model", "hidden-model"]) {
      expect(markup).toContain(
        `aria-label="Model actions: ${model} (provider)"`
      )
    }
    expect(markup.match(/aria-haspopup="menu"/g)).toHaveLength(2)
    expect(markup).not.toContain('disabled=""')
    expect(markup).toContain("Hidden models · 1</summary>")
    expect(markup).not.toMatch(/<details[^>]*\bopen/)
    expect(markup.slice(0, markup.indexOf("</table>"))).not.toContain(
      "hidden-model"
    )
    expect(markup).not.toContain(">Provider</th>")
    expect(markup).toContain(
      'class="mt-0.5 text-xs text-muted-foreground">provider</div>'
    )
    expect(render({ rows: [] })).toContain(
      'aria-label="Model actions: hidden-model (provider)"'
    )
    expect(render({ hiddenRows: [] })).not.toContain("<details")
    expect(render({ rows: [], hiddenRows: [] })).not.toContain("<table")
  })

  it("scales token bars independently of row order and handles zero tokens", () => {
    const markup = render({
      rows: [{ ...props.rows[0], model: "small", tokens: 5 }, props.rows[0]],
    })
    expect(
      Array.from(markup.matchAll(/style="width:([^"]+)"/g), (match) => match[1])
    ).toEqual(["50%", "100%"])
    const zero = render({ rows: [{ ...props.rows[0], tokens: 0 }] })
    expect(zero).toContain('style="width:0%"')
    expect(zero).not.toMatch(/NaN|Infinity/)
  })

  it.each(["hidingModel", "showingModel", "deletingModel"] as const)(
    "disables every model action while %s is pending",
    (state) => {
      const markup = render({
        [state]: { provider: "another-provider", model: "another-model" },
      })
      expect(markup.match(/ disabled=""/g)).toHaveLength(2)
    }
  )

  it("explains deletion scope and retention in both languages", () => {
    const en = catalogs.en.messages.confirmDeleteModel("model", "provider")
    const fr = catalogs.fr.messages.confirmDeleteModel("model", "provider")
    for (const message of [en, fr])
      expect(message).toContain("model (provider)")
    for (const text of [
      "across all periods",
      "cannot be undone",
      "will not be reimported",
      "session files will remain unchanged",
      "Future usage can appear",
      "affected existing agent runs will remain excluded",
      "new runs and new detailed requests will still count",
    ])
      expect(en).toContain(text)
    for (const text of [
      "toutes les périodes",
      "irréversible",
      "ne sera pas réimporté",
      "resteront inchangés",
      "utilisations futures pourront réapparaître",
      "resteront exclus, même après mise à jour",
      "nouvelles requêtes détaillées seront comptées",
    ])
      expect(fr).toContain(text)
  })
})
