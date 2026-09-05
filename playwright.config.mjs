import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./visual-tests",
  testMatch: "**/*.visual.ts",
  outputDir: "visual-output/results",
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
  },
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
})
