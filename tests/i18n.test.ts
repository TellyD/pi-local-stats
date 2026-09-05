import { describe, expect, it } from "vitest"
import { createFormatters } from "../src/lib/format.ts"
import {
  catalogs,
  DEFAULT_LANGUAGE,
  resolveLanguage,
} from "../src/lib/i18n.tsx"

describe("localization", () => {
  it.each(["en-US", "fr-FR"])(
    "distinguishes events within a minute in %s",
    (locale) => {
      const format = createFormatters(locale)
      const first = "2026-08-28T12:00:01.000Z"
      const second = "2026-08-28T12:00:45.000Z"
      expect(format.dateTime(first)).toBe(format.dateTime(second))
      expect(format.dateTime(first, true)).not.toBe(
        format.dateTime(second, true)
      )
      expect(format.dateTime(second, true)).toContain(":45")
      expect(format.dateTime("invalid", true)).toBe("—")
    }
  )

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
