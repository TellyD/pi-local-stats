import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SessionAgents,
  SessionsTable,
} from "../src/components/dashboard/SessionsTable.tsx"
import { I18nProvider } from "../src/lib/i18n.tsx"
import type { SessionSummary } from "../server/types.ts"

afterEach(() => vi.unstubAllGlobals())

describe("SessionAgents", () => {
  it("permet d’ouvrir un usage non attribué sans agent identifié", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => "en", setItem: () => undefined },
    })
    const row: SessionSummary = {
      id: "root",
      name: "Root",
      project: "/work/project",
      label: "project",
      models: [],
      startedAt: "2026-01-01T00:00:00.000Z",
      requests: 0,
      tokens: 0,
      cost: 0,
      accounting: {
        coverage: "partial",
        unassignedTokens: 12,
        unassignedCost: 0.02,
      },
      agents: [],
    }

    const markup = renderToStaticMarkup(
      <I18nProvider>
        <SessionsTable
          rows={[row]}
          total={1}
          page={1}
          pageSize={10}
          sort="startedAt"
          direction="desc"
          isLoading={false}
          onPageChange={() => undefined}
          onSortChange={() => undefined}
          onOpenTrace={() => undefined}
        />
      </I18nProvider>
    )

    expect(markup).toContain('aria-label="Analyze Root"')
    expect(markup).toContain("Show accounting details")
  })

  it("rend imbrication, provenance de précision et valeurs inconnues", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => "en", setItem: () => undefined },
    })
    const row: SessionSummary = {
      id: "root",
      name: "Root",
      project: "/work/project",
      label: "project",
      models: [],
      startedAt: "2026-01-01T00:00:00.000Z",
      requests: 1,
      tokens: 1,
      cost: 0.01,
      accounting: {
        coverage: "partial",
        unassignedTokens: 12,
        unassignedCost: 0.02,
      },
      agents: [
        {
          id: "child-agent",
          key: "child-key",
          source: "tintinweb",
          name: "",
          type: "worker",
          displayName: "Worker",
          description: "",
          parentAgentId: "parent-key",
          depth: 2,
          workflowId: null,
          status: "completed",
          statusRaw: "completed",
          provider: null,
          modelId: null,
          modelLabel: "GPT 5 Terra",
          models: [],
          requests: null,
          tokens: null,
          cost: null,
          precision: {
            linkage: "exact",
            model: "reported",
            tokens: "unknown",
            cost: "unknown",
          },
          provenance: { channels: ["tool-details"], artifactVersion: null },
          usage: {
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            totalTokens: null,
            totalCost: null,
            source: "tool-details",
            scope: null,
            tokenPrecision: "unknown",
            costPrecision: "unknown",
            coverage: "partial",
            includedInSessionTotal: false,
          },
        },
      ],
    }

    const markup = renderToStaticMarkup(
      <I18nProvider>
        <SessionAgents row={row} />
      </I18nProvider>
    )

    expect(markup).toContain("Unassigned agent usage")
    expect(markup).toContain("margin-left:16px")
    expect(markup).toContain("Worker")
    expect(markup).not.toContain("tintinweb")
    expect(markup).toContain('title="tool-details"')
    expect(markup).toContain("GPT 5 Terra")
    expect(markup).toContain("Partial")
    expect(markup).toContain("Usage details unavailable")
    expect(markup).toContain("Cost unavailable")
    expect(markup).not.toContain("GPT-5-Terra")
  })
})
