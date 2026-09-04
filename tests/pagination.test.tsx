import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { Pagination } from "../src/components/ui/pagination.tsx"

const labels = {
  navigation: "Pages",
  previous: "Previous",
  next: "Next",
  page: (page: number, pageCount: number) => `${page}/${pageCount}`,
}

describe("Pagination", () => {
  it("renders bounded, accessible controls only when needed", () => {
    expect(
      renderToStaticMarkup(
        <Pagination
          page={1}
          pageCount={1}
          onPageChange={vi.fn()}
          labels={labels}
        />
      )
    ).toBe("")

    const markup = renderToStaticMarkup(
      <Pagination
        page={9}
        pageCount={3}
        onPageChange={vi.fn()}
        labels={labels}
      />
    )

    expect(markup).toContain('aria-label="Pages"')
    expect(markup).toContain("3/3")
    expect(markup).toContain('aria-label="Previous"')
    expect(markup).toContain('aria-label="Next"')
    expect(markup).toContain('aria-label="Next" title="Next" disabled=""')

    const disabledMarkup = renderToStaticMarkup(
      <Pagination
        page={2}
        pageCount={3}
        disabled
        onPageChange={vi.fn()}
        labels={labels}
      />
    )
    expect(disabledMarkup.match(/disabled=""/g)).toHaveLength(2)
  })
})
