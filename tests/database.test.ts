import Database from "better-sqlite3"
import { chmod, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createDatabase } from "../server/database.ts"
import { SessionSynchronizer } from "../server/sync.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

function createLegacyDatabase(path: string, version: 13 | 14 | 15 | 16) {
  const database = new Database(path)
  const agentColumns =
    version === 13
      ? ""
      : version === 14
        ? ", agent_id TEXT, agent_model TEXT, agent_tokens INTEGER, agent_cost REAL"
        : ", agent_id TEXT, agent_name TEXT, agent_description TEXT, agent_model TEXT, agent_tokens INTEGER, agent_cost REAL"
  database.exec(`
    CREATE TABLE indexed_files (
      path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL,
      indexed_at TEXT NOT NULL, retain_when_missing INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE hidden_models (
      provider TEXT NOT NULL, model TEXT NOT NULL, hidden_at TEXT NOT NULL,
      PRIMARY KEY (provider, model)
    );
    CREATE TABLE project_aliases (cwd TEXT PRIMARY KEY, project TEXT NOT NULL);
    CREATE TABLE sessions (
      file_path TEXT PRIMARY KEY, session_id TEXT NOT NULL, cwd TEXT NOT NULL,
      name TEXT, started_at TEXT NOT NULL, parent_session TEXT
    );
    CREATE TABLE requests (
      id TEXT NOT NULL, source_key TEXT NOT NULL, file_path TEXT NOT NULL,
      session_id TEXT NOT NULL, cwd TEXT NOT NULL, timestamp TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL,
      cost REAL NOT NULL, is_error INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
      PRIMARY KEY (id, file_path)
    );
    CREATE TABLE tool_calls (
      id TEXT NOT NULL, source_key TEXT NOT NULL, file_path TEXT NOT NULL,
      session_id TEXT NOT NULL, cwd TEXT NOT NULL, name TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, started_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL, is_error INTEGER NOT NULL${agentColumns},
      PRIMARY KEY (id, file_path)
    );
    CREATE TABLE skill_usages (
      id TEXT NOT NULL, source_key TEXT NOT NULL, file_path TEXT NOT NULL,
      session_id TEXT NOT NULL, cwd TEXT NOT NULL, skill TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, used_at TEXT NOT NULL,
      PRIMARY KEY (id, file_path)
    );
    INSERT INTO sessions VALUES
      ('/sessions/parent.jsonl', 'parent', '/work/project', 'Parent',
       '2026-01-01T00:00:00.000Z', NULL),
      ('/tmp/pi-subagents/project/parent/tasks/agent-1.output', 'agent-1',
       '/work/project', NULL, '2026-01-01T00:00:01.000Z', 'parent');
    INSERT INTO requests VALUES
      ('request-1', 'response-1',
       '/tmp/pi-subagents/project/parent/tasks/agent-1.output', 'parent',
       '/work/project', '2026-01-01T00:00:02.000Z', 'openai', 'gpt-child',
       70, 20, 100, 0.2, 0, 1000);
    INSERT INTO indexed_files VALUES
      ('/sessions/parent.jsonl', 42, 1, '2026-01-01T00:00:00.000Z', 0),
      ('/tmp/pi-subagents/project/parent/tasks/agent-1.output', 84, 2,
       '2026-01-01T00:00:01.000Z', 1);
    PRAGMA user_version = ${version};
  `)
  if (version === 13) {
    database
      .prepare(
        "INSERT INTO tool_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        "call-1",
        "call-source",
        "/sessions/parent.jsonl",
        "parent",
        "/work/project",
        "Agent",
        "openai",
        "gpt-main",
        "2026-01-01T00:00:01.000Z",
        1000,
        0
      )
  } else if (version === 14) {
    database
      .prepare(
        "INSERT INTO tool_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        "call-1",
        "call-source",
        "/sessions/parent.jsonl",
        "parent",
        "/work/project",
        "Agent",
        "openai",
        "gpt-main",
        "2026-01-01T00:00:01.000Z",
        1000,
        0,
        "agent-1",
        "gpt child label",
        100,
        0.2
      )
  } else {
    database
      .prepare(
        "INSERT INTO tool_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        "call-1",
        "call-source",
        "/sessions/parent.jsonl",
        "parent",
        "/work/project",
        "Agent",
        "openai",
        "gpt-main",
        "2026-01-01T00:00:01.000Z",
        1000,
        0,
        "agent-1",
        "reviewer",
        "Review changes",
        "gpt child label",
        100,
        0.2
      )
  }
  database.close()
}

describe("createDatabase", () => {
  it("crée directement le schéma normalisé", () => {
    const database = createDatabase(":memory:")
    expect(database.pragma("user_version", { simple: true })).toBe(21)
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .pluck()
        .all()
    ).toEqual(
      expect.arrayContaining(["agent_observations", "agent_runs", "requests"])
    )
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'view'")
        .pluck()
        .all()
    ).toContain("accounted_usage")
    database.close()
  })

  it.each([13, 14, 15, 16] as const)(
    "migre le schéma %s sans perdre le transcript temporaire",
    async (version) => {
      const directory = await mkdtemp(join(tmpdir(), `pi-stats-v${version}-`))
      temporaryDirectories.push(directory)
      const databasePath = join(directory, "stats.sqlite")
      createLegacyDatabase(databasePath, version)

      const database = createDatabase(databasePath)

      expect(database.pragma("user_version", { simple: true })).toBe(21)
      expect(
        database
          .prepare("PRAGMA table_info(tool_calls)")
          .all()
          .map((column) => (column as { name: string }).name)
      ).toEqual(expect.arrayContaining(["agent_run_key", "usage_scope"]))
      expect(
        database
          .prepare("PRAGMA table_info(skill_usages)")
          .all()
          .map((column) => (column as { name: string }).name)
      ).toEqual(expect.arrayContaining(["agent_run_key", "usage_scope"]))
      expect(
        database
          .prepare(
            "SELECT session_id, accounting_session_id, agent_run_key, source_channel FROM requests"
          )
          .get()
      ).toEqual({
        session_id: "agent-1",
        accounting_session_id: "parent",
        agent_run_key: "legacy:tintinweb:parent:agent-1",
        source_channel: "external-artifact",
      })
      expect(
        database
          .prepare(
            "SELECT total_tokens, total_cost, channel, status_raw, status_canonical FROM agent_observations WHERE channel = 'legacy-output'"
          )
          .get()
      ).toEqual({
        total_tokens: 100,
        total_cost: 0.2,
        channel: "legacy-output",
        status_raw: null,
        status_canonical: "unknown",
      })
      expect(
        database
          .prepare(
            "SELECT size, retain_when_missing FROM indexed_files WHERE path LIKE '%.output'"
          )
          .get()
      ).toEqual({ size: -1, retain_when_missing: 1 })
      if (version >= 14)
        expect(
          database
            .prepare(
              "SELECT model_label, model_precision FROM agent_runs WHERE native_id = 'agent-1'"
            )
            .get()
        ).toEqual({
          model_label: "gpt child label",
          model_precision: "estimated",
        })

      await new SessionSynchronizer(database, directory, []).sync()
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM agent_observations WHERE channel = 'legacy-output'"
          )
          .get()
      ).toEqual({ count: 1 })
      expect(
        database
          .prepare(
            "SELECT status_canonical FROM agent_runs WHERE native_id = 'agent-1'"
          )
          .pluck()
          .get()
      ).toBe("unknown")
      database.close()
    }
  )

  it("utilise l’index request_key pour dédupliquer les requêtes", () => {
    const database = createDatabase(":memory:")
    const plan = database
      .prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM unique_requests")
      .all() as Array<{ detail: string }>

    expect(plan.map(({ detail }) => detail)).toContain(
      "SEARCH original USING INDEX requests_key_idx (request_key=?)"
    )
    database.close()
  })

  it("migre le schéma 19 et exige une réconciliation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-v19-"))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, "stats.sqlite")
    const version19 = createDatabase(databasePath)
    version19
      .prepare(
        "INSERT INTO indexed_files (path, size, mtime_ms, indexed_at) VALUES ('session.jsonl', 10, 1, '2026-01-01T00:00:00.000Z')"
      )
      .run()
    version19.exec(`
      DROP TABLE deleted_agent_usage;
      DROP TABLE deleted_model_records;
      DROP TRIGGER skip_deleted_requests;
      DROP TRIGGER skip_deleted_tool_calls;
      DROP TRIGGER skip_deleted_skill_usages;
      DROP VIEW accounted_usage;
      DROP VIEW unique_requests;
      DROP VIEW unique_tool_calls;
      DROP VIEW unique_skill_usages;
      DROP INDEX tool_calls_agent_idx;
      DROP INDEX skill_usages_agent_idx;
      ALTER TABLE tool_calls DROP COLUMN usage_scope;
      ALTER TABLE tool_calls DROP COLUMN agent_run_key;
      ALTER TABLE skill_usages DROP COLUMN usage_scope;
      ALTER TABLE skill_usages DROP COLUMN agent_run_key;
      PRAGMA user_version = 19;
    `)
    version19.close()

    const migrated = createDatabase(databasePath)

    expect(migrated.pragma("user_version", { simple: true })).toBe(21)
    expect(
      migrated.prepare("SELECT size FROM indexed_files").pluck().get()
    ).toBe(-1)
    expect(
      migrated
        .prepare("PRAGMA table_info(tool_calls)")
        .all()
        .map((column) => (column as { name: string }).name)
    ).toEqual(expect.arrayContaining(["agent_run_key", "usage_scope"]))
    migrated.close()
  })

  it("migre le schéma 20 sans réindexer ni perdre les modèles masqués", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-v20-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "stats.sqlite")
    const previous = createDatabase(path)
    previous.exec(`
      DROP TABLE deleted_agent_usage;
      DROP TABLE deleted_model_records;
      DROP TRIGGER skip_deleted_requests;
      DROP TRIGGER skip_deleted_tool_calls;
      DROP TRIGGER skip_deleted_skill_usages;
      INSERT INTO hidden_models VALUES ('test', 'model', '2026-01-01');
      INSERT INTO indexed_files (path, size, mtime_ms, indexed_at)
        VALUES ('session.jsonl', 10, 1, '2026-01-01');
      PRAGMA user_version = 20;
    `)
    previous.close()
    const migrated = createDatabase(path)
    try {
      expect(migrated.pragma("user_version", { simple: true })).toBe(21)
      expect(
        migrated.prepare("SELECT size FROM indexed_files").pluck().get()
      ).toBe(10)
      expect(
        migrated.prepare("SELECT model FROM hidden_models").pluck().get()
      ).toBe("model")
      expect(
        migrated
          .prepare("SELECT COUNT(*) FROM deleted_model_records")
          .pluck()
          .get()
      ).toBe(0)
    } finally {
      migrated.close()
    }
  })

  it("refuse une base future sans la modifier", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-future-"))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, "stats.sqlite")
    createLegacyDatabase(databasePath, 16)
    const future = new Database(databasePath)
    future.pragma("user_version = 22")
    future.close()
    await chmod(directory, 0o755)
    await chmod(databasePath, 0o644)

    expect(() => createDatabase(databasePath)).toThrow(
      "Unsupported stats database schema 22"
    )

    const unchanged = new Database(databasePath)
    expect(unchanged.pragma("user_version", { simple: true })).toBe(22)
    expect((await stat(directory)).mode & 0o777).toBe(0o755)
    expect((await stat(databasePath)).mode & 0o777).toBe(0o644)
    expect(
      unchanged.prepare("SELECT COUNT(*) AS count FROM requests").get()
    ).toEqual({
      count: 1,
    })
    expect(
      unchanged
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_runs'"
        )
        .get()
    ).toBeUndefined()
    unchanged.close()
  })

  it("refuse un schéma version zéro non vide sans le reconstruire", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-stats-unknown-"))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, "stats.sqlite")
    const unknown = new Database(databasePath)
    unknown.exec(
      "CREATE TABLE private_history (value TEXT); INSERT INTO private_history VALUES ('keep');"
    )
    unknown.close()

    expect(() => createDatabase(databasePath)).toThrow(
      "Unsupported stats database schema 0"
    )
    const unchanged = new Database(databasePath)
    expect(
      unchanged.prepare("SELECT value FROM private_history").pluck().get()
    ).toBe("keep")
    unchanged.close()
  })

  it.skipIf(process.platform === "win32")(
    "protège le dossier et la base sur les systèmes POSIX",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "pi-stats-permissions-"))
      temporaryDirectories.push(directory)
      const databaseDirectory = join(directory, "stats")
      const databasePath = join(databaseDirectory, "stats.sqlite")

      createDatabase(databasePath).close()

      expect((await stat(databaseDirectory)).mode & 0o777).toBe(0o700)
      expect((await stat(databasePath)).mode & 0o777).toBe(0o600)
    }
  )
})
