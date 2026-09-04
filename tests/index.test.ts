import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { resolveSessionsDirectory } from "../index.ts"

afterEach(() => vi.unstubAllEnvs())

describe("resolveSessionsDirectory", () => {
  it("utilise le dossier global pour une session éphémère", () => {
    const sessionsDirectory = join(tmpdir(), "pi-stats-ephemeral-sessions")
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDirectory)

    expect(resolveSessionsDirectory("", process.cwd())).toBe(
      resolve(sessionsDirectory)
    )
  })
})
