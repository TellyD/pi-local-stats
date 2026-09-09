import Database from "better-sqlite3"
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { StatsServer } from "../server/server.ts"
import { createDatabase } from "../server/database.ts"
import { deleteModelHistory } from "../server/model-history.ts"
import { SessionSynchronizer } from "../server/sync.ts"
import { getStats } from "../server/stats.ts"
import type { StatsResponse } from "../server/types.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

function request(
  id: string,
  provider = "test",
  timestamp = "2026-01-01T00:00:01.000Z"
) {
  return {
    type: "message",
    id,
    timestamp,
    message: {
      role: "assistant",
      provider,
      model: "shared-model",
      stopReason: "stop",
      content: [
        {
          type: "toolCall",
          id: `tool-${id}`,
          name: "read",
          arguments: { path: "/tmp/example/SKILL.md" },
        },
      ],
      usage: { input: 4, output: 2, totalTokens: 6, cost: { total: 0.01 } },
    },
  }
}

function session(...messages: ReturnType<typeof request>[]) {
  return [
    {
      type: "session",
      version: 3,
      id: "session",
      cwd: "/work/project",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    ...messages,
  ]
    .map((record) => JSON.stringify(record))
    .join("\n")
}

describe("model history deletion", () => {
  it("rolls back both deletion markers and usage if the purge fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-delete-atomic-"))
    directories.push(directory)
    await writeFile(join(directory, "session.jsonl"), session(request("old")))
    const db = createDatabase(":memory:")
    try {
      await new SessionSynchronizer(db, directory, []).sync()
      db.exec(`
        INSERT INTO hidden_models VALUES ('test', 'shared-model', '2026-01-01');
        CREATE TRIGGER prevent_delete BEFORE DELETE ON tool_calls
        BEGIN SELECT RAISE(ABORT, 'blocked'); END;
      `)
      expect(() => deleteModelHistory(db, "test", "shared-model")).toThrow(
        "blocked"
      )
      for (const table of [
        "requests",
        "tool_calls",
        "skill_usages",
        "hidden_models",
      ])
        expect(db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()).toBe(
          1
        )
      for (const table of ["deleted_model_records", "deleted_agent_usage"])
        expect(db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()).toBe(
          0
        )
    } finally {
      db.close()
    }
  })

  it("does not resurrect deleted agent aggregates, but counts new runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-delete-agent-"))
    directories.push(directory)
    const fixture = JSON.parse(
      await readFile(
        new URL("./fixtures/nicobailon-0.64.0-status.json", import.meta.url),
        "utf8"
      )
    )
    const artifactDirectory = join(directory, "async-subagent-runs", "run")
    await mkdir(artifactDirectory, { recursive: true })
    const path = join(artifactDirectory, "status.json")
    await writeFile(path, JSON.stringify(fixture))
    await writeFile(
      join(directory, "parent.jsonl"),
      JSON.stringify({
        type: "session",
        id: "fixture-parent",
        cwd: "/work/project",
        timestamp: "2026-01-01T00:00:00.000Z",
      })
    )
    const db = createDatabase(":memory:")
    const sync = new SessionSynchronizer(db, directory, [])
    const stats = () =>
      getStats(db, { range: "all", project: "", provider: "", model: "" }, null)
    try {
      await sync.sync()
      expect(stats().overview.totalTokens).toBe(50)
      expect(deleteModelHistory(db, "openai", "gpt-fixture")).toBe(true)
      expect(stats().overview.totalTokens).toBe(0)
      // A refreshed cumulative snapshot cannot bring its deleted totals back.
      fixture.steps[0].tokens.total = 60
      await writeFile(path, JSON.stringify(fixture))
      await sync.sync()
      expect(stats().overview.totalTokens).toBe(0)
      fixture.runId = "new-run"
      fixture.steps[0].childId = "new-child"
      await writeFile(path, JSON.stringify(fixture))
      await sync.sync()
      expect(stats().overview.totalTokens).toBe(60)
    } finally {
      db.close()
    }
  })

  it("erases hidden history without reimporting it and allows new usage after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-delete-"))
    directories.push(directory)
    const path = join(directory, "session.jsonl")
    const original = session(
      request("old"),
      request("other", "other-provider"),
      request("future-dated", "test", "2099-01-01T00:00:00.000Z")
    )
    await writeFile(path, original)
    const options = {
      sessionsDirectory: directory,
      databasePath: join(directory, "stats.sqlite"),
      additionalDirectories: [],
    }
    let server = new StatsServer(options)
    try {
      let url = new URL(await server.start())
      let headers = { Authorization: `Bearer ${url.searchParams.get("token")}` }
      const api = (pathname: string, method = "GET") =>
        fetch(new URL(pathname, url), { method, headers })
      const stats = async () =>
        (await (await api("/api/stats?range=all")).json()) as StatsResponse
      const target = "provider=test&model=shared-model"
      await api("/api/sync/initial")
      expect((await stats()).overview.requests).toBe(2)
      expect(
        (
          await fetch(new URL(`/api/models?${target}`, url), {
            method: "DELETE",
          })
        ).status
      ).toBe(401)
      expect((await api("/api/models?provider=test", "DELETE")).status).toBe(
        400
      )
      expect(
        (await api("/api/models?provider=test&model=absent", "DELETE")).status
      ).toBe(404)
      await api(`/api/models/hide?${target}`, "POST")
      expect((await stats()).hiddenModels).toHaveLength(1)

      const deleted = await api(`/api/models?${target}`, "DELETE")
      expect(deleted.status).toBe(200)
      expect(await deleted.json()).toEqual({
        deleted: true,
        projects: ["/work/project"],
        providers: ["other-provider"],
        models: ["shared-model"],
      })
      expect(await readFile(path, "utf8")).toBe(original)
      expect((await stats()).hiddenModels).toEqual([])

      const assertErased = () => {
        const db = new Database(options.databasePath, { readonly: true })
        try {
          for (const table of ["requests", "tool_calls", "skill_usages"])
            expect(
              db
                .prepare(
                  `SELECT COUNT(*) FROM ${table} WHERE provider = 'test'`
                )
                .pluck()
                .get()
            ).toBe(0)
        } finally {
          db.close()
        }
      }
      assertErased()
      await appendFile(path, "\n")
      await writeFile(join(directory, "copy.jsonl"), original)
      await api("/api/sync", "POST")
      assertErased()
      expect((await stats()).overview.requests).toBe(1)

      await server.close()
      server = new StatsServer(options)
      url = new URL(await server.start())
      headers = { Authorization: `Bearer ${url.searchParams.get("token")}` }
      await api("/api/sync/initial")
      // A new record must count even if its timestamp matches an old record.
      await appendFile(path, `\n${JSON.stringify(request("new"))}`)
      await api("/api/sync", "POST")
      const renewed = await stats()
      expect(renewed.overview.requests).toBe(2)
      expect(
        renewed.models.find((model) => model.provider === "test")
      ).toMatchObject({ model: "shared-model", requests: 1, tokens: 6 })
      expect(renewed.hiddenModels).toEqual([])
      expect((await api(`/api/models?${target}`, "DELETE")).status).toBe(200)
      await appendFile(path, "\n")
      await api("/api/sync", "POST")
      assertErased()
      expect((await stats()).overview.requests).toBe(1)
    } finally {
      await server.close()
    }
  })
})
