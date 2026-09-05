import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import { readFile } from "node:fs/promises"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { defaultAgentArtifactRoots } from "./agent-adapters/index.ts"
import {
  createDatabase,
  getSessionsDirectory,
  type SqliteDatabase,
} from "./database.ts"
import {
  getSessions,
  getSessionTrace,
  getStats,
  parseFilters,
  parseSessionPageOptions,
} from "./stats.ts"
import { SessionSynchronizer } from "./sync.ts"
import type { SyncResult } from "./types.ts"

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
}
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
}

interface StatsServerOptions {
  sessionsDirectory?: string
  databasePath?: string
  additionalDirectories?: string[]
}

export class StatsServer {
  private readonly token = randomBytes(32).toString("base64url")
  private readonly assetRoot = resolve(
    import.meta.dirname,
    "..",
    "dist",
    "client"
  )
  private readonly db: SqliteDatabase
  private readonly synchronizer: SessionSynchronizer
  private server: Server | null = null
  private port: number | null = null
  private startPromise: Promise<void> | null = null
  private autoSyncTimer: NodeJS.Timeout | null = null
  private activeSync: Promise<SyncResult> | null = null
  private initialSync: Promise<SyncResult> | null = null
  private lastSyncAt: string | null = null
  private requiresInitialSync = false

  constructor(options: StatsServerOptions = {}) {
    this.db = createDatabase(options.databasePath)
    this.requiresInitialSync =
      !this.db.prepare("SELECT 1 FROM indexed_files LIMIT 1").get() ||
      Boolean(
        this.db
          .prepare("SELECT 1 FROM indexed_files WHERE size = -1 LIMIT 1")
          .get()
      )
    this.synchronizer = new SessionSynchronizer(
      this.db,
      options.sessionsDirectory ?? getSessionsDirectory(),
      options.additionalDirectories ?? defaultAgentArtifactRoots()
    )
  }

  async start(): Promise<string> {
    if (!this.startPromise) {
      this.server = createServer((request, response) => {
        void this.handle(request, response)
      })
      this.startPromise = new Promise<void>((resolveStart, reject) => {
        this.server?.once("error", reject)
        this.server?.listen(0, "127.0.0.1", () => {
          this.server?.off("error", reject)
          const address = this.server?.address()
          if (!address || typeof address === "string")
            return reject(new Error("Local address unavailable"))
          this.port = address.port
          resolveStart()
        })
      }).then(() => {
        void this.ensureInitialSync().catch(() => undefined)
        this.autoSyncTimer = setInterval(() => {
          void this.sync().catch(() => undefined)
        }, 30_000)
        this.autoSyncTimer.unref()
      })
    }
    await this.startPromise
    return this.url
  }

  get url(): string {
    if (!this.port) throw new Error("Server not started")
    return `http://127.0.0.1:${this.port}/?token=${encodeURIComponent(this.token)}`
  }

  async close(): Promise<void> {
    if (this.autoSyncTimer) clearInterval(this.autoSyncTimer)
    this.autoSyncTimer = null
    const server = this.server
    this.server = null
    this.port = null
    if (server)
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose())
      )
    await this.initialSync?.catch(() => undefined)
    await this.activeSync?.catch(() => undefined)
    this.initialSync = null
    this.startPromise = null
    this.db.close()
  }

  private ensureInitialSync(): Promise<SyncResult> {
    const promise = (this.initialSync ??= this.sync())
    void promise.catch(() => {
      if (this.initialSync === promise) this.initialSync = null
    })
    return promise
  }

  private sync(): Promise<SyncResult> {
    if (!this.activeSync) {
      this.activeSync = this.synchronizer
        .sync()
        .then((result) => {
          this.lastSyncAt = new Date().toISOString()
          this.requiresInitialSync = false
          return result
        })
        .finally(() => {
          this.activeSync = null
        })
    }
    return this.activeSync
  }

  private authorized(request: IncomingMessage): boolean {
    const value = request.headers.authorization
    if (!value?.startsWith("Bearer ")) return false
    const supplied = Buffer.from(value.slice(7))
    const expected = Buffer.from(this.token)
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    )
  }

  private hideModel(
    provider: string,
    model: string
  ): {
    hidden: boolean
    projects: string[]
    providers: string[]
    models: string[]
  } | null {
    return this.db.transaction(() => {
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM accounted_usage WHERE provider = ? AND model = ? LIMIT 1"
          )
          .get(provider, model)
      )
        return null
      this.db
        .prepare(
          "INSERT OR IGNORE INTO hidden_models (provider, model, hidden_at) VALUES (?, ?, ?)"
        )
        .run(provider, model, new Date().toISOString())
      return {
        hidden: true,
        projects: this.db
          .prepare(
            "SELECT DISTINCT project FROM accounted_usage WHERE project <> '' ORDER BY project"
          )
          .pluck()
          .all() as string[],
        providers: this.db
          .prepare(
            "SELECT DISTINCT provider FROM accounted_usage WHERE provider <> 'unknown' ORDER BY provider"
          )
          .pluck()
          .all() as string[],
        models: this.db
          .prepare(
            "SELECT DISTINCT model FROM accounted_usage WHERE model <> 'unknown' ORDER BY model"
          )
          .pluck()
          .all() as string[],
      }
    })()
  }

  private showModel(provider: string, model: string): boolean {
    return (
      this.db
        .prepare("DELETE FROM hidden_models WHERE provider = ? AND model = ?")
        .run(provider, model).changes > 0
    )
  }

  private send(
    response: ServerResponse,
    status: number,
    body: string,
    contentType: string
  ): void {
    response.writeHead(status, {
      ...SECURITY_HEADERS,
      "Content-Type": contentType,
      "Content-Length": Buffer.byteLength(body),
    })
    response.end(body)
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (url.pathname.startsWith("/api/")) {
        if (!this.authorized(request))
          return this.send(
            response,
            401,
            JSON.stringify({ error: "Unauthorized" }),
            "application/json; charset=utf-8"
          )
        if (request.method === "GET" && url.pathname === "/api/health")
          return this.send(
            response,
            200,
            JSON.stringify({ ok: true }),
            "application/json; charset=utf-8"
          )
        if (request.method === "GET" && url.pathname === "/api/sync/initial")
          return this.send(
            response,
            200,
            JSON.stringify(await this.ensureInitialSync()),
            "application/json; charset=utf-8"
          )
        if (request.method === "POST" && url.pathname === "/api/sync")
          return this.send(
            response,
            200,
            JSON.stringify(await this.sync()),
            "application/json; charset=utf-8"
          )
        if (this.requiresInitialSync) await this.ensureInitialSync()
        if (request.method === "GET" && url.pathname === "/api/stats")
          return this.send(
            response,
            200,
            JSON.stringify(
              getStats(this.db, parseFilters(url.searchParams), this.lastSyncAt)
            ),
            "application/json; charset=utf-8"
          )
        if (request.method === "GET" && url.pathname === "/api/sessions") {
          const options = parseSessionPageOptions(url.searchParams)
          if (!options)
            return this.send(
              response,
              400,
              JSON.stringify({ error: "Invalid session pagination" }),
              "application/json; charset=utf-8"
            )
          return this.send(
            response,
            200,
            JSON.stringify(
              getSessions(this.db, parseFilters(url.searchParams), options)
            ),
            "application/json; charset=utf-8"
          )
        }
        if (request.method === "GET" && url.pathname === "/api/session-trace") {
          const id = url.searchParams.get("id") ?? ""
          const project = url.searchParams.get("project")
          if (
            !id ||
            id.length > 500 ||
            project === null ||
            project.length > 4_096
          )
            return this.send(
              response,
              400,
              JSON.stringify({ error: "Invalid session selection" }),
              "application/json; charset=utf-8"
            )
          const trace = getSessionTrace(this.db, id, project)
          return this.send(
            response,
            trace ? 200 : 404,
            JSON.stringify(trace ?? { error: "Session not found" }),
            "application/json; charset=utf-8"
          )
        }
        if (request.method === "POST" && url.pathname === "/api/models/hide") {
          const provider = url.searchParams.get("provider") ?? ""
          const model = url.searchParams.get("model") ?? ""
          if (
            !provider ||
            !model ||
            provider.length > 500 ||
            model.length > 500
          )
            return this.send(
              response,
              400,
              JSON.stringify({ error: "Invalid provider or model" }),
              "application/json; charset=utf-8"
            )
          const result = this.hideModel(provider, model)
          return result
            ? this.send(
                response,
                200,
                JSON.stringify(result),
                "application/json; charset=utf-8"
              )
            : this.send(
                response,
                404,
                JSON.stringify({ error: "Model not found" }),
                "application/json; charset=utf-8"
              )
        }
        if (request.method === "POST" && url.pathname === "/api/models/show") {
          const provider = url.searchParams.get("provider") ?? ""
          const model = url.searchParams.get("model") ?? ""
          if (
            !provider ||
            !model ||
            provider.length > 500 ||
            model.length > 500
          )
            return this.send(
              response,
              400,
              JSON.stringify({ error: "Invalid provider or model" }),
              "application/json; charset=utf-8"
            )
          return this.send(
            response,
            200,
            JSON.stringify({ shown: this.showModel(provider, model) }),
            "application/json; charset=utf-8"
          )
        }
        return this.send(
          response,
          404,
          JSON.stringify({ error: "Not found" }),
          "application/json; charset=utf-8"
        )
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        return this.send(
          response,
          405,
          "Method not allowed",
          "text/plain; charset=utf-8"
        )
      await this.asset(request.method, url.pathname, response)
    } catch {
      this.send(
        response,
        500,
        JSON.stringify({ error: "Internal server error" }),
        "application/json; charset=utf-8"
      )
    }
  }

  private async asset(
    method: string | undefined,
    pathname: string,
    response: ServerResponse
  ): Promise<void> {
    let requested: string
    try {
      requested = decodeURIComponent(pathname)
    } catch {
      return this.send(
        response,
        400,
        "Bad request",
        "text/plain; charset=utf-8"
      )
    }
    const candidate = resolve(this.assetRoot, `.${requested}`)
    const relativePath = relative(this.assetRoot, candidate)
    const isConfined =
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath)
    const isAsset = isConfined && extname(candidate) !== ""
    const path = isAsset ? candidate : join(this.assetRoot, "index.html")
    try {
      const body = await readFile(path)
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": MIME_TYPES[extname(path)] ?? "application/octet-stream",
        "Content-Length": body.length,
      })
      response.end(method === "HEAD" ? undefined : body)
    } catch {
      if (isAsset)
        return this.send(
          response,
          404,
          "Not found",
          "text/plain; charset=utf-8"
        )
      this.send(
        response,
        503,
        "Dashboard assets are not built",
        "text/plain; charset=utf-8"
      )
    }
  }
}
