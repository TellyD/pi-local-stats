import { describe, expect, it } from "vitest"
import { createFormatters } from "../src/lib/format.ts"
import {
  catalogs,
  DEFAULT_LANGUAGE,
  resolveLanguage,
} from "../src/lib/i18n.tsx"

describe("localization", () => {
  it.each([
    ["en-US", "1 hr", "1.5 hr", "24 hr", "1 day", "6.8 days"],
    ["fr-FR", "1\u202fh", "1,5\u202fh", "24\u202fh", "1\u202fj", "6,8\u202fj"],
  ])(
    "formats long durations in hours and days in %s",
    (locale, hour, fractionalHour, roundedHours, day, days) => {
      const format = createFormatters(locale)
      expect(format.duration(3_599_999)).toBe("60 min")
      expect(format.duration(3_600_000)).toBe(hour)
      expect(format.duration(5_400_000)).toBe(fractionalHour)
      expect(format.duration(86_399_999)).toBe(roundedHours)
      expect(format.duration(86_400_000)).toBe(day)
      expect(format.duration(591_344_293)).toBe(days)
    }
  )

  it.each([
    ["en-US", "1.5 s", "1.5 min"],
    ["fr-FR", "1,5 s", "1,5 min"],
  ])(
    "preserves short and invalid durations in %s",
    (locale, seconds, minutes) => {
      const format = createFormatters(locale)
      for (const value of [0, -1, NaN, Infinity, -Infinity]) {
        expect(format.duration(value)).toBe("—")
      }
      expect(format.duration(123.6)).toBe("124 ms")
      expect(format.duration(999)).toBe("999 ms")
      expect(format.duration(1_000)).toBe("1 s")
      expect(format.duration(1_500)).toBe(seconds)
      expect(format.duration(59_999)).toBe("60 s")
      expect(format.duration(60_000)).toBe("1 min")
      expect(format.duration(90_000)).toBe(minutes)
    }
  )

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
    expect(catalogs.fr.messages.topCost).toBe("Coût API équivalent maximal")
    expect(catalogs.fr.messages.topTokens).toBe(
      "Part des tokens du modèle principal"
    )
    expect(catalogs.fr.messages.cacheReadRate).toBe("Taux de lecture du cache")
    expect(catalogs.fr.messages.hiddenModels).toBe("Modèles masqués")
    expect(catalogs.fr.messages.providerCount("2", 2)).toBe("2 providers")
    expect(catalogs.en.messages.activeTools).toBe("Active tools")
    expect(catalogs.fr.messages.topTool).toBe("Outil principal")
    expect(catalogs.fr.messages.errorCount("2", 2)).toBe("2 erreurs")
    expect(catalogs.en.messages.activeSkills).toBe("Active skills")
    expect(catalogs.fr.messages.topSkill).toBe("Skill principal")
    expect(catalogs.fr.messages.activeDays("1", 1)).toBe("1 jour avec activité")
  })
})
