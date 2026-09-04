import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createDatabase } from "../server/database.ts"
import { getSessions, getStats } from "../server/stats.ts"
import { SessionSynchronizer } from "../server/sync.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8")

describe("versioned agent compatibility", () => {
  it("normalise Tintin 0.19 et nicobailon 0.64 sans collision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-compatibility-"))
    temporaryDirectories.push(directory)
    const sessionsDirectory = join(directory, "sessions")
    const artifactsDirectory = join(directory, "artifacts")
    const tintinDirectory = join(
      artifactsDirectory,
      "fixture-project",
      "fixture-parent",
      "tasks"
    )
    const nicoDirectory = join(
      artifactsDirectory,
      "async-subagent-runs",
      "fixture-run"
    )
    await mkdir(sessionsDirectory, { recursive: true })
    await mkdir(tintinDirectory, { recursive: true })
    await mkdir(nicoDirectory, { recursive: true })
    await writeFile(
      join(sessionsDirectory, "parent.jsonl"),
      await fixture("tintinweb-0.19.0-parent.jsonl")
    )
    await writeFile(
      join(tintinDirectory, "fixture-agent.output"),
      await fixture("tintinweb-0.19.0-output.jsonl")
    )
    await writeFile(
      join(nicoDirectory, "status.json"),
      await fixture("nicobailon-0.64.0-status.json")
    )
    const database = createDatabase(":memory:")

    await new SessionSynchronizer(database, sessionsDirectory, [
      artifactsDirectory,
    ]).sync()

    const row = getSessions(
      database,
      { range: "all", project: "", provider: "", model: "" },
      { page: 1, pageSize: 10, sort: "startedAt", direction: "desc" }
    ).rows[0]!
    expect(row).toMatchObject({
      id: "fixture-parent",
      requests: 2,
      tokens: 122,
    })
    expect(row.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "fixture-agent",
          source: "tintinweb",
          tokens: 70,
          cost: 0.03,
          models: ["gpt-fixture"],
        }),
        expect.objectContaining({
          id: "fixture-child",
          source: "nicobailon",
          tokens: 50,
          cost: 0.03,
          models: ["gpt-fixture"],
        }),
      ])
    )
    expect(row.cost).toBeCloseTo(0.07)
    expect(
      getStats(
        database,
        { range: "all", project: "", provider: "", model: "" },
        null
      ).options.models
    ).toEqual(["gpt-fixture", "gpt-parent"])
    expect(
      JSON.stringify(database.prepare("SELECT * FROM agent_runs").all())
    ).not.toContain("[redacted]")
    database.close()
  })
})
