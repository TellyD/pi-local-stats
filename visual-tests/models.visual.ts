import { expect, test, type Route } from "@playwright/test"

import type { StatsResponse } from "../server/types.ts"

const stats: StatsResponse = {
  meta: {
    lastSyncAt: "2026-09-09T21:41:00Z",
    indexedFiles: 20,
    indexedSessions: 20,
  },
  filters: { range: "all", project: "", provider: "", model: "" },
  options: {
    projects: [],
    providers: ["openai-codex"],
    models: ["gpt-5.6-sol", "gpt-6-astra"],
  },
  overview: {
    requests: 31_472,
    errorRate: 0,
    totalTokens: 3_725_300_000,
    cacheReadTokens: 3_500_000_000,
    cacheRate: 0.96,
    cost: 3939.67,
    averageDurationMs: 1000,
  },
  timeseries: [],
  providers: [],
  projects: [],
  tools: [],
  skills: [],
  models: [
    {
      model: "gpt-5.6-sol",
      provider: "openai-codex",
      requests: 20_070,
      tokens: 2_800_000_000,
      cost: 2387.38,
      errors: 0,
      cacheRate: 0.964,
    },
    {
      model: "gpt-6-astra",
      provider: "openai-codex",
      requests: 11_402,
      tokens: 925_300_000,
      cost: 1552.29,
      errors: 0,
      cacheRate: 0.949,
    },
  ],
  hiddenModels: [
    { model: "cursor-grok-4.6-fast", provider: "cursor" },
    { model: "gemini-3.8-flash", provider: "cursor" },
    { model: "gpt-5.6-luna", provider: "openai-codex" },
    { model: "gpt-5.6-terra", provider: "openai-codex" },
  ],
}

test("models layout, disclosure and keyboard-safe history actions", async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  let pendingMutation: Route | undefined
  const mutations: Array<{ method: string; url: URL }> = []
  await page.route("**/api/**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: stats })
    } else {
      mutations.push({
        method: route.request().method(),
        url: new URL(route.request().url()),
      })
      pendingMutation = route
    }
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/models")
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(3)
  const hidden = page.getByText("cursor-grok-4.6-fast", { exact: true })
  await expect(hidden).toBeHidden()
  await page.evaluate(() => document.fonts.ready)
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.classList.toggle("dark", value === "dark")
    }, theme)
    await page.screenshot({
      path: testInfo.outputPath(`models-${theme}.png`),
      animations: "disabled",
      fullPage: true,
    })
  }
  await page.locator("summary").focus()
  await page.keyboard.press("Enter")
  await expect(hidden).toBeVisible()

  const activeMenu = page.getByRole("button", {
    name: "Model actions: gpt-5.6-sol (openai-codex)",
    exact: true,
  })
  await activeMenu.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(activeMenu).toBeFocused()
  await activeMenu.click()
  page.once("dialog", (dialog) => dialog.dismiss())
  await page
    .getByRole("menuitem", {
      name: "Delete history for gpt-5.6-sol…",
      exact: true,
    })
    .click()
  await expect(page.getByRole("menu")).toBeHidden()
  expect(mutations).toHaveLength(0)

  for (const [action, model, provider, method, path] of [
    ["Hide", "gpt-5.6-sol", "openai-codex", "POST", "/api/models/hide"],
    ["Show", "cursor-grok-4.6-fast", "cursor", "POST", "/api/models/show"],
    [
      "Delete history for",
      "gpt-5.6-sol",
      "openai-codex",
      "DELETE",
      "/api/models",
    ],
    [
      "Delete history for",
      "cursor-grok-4.6-fast",
      "cursor",
      "DELETE",
      "/api/models",
    ],
  ]) {
    const trigger = page.getByRole("button", {
      name: `Model actions: ${model} (${provider})`,
      exact: true,
    })
    await trigger.focus()
    await page.keyboard.press("Enter")
    if (action !== "Show") {
      page.once("dialog", async (dialog) => {
        expect(dialog.message()).toContain(`${model} (${provider})`)
        if (method === "DELETE")
          expect(dialog.message()).toContain("cannot be undone")
        await dialog.accept()
      })
    }
    const item = page.getByRole("menuitem", {
      name: `${action} ${model}${method === "DELETE" ? "…" : ""}`,
      exact: true,
    })
    await item.focus()
    await page.keyboard.press("Enter")
    await expect.poll(() => pendingMutation !== undefined).toBe(true)
    const mutation = mutations.at(-1)!
    expect(mutation.method).toBe(method)
    expect(mutation.url.pathname).toBe(path)
    expect(mutation.url.searchParams.get("model")).toBe(model)
    expect(mutation.url.searchParams.get("provider")).toBe(provider)
    for (const button of await page
      .getByRole("button", { name: /^Model actions:/ })
      .all())
      await expect(button).toBeDisabled()
    await pendingMutation!.fulfill({
      json: {
        provider,
        model,
        projects: [],
        providers: ["openai-codex", "cursor"],
        models: stats.options.models,
      },
    })
    pendingMutation = undefined
    await expect(trigger).toBeEnabled()
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTitle("Français", { exact: true }).click()
  await expect(page.locator("summary")).toHaveText("Modèles masqués · 4")
  await page.locator("summary").scrollIntoViewIfNeeded()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath("models-mobile-fr.png"),
    animations: "disabled",
  })
  await page
    .getByRole("button", {
      name: "Actions du modèle: cursor-grok-4.6-fast (cursor)",
      exact: true,
    })
    .click()
  await expect(
    page.getByRole("menuitem", {
      name: "Réafficher cursor-grok-4.6-fast",
      exact: true,
    })
  ).toBeVisible()
  const menuBox = await page.getByRole("menu").boundingBox()
  expect(menuBox!.x).toBeGreaterThanOrEqual(0)
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390)
  expect(errors).toEqual([])
})
