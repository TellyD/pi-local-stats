import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import open from "open"
import { join, resolve } from "node:path"
import { getPiDirectory, getSessionsDirectory } from "./server/database.ts"
import { StatsServer } from "./server/server.ts"

export function resolveSessionsDirectory(
  activeSessionDirectory: string,
  cwd: string
): string {
  const configuredSessionsRoot = resolve(getSessionsDirectory())
  if (!activeSessionDirectory) return configuredSessionsRoot
  const defaultSessionsRoot = resolve(getPiDirectory(), "sessions")
  const safeCwd = `--${resolve(cwd)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`
  const expectedDefaultDirectory = join(defaultSessionsRoot, safeCwd)
  return resolve(activeSessionDirectory) === expectedDefaultDirectory
    ? configuredSessionsRoot
    : resolve(activeSessionDirectory)
}

/** Pi extension entrypoint: /stats opens a private local statistics dashboard. */
export default function statsDashboard(pi: ExtensionAPI): void {
  let server: StatsServer | null = null

  pi.registerCommand("stats", {
    description: "Open the local statistics dashboard",
    handler: async (_args, ctx) => {
      const sessionsDirectory = resolveSessionsDirectory(
        ctx.sessionManager.getSessionDir(),
        ctx.cwd
      )
      server ??= new StatsServer({ sessionsDirectory })
      const url = await server.start()
      await open(url)
      ctx.ui.notify("Statistics dashboard opened in your browser.", "info")
    },
  })

  pi.on("session_shutdown", async () => {
    await server?.close()
    server = null
  })
}
