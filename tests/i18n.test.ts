import { describe, expect, it } from "vitest"
import {
  catalogs,
  DEFAULT_LANGUAGE,
  resolveLanguage,
} from "../src/lib/i18n.tsx"

describe("localization", () => {
  it("defaults safely to English and exposes complete English and French catalogs", () => {
    expect(DEFAULT_LANGUAGE).toBe("en")
    expect(resolveLanguage(null)).toBe("en")
    expect(resolveLanguage("invalid")).toBe("en")
    expect(resolveLanguage("toString")).toBe("en")
    expect(resolveLanguage("fr")).toBe("fr")
    expect(Object.keys(catalogs.fr.messages).sort()).toEqual(
      Object.keys(catalogs.en.messages).sort()
    )
    expect(catalogs.en.messages.usageLog).toBe("Usage log")
    expect(catalogs.fr.messages.usageLog).toBe("Journal d’usage")
    expect(catalogs.en.messages.indexSummary("1", 1)).toBe("1 session")
    expect(catalogs.en.messages.averageCostPerSession).toBe("Cost per session")
    expect(catalogs.fr.messages.averageCostPerSession).toBe("Coût par session")
    expect(catalogs.en.messages.activeModels).toBe("Active models")
    expect(catalogs.fr.messages.topCost).toBe("Coût maximal")
    expect(catalogs.fr.messages.providerCount("2", 2)).toBe("2 providers")
    expect(catalogs.en.messages.activeTools).toBe("Active tools")
    expect(catalogs.fr.messages.topTool).toBe("Outil principal")
    expect(catalogs.fr.messages.errorCount("2", 2)).toBe("2 erreurs")
    expect(catalogs.en.messages.activeSkills).toBe("Active skills")
    expect(catalogs.fr.messages.topSkill).toBe("Skill principal")
    expect(catalogs.fr.messages.activeDays("1", 1)).toBe("1 jour avec activité")
  })
})
