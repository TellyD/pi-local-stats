import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { afterEach, expect, it, vi } from "vitest"

import { App } from "../src/App.tsx"
import { I18nProvider } from "../src/lib/i18n.tsx"

const state = vi.hoisted(() => ({ loaded: false }))

vi.mock("@/hooks/use-stats", () => ({
  useStats: () => ({
    isLoading: !state.loaded,
    data: state.loaded
      ? {
          meta: { lastSyncAt: null, indexedSessions: 0 },
          options: {
            projects: [{ value: "/work/Gooey", label: "Gooey" }],
            providers: [],
            models: [],
          },
        }
      : null,
  }),
}))

vi.mock("@/components/dashboard/ToolsPage", () => ({
  ToolsPage: () => null,
}))

afterEach(() => {
  state.loaded = false
})

function projectTrigger(project = "/work/Gooey") {
  const search = new URLSearchParams({ project })
  const markup = renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/tools?${search}`]}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </MemoryRouter>
  )
  return markup.match(
    /<button\b[^>]*aria-label="All projects"[^>]*>[\s\S]*?<\/button>/
  )?.[0]
}

it("never flashes the raw project path while filter options load", () => {
  const pending = projectTrigger()
  expect(pending).toBeDefined()
  expect(pending).not.toContain("/work/Gooey")
  expect(pending).toContain("…")

  state.loaded = true
  const loaded = projectTrigger()
  expect(loaded).toContain(">Gooey</span>")
  expect(loaded).not.toContain("/work/Gooey")
  expect(loaded).not.toContain("…")
})

it("keeps the all-projects label when no project is selected", () => {
  expect(projectTrigger("")).toContain(">All projects</span>")
})
