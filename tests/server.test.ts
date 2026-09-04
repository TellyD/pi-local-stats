import Database from "better-sqlite3"
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createDatabase } from "../server/database.ts"
import { StatsServer } from "../server/server.ts"
import { SessionSynchronizer } from "../server/sync.ts"
import type { SyncResult } from "../server/types.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("StatsServer", () => {
  it("sert l’index existant avant la fin de la synchronisation initiale", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-startup-"))
    temporaryDirectories.push(directory)
    const sessionsDirectory = join(directory, "sessions")
    const databasePath = join(directory, "stats.sqlite")
    const sessionFile = join(sessionsDirectory, "session.jsonl")
    await mkdir(sessionsDirectory, { recursive: true })
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "cached-session",
          timestamp: new Date().toISOString(),
          cwd: "/work/cached",
        }),
        JSON.stringify({
          type: "message",
          id: "cached-request",
          parentId: null,
          timestamp: new Date().toISOString(),
          message: {
            role: "assistant",
            provider: "test",
            model: "cached",
            stopReason: "stop",
            content: [],
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: { total: 0.01 },
            },
          },
        }),
      ].join("\n"),
      "utf8"
    )

    const database = createDatabase(databasePath)
    await new SessionSynchronizer(database, sessionsDirectory).sync()
    database.close()
    await appendFile(
      sessionFile,
      `\n${JSON.stringify({ type: "message", id: "new-request", parentId: "cached-request", timestamp: new Date().toISOString(), message: { role: "assistant", provider: "test", model: "new", stopReason: "stop", content: [], usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { total: 0.02 } } } })}`,
      "utf8"
    )

    const originalSync = SessionSynchronizer.prototype.sync
    let releaseSync = (): void => undefined
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve
    })
    const syncSpy = vi
      .spyOn(SessionSynchronizer.prototype, "sync")
      .mockImplementation(function (this: SessionSynchronizer) {
        return syncGate.then(() => originalSync.call(this))
      })
    const server = new StatsServer({
      sessionsDirectory,
      databasePath,
      additionalDirectories: [],
    })
    const startPromise = server.start()
    const concurrentStartPromise = server.start()

    try {
      expect(
        await Promise.race([
          Promise.all([startPromise, concurrentStartPromise]).then(() => true),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 250).unref()
          ),
        ])
      ).toBe(true)

      const dashboardUrl = new URL(await startPromise)
      expect(await concurrentStartPromise).toBe(dashboardUrl.href)
      const token = dashboardUrl.searchParams.get("token")
      const headers = { Authorization: `Bearer ${token}` }
      const apiUrl = new URL("/api/stats", dashboardUrl)
      expect(
        (
          (await (await fetch(apiUrl, { headers })).json()) as {
            overview: { requests: number }
          }
        ).overview.requests
      ).toBe(1)

      const initialSyncCompletion = fetch(
        new URL("/api/sync/initial", dashboardUrl),
        { headers }
      )
      expect(
        await Promise.race([
          initialSyncCompletion.then(() => true),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 50).unref()
          ),
        ])
      ).toBe(false)
      releaseSync()
      expect((await initialSyncCompletion).status).toBe(200)
      expect(syncSpy).toHaveBeenCalledTimes(1)
      expect(
        (
          (await (await fetch(apiUrl, { headers })).json()) as {
            overview: { requests: number }
          }
        ).overview.requests
      ).toBe(2)
    } finally {
      releaseSync()
      await startPromise.catch(() => undefined)
      await server.close()
      syncSpy.mockRestore()
    }
  })

  it("attend le sync initial d’une base neuve avant de servir l’API", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-fresh-sync-"))
    temporaryDirectories.push(directory)
    const sessionsDirectory = join(directory, "sessions")
    const databasePath = join(directory, "stats.sqlite")
    await mkdir(sessionsDirectory)
    await writeFile(
      join(sessionsDirectory, "session.jsonl"),
      [
        JSON.stringify({
          type: "session",
          id: "historical-session",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: "/work/project",
        }),
        JSON.stringify({
          type: "message",
          id: "historical-request",
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            role: "assistant",
            provider: "test",
            model: "historical",
            stopReason: "stop",
            content: [],
            usage: { input: 1, output: 1, totalTokens: 2, cost: 0.01 },
          },
        }),
      ].join("\n")
    )

    const originalSync = SessionSynchronizer.prototype.sync
    let releaseSync = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      releaseSync = resolve
    })
    const syncSpy = vi
      .spyOn(SessionSynchronizer.prototype, "sync")
      .mockImplementation(function (this: SessionSynchronizer) {
        return gate.then(() => originalSync.call(this))
      })
    const server = new StatsServer({
      sessionsDirectory,
      databasePath,
      additionalDirectories: [],
    })
    const dashboardUrl = new URL(await server.start())
    const headers = {
      Authorization: `Bearer ${dashboardUrl.searchParams.get("token")}`,
    }
    const responses = Promise.all([
      fetch(new URL("/api/sync/initial", dashboardUrl), { headers }),
      fetch(new URL("/api/stats?range=all", dashboardUrl), { headers }),
      fetch(
        new URL(
          "/api/sessions?range=all&page=1&pageSize=10&sort=startedAt&direction=desc",
          dashboardUrl
        ),
        { headers }
      ),
    ])

    try {
      expect(
        await Promise.race([
          responses.then(() => true),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 50).unref()
          ),
        ])
      ).toBe(false)
      releaseSync()
      const [initial, stats, sessions] = await responses
      expect([initial.status, stats.status, sessions.status]).toEqual([
        200, 200, 200,
      ])
      expect(
        ((await stats.json()) as { overview: { requests: number } }).overview
          .requests
      ).toBe(1)
      expect(((await sessions.json()) as { total: number }).total).toBe(1)
      expect(syncSpy).toHaveBeenCalledTimes(1)
    } finally {
      releaseSync()
      await server.close()
      syncSpy.mockRestore()
    }
  })

  it("termine le sync initial d’un répertoire vide", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-empty-sync-"))
    temporaryDirectories.push(directory)
    const server = new StatsServer({
      sessionsDirectory: directory,
      databasePath: join(directory, "stats.sqlite"),
      additionalDirectories: [],
    })

    try {
      const dashboardUrl = new URL(await server.start())
      const headers = {
        Authorization: `Bearer ${dashboardUrl.searchParams.get("token")}`,
      }
      expect(
        (
          (await (
            await fetch(new URL("/api/stats?range=all", dashboardUrl), {
              headers,
            })
          ).json()) as { meta: { indexedSessions: number } }
        ).meta.indexedSessions
      ).toBe(0)
    } finally {
      await server.close()
    }
  })

  it("permet de relancer un sync initial qui a échoué", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-retry-sync-"))
    temporaryDirectories.push(directory)
    const originalSync = SessionSynchronizer.prototype.sync
    let rejectInitial = (): void => undefined
    const failedInitialSync = new Promise<SyncResult>((_resolve, reject) => {
      rejectInitial = () => reject(new Error("Initial sync failed"))
    })
    const syncSpy = vi
      .spyOn(SessionSynchronizer.prototype, "sync")
      .mockReturnValueOnce(failedInitialSync)
      .mockImplementation(function (this: SessionSynchronizer) {
        return originalSync.call(this)
      })
    const server = new StatsServer({
      sessionsDirectory: directory,
      databasePath: join(directory, "stats.sqlite"),
      additionalDirectories: [],
    })

    try {
      const dashboardUrl = new URL(await server.start())
      const headers = {
        Authorization: `Bearer ${dashboardUrl.searchParams.get("token")}`,
      }
      const failedInitialResponse = fetch(
        new URL("/api/sync/initial", dashboardUrl),
        { headers }
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
      rejectInitial()
      expect((await failedInitialResponse).status).toBe(500)
      const [initialRetry, statsRetry] = await Promise.all([
        fetch(new URL("/api/sync/initial", dashboardUrl), { headers }),
        fetch(new URL("/api/stats?range=all", dashboardUrl), { headers }),
      ])
      expect([initialRetry.status, statsRetry.status]).toEqual([200, 200])
      expect(syncSpy).toHaveBeenCalledTimes(2)
    } finally {
      await server.close()
      syncSpy.mockRestore()
    }
  })

  it("attend la réindexation exigée par une migration avant de servir l’API", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-migration-sync-"))
    temporaryDirectories.push(directory)
    const sessionsDirectory = join(directory, "sessions")
    const databasePath = join(directory, "stats.sqlite")
    await mkdir(sessionsDirectory)
    await writeFile(
      join(sessionsDirectory, "session.jsonl"),
      JSON.stringify({
        type: "session",
        id: "session",
        timestamp: new Date().toISOString(),
        cwd: "/work/project",
      })
    )
    const database = createDatabase(databasePath)
    await new SessionSynchronizer(database, sessionsDirectory, []).sync()
    database.prepare("UPDATE indexed_files SET size = -1").run()
    database.close()

    const originalSync = SessionSynchronizer.prototype.sync
    let releaseSync = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      releaseSync = resolve
    })
    const syncSpy = vi
      .spyOn(SessionSynchronizer.prototype, "sync")
      .mockImplementation(function (this: SessionSynchronizer) {
        return gate.then(() => originalSync.call(this))
      })
    const server = new StatsServer({
      sessionsDirectory,
      databasePath,
      additionalDirectories: [],
    })
    const dashboardUrl = new URL(await server.start())
    const statsResponse = fetch(new URL("/api/stats?range=all", dashboardUrl), {
      headers: {
        Authorization: `Bearer ${dashboardUrl.searchParams.get("token")}`,
      },
    })

    try {
      expect(
        await Promise.race([
          statsResponse.then(() => true),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 50).unref()
          ),
        ])
      ).toBe(false)
      releaseSync()
      expect((await statsResponse).status).toBe(200)
    } finally {
      releaseSync()
      await server.close()
      syncSpy.mockRestore()
    }
  })

  it("attend une synchronisation en arrière-plan avant de fermer SQLite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-close-"))
    temporaryDirectories.push(directory)
    const server = new StatsServer({
      sessionsDirectory: directory,
      databasePath: join(directory, "stats.sqlite"),
      additionalDirectories: [],
    })
    const dashboardUrl = new URL(await server.start())
    const headers = {
      Authorization: `Bearer ${dashboardUrl.searchParams.get("token")}`,
    }
    await fetch(new URL("/api/sync/initial", dashboardUrl), { headers })

    let releaseSync = (): void => undefined
    const syncGate = new Promise<SyncResult>((resolve) => {
      releaseSync = () =>
        resolve({ scanned: 0, updated: 0, removed: 0, durationMs: 0 })
    })
    const syncSpy = vi
      .spyOn(SessionSynchronizer.prototype, "sync")
      .mockReturnValue(syncGate)
    const backgroundSync = (
      server as unknown as { sync(): Promise<SyncResult> }
    ).sync()
    const closePromise = server.close()

    try {
      expect(
        await Promise.race([
          closePromise.then(() => true),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 50).unref()
          ),
        ])
      ).toBe(false)
      releaseSync()
      await backgroundSync
      await closePromise
    } finally {
      releaseSync()
      await closePromise
      syncSpy.mockRestore()
    }
  })

  it("synchronise au démarrage et protège l’API avec un jeton", async () => {
    const piDirectory = await mkdtemp(join(tmpdir(), "pi-stats-server-"))
    temporaryDirectories.push(piDirectory)
    const sessionsDirectory = join(piDirectory, "sessions", "project")
    const futureTimestamp = new Date(Date.now() + 2 * 86_400_000).toISOString()
    await mkdir(sessionsDirectory, { recursive: true })
    const sessionFile = join(sessionsDirectory, "session.jsonl")
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "server-session",
          timestamp: new Date().toISOString(),
          cwd: "/work/project",
        }),
        JSON.stringify({
          type: "message",
          id: "assistant",
          parentId: null,
          timestamp: new Date().toISOString(),
          message: {
            role: "assistant",
            provider: "test",
            model: "test-model",
            stopReason: "stop",
            content: [
              {
                type: "toolCall",
                id: "tool-1",
                name: "read",
                arguments: { path: "/tmp/test-skill/SKILL.md" },
              },
            ],
            usage: {
              input: 4,
              output: 2,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 6,
              cost: { total: 0.01 },
            },
          },
        }),
        JSON.stringify({
          type: "message",
          id: "tool-result",
          parentId: "assistant",
          timestamp: new Date().toISOString(),
          message: {
            role: "toolResult",
            toolCallId: "tool-1",
            toolName: "read",
            isError: false,
            content: [],
          },
        }),
        JSON.stringify({
          type: "message",
          id: "future-assistant",
          parentId: "assistant",
          timestamp: futureTimestamp,
          message: {
            role: "assistant",
            provider: "test",
            model: "test-model",
            stopReason: "stop",
            content: [],
            usage: {
              input: 1_000,
              output: 1_000,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2_000,
              cost: { total: 2 },
            },
          },
        }),
      ].join("\n"),
      "utf8"
    )

    const databasePath = join(piDirectory, "stats.sqlite")
    const server = new StatsServer({
      sessionsDirectory,
      databasePath,
      additionalDirectories: [],
    })
    try {
      const dashboardUrl = new URL(await server.start())
      const token = dashboardUrl.searchParams.get("token")
      const apiUrl = new URL("/api/stats", dashboardUrl)

      expect((await fetch(apiUrl)).status).toBe(401)
      const headers = { Authorization: `Bearer ${token}` }
      expect(
        (await fetch(new URL("/api/sync/initial", dashboardUrl), { headers }))
          .status
      ).toBe(200)
      const response = await fetch(apiUrl, { headers })
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        overview: { requests: number; totalTokens: number }
        meta: { indexedSessions: number }
        timeseries: unknown[]
      }
      expect(body.overview).toMatchObject({ requests: 1, totalTokens: 6 })
      expect(body.meta.indexedSessions).toBe(1)
      expect(body.timeseries).toHaveLength(30)
      expect(body).not.toHaveProperty("sessions")

      const sessionsUrl = new URL(
        "/api/sessions?page=1&pageSize=10&sort=cost&direction=desc",
        dashboardUrl
      )
      expect((await fetch(sessionsUrl)).status).toBe(401)
      const sessionsResponse = await fetch(sessionsUrl, { headers })
      expect(sessionsResponse.status).toBe(200)
      expect(await sessionsResponse.json()).toMatchObject({
        page: 1,
        pageSize: 10,
        total: 1,
        rows: [{ id: "server-session", requests: 1, cost: 0.01 }],
      })
      expect(
        (
          await fetch(new URL("/api/sessions?page=0", dashboardUrl), {
            headers,
          })
        ).status
      ).toBe(400)

      await appendFile(
        sessionFile,
        `\n${JSON.stringify({ type: "message", id: "new-assistant", parentId: "assistant", timestamp: new Date().toISOString(), message: { role: "assistant", provider: "test", model: "test-model", stopReason: "stop", content: [], usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { total: 0.02 } } } })}`,
        "utf8"
      )
      const cached = await fetch(apiUrl, { headers })
      expect(
        (
          (await cached.json()) as {
            overview: { requests: number; totalTokens: number }
          }
        ).overview
      ).toMatchObject({ requests: 1, totalTokens: 6 })
      await fetch(new URL("/api/sync", dashboardUrl), {
        method: "POST",
        headers,
      })
      const synced = await fetch(apiUrl, { headers })
      expect(
        (
          (await synced.json()) as {
            overview: { requests: number; totalTokens: number }
          }
        ).overview
      ).toMatchObject({ requests: 2, totalTokens: 13 })

      const todayResponse = await fetch(
        new URL("/api/stats?range=today", dashboardUrl),
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const today = (await todayResponse.json()) as {
        filters: { range: string }
        overview: { requests: number }
        timeseries: unknown[]
      }
      expect(today.filters.range).toBe("today")
      expect(today.overview.requests).toBe(2)
      expect(today.timeseries).toHaveLength(1)

      const paddedHideUrl = new URL("/api/models/hide", dashboardUrl)
      paddedHideUrl.searchParams.set("provider", "test")
      paddedHideUrl.searchParams.set("model", " test-model ")
      const paddedHide = await fetch(paddedHideUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(paddedHide.status).toBe(404)

      const hideUrl = new URL("/api/models/hide", dashboardUrl)
      hideUrl.searchParams.set("provider", "test")
      hideUrl.searchParams.set("model", "test-model")
      expect((await fetch(hideUrl, { method: "POST" })).status).toBe(401)
      const hideResponse = await fetch(hideUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(hideResponse.status).toBe(200)
      expect(await hideResponse.json()).toEqual({
        hidden: true,
        projects: [],
        providers: [],
        models: [],
      })

      const afterHide = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const hiddenStats = (await afterHide.json()) as {
        overview: { requests: number }
        models: unknown[]
        hiddenModels: unknown[]
        tools: unknown[]
        skills: unknown[]
        options: {
          projects: unknown[]
          providers: unknown[]
          models: unknown[]
        }
      }
      expect(hiddenStats).toMatchObject({
        overview: { requests: 0 },
        models: [],
        hiddenModels: [{ model: "test-model", provider: "test" }],
        tools: [],
        skills: [],
        options: { projects: [], providers: [], models: [] },
      })

      const rawDatabase = new Database(databasePath, { readonly: true })
      expect(
        rawDatabase.prepare("SELECT COUNT(*) AS count FROM requests").get()
      ).toEqual({ count: 3 })
      expect(
        rawDatabase.prepare("SELECT COUNT(*) AS count FROM tool_calls").get()
      ).toEqual({ count: 1 })
      expect(
        rawDatabase.prepare("SELECT COUNT(*) AS count FROM skill_usages").get()
      ).toEqual({ count: 1 })
      rawDatabase.close()

      await appendFile(sessionFile, "\n", "utf8")
      await fetch(new URL("/api/sync", dashboardUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const afterResync = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(
        ((await afterResync.json()) as { overview: { requests: number } })
          .overview.requests
      ).toBe(0)

      const showUrl = new URL("/api/models/show", dashboardUrl)
      showUrl.searchParams.set("provider", "test")
      showUrl.searchParams.set("model", "test-model")
      const showResponse = await fetch(showUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(await showResponse.json()).toEqual({ shown: true })
      const afterShow = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const shownStats = (await afterShow.json()) as {
        overview: { requests: number }
        hiddenModels: unknown[]
      }
      expect(shownStats.overview.requests).toBe(2)
      expect(shownStats.hiddenModels).toEqual([])
    } finally {
      await server.close()
    }
  })
})
