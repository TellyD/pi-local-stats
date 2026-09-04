import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { afterEach, describe, expect, it } from "vitest"

import { createDatabase } from "../server/database.ts"
import { getSessions, getStats } from "../server/stats.ts"
import { SessionSynchronizer } from "../server/sync.ts"

const SESSION_COUNT = 10_000
const temporaryDirectories: string[] = []
const filters = {
  range: "all" as const,
  project: "",
  provider: "",
  model: "",
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("scale baseline", () => {
  it("indexe 10 000 sessions dans les plafonds de sécurité", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-scale-"))
    temporaryDirectories.push(directory)
    for (let bucket = 0; bucket < 100; bucket += 1)
      mkdirSync(join(directory, String(bucket)))

    let startedAt = performance.now()
    for (let index = 0; index < SESSION_COUNT; index += 1) {
      const id = `session-${index}`
      const timestamp = "2026-01-01T00:00:00.000Z"
      writeFileSync(
        join(directory, String(index % 100), `${id}.jsonl`),
        [
          {
            type: "session",
            id,
            timestamp,
            cwd: "/work/scale-project",
          },
          {
            type: "message",
            id: `request-${index}`,
            timestamp,
            message: {
              role: "assistant",
              provider: "scale",
              model: "scale-model",
              stopReason: "stop",
              content: [],
              usage: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 2,
                cost: { total: 0.001 },
              },
            },
          },
        ]
          .map((entry) => JSON.stringify(entry))
          .join("\n")
      )
    }
    const generationMs = elapsed(startedAt)
    const database = createDatabase(":memory:")
    const synchronizer = new SessionSynchronizer(database, directory, [], [])

    try {
      startedAt = performance.now()
      const first = await synchronizer.sync()
      const firstSyncMs = elapsed(startedAt)

      startedAt = performance.now()
      const unchanged = await synchronizer.sync()
      const unchangedSyncMs = elapsed(startedAt)

      startedAt = performance.now()
      const stats = getStats(database, filters, null)
      const statsMs = elapsed(startedAt)

      startedAt = performance.now()
      const sessions = getSessions(database, filters, {
        page: 1,
        pageSize: 20,
        sort: "startedAt",
        direction: "desc",
      })
      const sessionsMs = elapsed(startedAt)

      console.info(
        "scale timings (ms)",
        JSON.stringify({
          generationMs,
          firstSyncMs,
          unchangedSyncMs,
          statsMs,
          sessionsMs,
        })
      )
      expect(first).toMatchObject({
        scanned: SESSION_COUNT,
        updated: SESSION_COUNT,
        removed: 0,
      })
      expect(unchanged).toMatchObject({
        scanned: SESSION_COUNT,
        updated: 0,
        removed: 0,
      })
      expect(stats.meta.indexedSessions).toBe(SESSION_COUNT)
      expect(stats.overview.requests).toBe(SESSION_COUNT)
      expect(sessions.total).toBe(SESSION_COUNT)
      expect(firstSyncMs).toBeLessThan(30_000)
      expect(unchangedSyncMs).toBeLessThan(5_000)
    } finally {
      database.close()
    }
  }, 90_000)
})
