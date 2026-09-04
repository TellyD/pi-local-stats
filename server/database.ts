import Database from "better-sqlite3"
import { chmodSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type SqliteDatabase = Database.Database

const SCHEMA_VERSION = 20

const UNIQUE_VIEWS_SQL = `
  CREATE VIEW unique_requests AS
    SELECT candidate.*, COALESCE(alias.project, candidate.cwd) AS project
    FROM requests AS candidate
    LEFT JOIN project_aliases AS alias ON alias.cwd = candidate.cwd
    WHERE NOT EXISTS (
      SELECT 1 FROM hidden_models
      WHERE provider = candidate.provider AND model = candidate.model
    ) AND candidate.rowid = (
      SELECT original.rowid FROM requests AS original
      JOIN sessions AS owner ON owner.file_path = original.file_path
      WHERE original.request_key = candidate.request_key
      ORDER BY CASE original.source_channel
          WHEN 'pi-session' THEN 0 WHEN 'external-artifact' THEN 1 ELSE 2 END,
        owner.parent_session IS NOT NULL, owner.started_at,
        original.file_path, original.rowid
      LIMIT 1
    );
  CREATE VIEW unique_tool_calls AS
    SELECT candidate.*, COALESCE(alias.project, candidate.cwd) AS project
    FROM tool_calls AS candidate
    LEFT JOIN project_aliases AS alias ON alias.cwd = candidate.cwd
    WHERE candidate.usage_scope = 'self' AND NOT EXISTS (
      SELECT 1 FROM hidden_models
      WHERE provider = candidate.provider AND model = candidate.model
    ) AND candidate.rowid = (
      SELECT original.rowid FROM tool_calls AS original
      JOIN sessions AS owner ON owner.file_path = original.file_path
      WHERE original.source_key = candidate.source_key
        AND original.usage_scope = 'self'
      ORDER BY owner.parent_session IS NOT NULL, owner.started_at,
        original.file_path, original.rowid
      LIMIT 1
    );
  CREATE VIEW unique_skill_usages AS
    SELECT candidate.*, COALESCE(alias.project, candidate.cwd) AS project
    FROM skill_usages AS candidate
    LEFT JOIN project_aliases AS alias ON alias.cwd = candidate.cwd
    WHERE candidate.usage_scope = 'self' AND NOT EXISTS (
      SELECT 1 FROM hidden_models
      WHERE provider = candidate.provider AND model = candidate.model
    ) AND candidate.rowid = (
      SELECT original.rowid FROM skill_usages AS original
      JOIN sessions AS owner ON owner.file_path = original.file_path
      WHERE original.source_key = candidate.source_key
        AND original.usage_scope = 'self'
      ORDER BY owner.parent_session IS NOT NULL, owner.started_at,
        original.file_path, original.rowid
      LIMIT 1
    );
  CREATE VIEW accounted_usage AS
    SELECT request.id, request.accounting_session_id AS session_id,
      request.cwd, request.timestamp, request.provider, request.model,
      request.input_tokens, request.output_tokens,
      request.cache_read_tokens, request.cache_write_tokens,
      request.total_tokens, request.cost, request.is_error,
      request.duration_ms, request.project, 1 AS request_count
    FROM unique_requests AS request
    WHERE request.usage_scope = 'self'
    UNION ALL
    SELECT run.run_key AS id, run.root_session_id AS session_id,
      COALESCE(root.cwd, '') AS cwd,
      COALESCE(run.started_at, root.started_at) AS timestamp,
      COALESCE(run.provider, 'unknown') AS provider,
      COALESCE(run.model_id, 'unknown') AS model,
      COALESCE(run.input_tokens, 0) AS input_tokens,
      run.output_tokens,
      COALESCE(run.cache_read_tokens, 0) AS cache_read_tokens,
      run.cache_write_tokens,
      COALESCE(run.total_tokens, 0) AS total_tokens,
      COALESCE(run.total_cost, 0) AS cost,
      CASE WHEN COALESCE(run.request_count, 0) > 0
        AND run.status_canonical = 'failed' THEN 1 ELSE 0 END AS is_error,
      CASE WHEN run.started_at IS NOT NULL AND run.completed_at IS NOT NULL
        THEN MAX(0, CAST((julianday(run.completed_at) - julianday(run.started_at)) * 86400000 AS INTEGER))
        ELSE 0 END AS duration_ms,
      COALESCE(alias.project, root.cwd, '') AS project,
      COALESCE(run.request_count, 0) AS request_count
    FROM agent_runs AS run
    LEFT JOIN sessions AS root ON root.file_path = run.root_session_file
      OR (run.root_session_file IS NULL AND root.session_id = run.root_session_id)
    LEFT JOIN project_aliases AS alias ON alias.cwd = root.cwd
    WHERE run.included_in_session_total = 1
      AND NOT EXISTS (
        SELECT 1 FROM requests AS request
        WHERE request.agent_run_key = run.run_key
          AND request.usage_scope = 'self'
      )
      AND NOT EXISTS (
        SELECT 1 FROM hidden_models
        WHERE provider = COALESCE(run.provider, 'unknown')
          AND model = COALESCE(run.model_id, 'unknown')
      );
`

const AGENT_TABLES_SQL = `
  CREATE TABLE agent_observations (
    observation_key TEXT PRIMARY KEY,
    logical_key TEXT NOT NULL,
    run_key TEXT NOT NULL,
    native_run_key TEXT NOT NULL,
    native_id TEXT NOT NULL,
    adapter TEXT NOT NULL,
    channel TEXT NOT NULL,
    source_path TEXT NOT NULL,
    source_entry_id TEXT,
    artifact_version TEXT,
    root_session_ref TEXT,
    root_session_file TEXT,
    session_file TEXT,
    parent_native_id TEXT,
    workflow_id TEXT,
    workflow_step_index INTEGER,
    agent_type TEXT,
    display_name TEXT,
    description TEXT,
    status_raw TEXT,
    status_canonical TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    provider TEXT,
    model_id TEXT,
    model_label TEXT,
    usage_scope TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    total_tokens INTEGER,
    total_cost REAL,
    request_count INTEGER,
    tool_count INTEGER,
    turn_count INTEGER,
    identity_precision TEXT NOT NULL,
    linkage_precision TEXT NOT NULL,
    model_precision TEXT NOT NULL,
    token_precision TEXT NOT NULL,
    cost_precision TEXT NOT NULL,
    metadata_priority INTEGER NOT NULL,
    usage_priority INTEGER NOT NULL
  );
  CREATE INDEX agent_observations_run_idx
    ON agent_observations(logical_key, metadata_priority, usage_priority);
  CREATE INDEX agent_observations_source_idx
    ON agent_observations(source_path);
  CREATE TABLE agent_runs (
    run_key TEXT PRIMARY KEY,
    logical_key TEXT NOT NULL,
    adapter TEXT NOT NULL,
    native_id TEXT NOT NULL,
    root_session_id TEXT,
    root_session_file TEXT,
    parent_run_key TEXT,
    parent_native_id TEXT,
    workflow_id TEXT,
    workflow_step_index INTEGER,
    depth INTEGER NOT NULL,
    agent_type TEXT,
    display_name TEXT,
    description TEXT,
    status_raw TEXT,
    status_canonical TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    provider TEXT,
    model_id TEXT,
    model_label TEXT,
    selected_channel TEXT,
    usage_scope TEXT,
    identity_precision TEXT NOT NULL,
    linkage_precision TEXT NOT NULL,
    model_precision TEXT NOT NULL,
    token_precision TEXT NOT NULL,
    cost_precision TEXT NOT NULL,
    coverage TEXT NOT NULL,
    included_in_session_total INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    total_tokens INTEGER,
    total_cost REAL,
    request_count INTEGER,
    tool_count INTEGER,
    turn_count INTEGER,
    provenance_json TEXT NOT NULL
  );
  CREATE INDEX agent_runs_root_idx
    ON agent_runs(root_session_id, root_session_file);
  CREATE INDEX agent_runs_parent_idx ON agent_runs(parent_run_key);
`

const SCHEMA_SQL = `
  CREATE TABLE indexed_files (
    path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    indexed_at TEXT NOT NULL,
    retain_when_missing INTEGER NOT NULL DEFAULT 0,
    source_channel TEXT NOT NULL DEFAULT 'pi-session'
  );
  CREATE TABLE hidden_models (
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    hidden_at TEXT NOT NULL,
    PRIMARY KEY (provider, model)
  );
  CREATE TABLE project_aliases (
    cwd TEXT PRIMARY KEY,
    project TEXT NOT NULL
  );
  CREATE TABLE sessions (
    file_path TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    name TEXT,
    started_at TEXT NOT NULL,
    parent_session TEXT,
    accounting_session_id TEXT NOT NULL,
    agent_run_key TEXT,
    session_kind TEXT NOT NULL DEFAULT 'root',
    linkage_precision TEXT NOT NULL DEFAULT 'unknown'
  );
  CREATE INDEX sessions_id_idx ON sessions(session_id);
  CREATE INDEX sessions_parent_idx ON sessions(parent_session);
  CREATE TABLE requests (
    id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    request_key TEXT,
    file_path TEXT NOT NULL,
    session_id TEXT NOT NULL,
    accounting_session_id TEXT NOT NULL,
    agent_run_key TEXT,
    cwd TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER,
    cache_read_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER,
    total_tokens INTEGER NOT NULL,
    cost REAL NOT NULL,
    is_error INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    source_channel TEXT NOT NULL DEFAULT 'pi-session',
    usage_scope TEXT NOT NULL DEFAULT 'self',
    token_precision TEXT NOT NULL DEFAULT 'exact',
    cost_precision TEXT NOT NULL DEFAULT 'exact',
    PRIMARY KEY (id, file_path)
  );
  CREATE INDEX requests_source_idx ON requests(source_key);
  CREATE INDEX requests_key_idx ON requests(request_key);
  CREATE INDEX requests_filter_idx ON requests(timestamp, cwd, provider, model);
  CREATE INDEX requests_file_idx ON requests(file_path);
  CREATE INDEX requests_agent_idx ON requests(agent_run_key, source_channel);
  CREATE TABLE tool_calls (
    id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    file_path TEXT NOT NULL,
    session_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    is_error INTEGER NOT NULL,
    agent_id TEXT,
    agent_name TEXT,
    agent_description TEXT,
    agent_model TEXT,
    agent_tokens INTEGER,
    agent_cost REAL,
    agent_run_key TEXT,
    usage_scope TEXT NOT NULL DEFAULT 'self' CHECK (usage_scope IN ('self', 'duplicate')),
    PRIMARY KEY (id, file_path)
  );
  CREATE INDEX tool_calls_source_idx ON tool_calls(source_key);
  CREATE INDEX tool_calls_filter_idx ON tool_calls(started_at, cwd, provider, model, name);
  CREATE INDEX tool_calls_file_idx ON tool_calls(file_path);
  CREATE INDEX tool_calls_agent_idx ON tool_calls(agent_run_key, usage_scope);
  CREATE TABLE skill_usages (
    id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    file_path TEXT NOT NULL,
    session_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    skill TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    used_at TEXT NOT NULL,
    agent_run_key TEXT,
    usage_scope TEXT NOT NULL DEFAULT 'self' CHECK (usage_scope IN ('self', 'duplicate')),
    PRIMARY KEY (id, file_path)
  );
  CREATE INDEX skill_usages_source_idx ON skill_usages(source_key);
  CREATE INDEX skill_usages_filter_idx ON skill_usages(used_at, cwd, provider, model, skill);
  CREATE INDEX skill_usages_file_idx ON skill_usages(file_path);
  CREATE INDEX skill_usages_agent_idx ON skill_usages(agent_run_key, usage_scope);
  ${AGENT_TABLES_SQL}
  ${UNIQUE_VIEWS_SQL}
`

function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

export function getPiDirectory(): string {
  return expandHome(
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent")
  )
}

export function getSessionsDirectory(): string {
  return expandHome(
    process.env.PI_CODING_AGENT_SESSION_DIR ??
      join(getPiDirectory(), "sessions")
  )
}

function failUnsupported(db: SqliteDatabase, version: number): never {
  db.close()
  throw new Error(
    `Unsupported stats database schema ${version}; expected ${SCHEMA_VERSION}. The database was left unchanged.`
  )
}

function execMigration(db: SqliteDatabase, sql: string): void {
  try {
    db.exec(sql)
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK")
    db.close()
    throw error
  }
}

function migrateTo16(db: SqliteDatabase, version: number): void {
  if (version === 13) {
    execMigration(
      db,
      `
      BEGIN IMMEDIATE;
      ALTER TABLE tool_calls ADD COLUMN agent_id TEXT;
      ALTER TABLE tool_calls ADD COLUMN agent_name TEXT;
      ALTER TABLE tool_calls ADD COLUMN agent_description TEXT;
      ALTER TABLE tool_calls ADD COLUMN agent_model TEXT;
      ALTER TABLE tool_calls ADD COLUMN agent_tokens INTEGER;
      ALTER TABLE tool_calls ADD COLUMN agent_cost REAL;
      UPDATE indexed_files SET size = -1 WHERE path LIKE '%.jsonl';
      PRAGMA user_version = 16;
      COMMIT;
    `
    )
  } else if (version === 14) {
    execMigration(
      db,
      `
      BEGIN IMMEDIATE;
      ALTER TABLE tool_calls ADD COLUMN agent_name TEXT;
      ALTER TABLE tool_calls ADD COLUMN agent_description TEXT;
      UPDATE indexed_files SET size = -1 WHERE path LIKE '%.jsonl';
      PRAGMA user_version = 16;
      COMMIT;
    `
    )
  } else if (version === 15) {
    execMigration(
      db,
      `
      BEGIN IMMEDIATE;
      UPDATE indexed_files SET size = -1 WHERE path LIKE '%.jsonl';
      PRAGMA user_version = 16;
      COMMIT;
    `
    )
  }
}

function ownershipColumnsSql(db: SqliteDatabase): string {
  const columns = (table: "tool_calls" | "skill_usages") =>
    new Set(
      (
        db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string
        }>
      ).map(({ name }) => name)
    )
  const statements: string[] = []
  for (const table of ["tool_calls", "skill_usages"] as const) {
    const existing = columns(table)
    if (!existing.has("agent_run_key"))
      statements.push(`ALTER TABLE ${table} ADD COLUMN agent_run_key TEXT;`)
    if (!existing.has("usage_scope"))
      statements.push(
        `ALTER TABLE ${table} ADD COLUMN usage_scope TEXT NOT NULL DEFAULT 'self' CHECK (usage_scope IN ('self', 'duplicate'));`
      )
  }
  return statements.join("\n")
}

function migrate16To17(db: SqliteDatabase): void {
  const ownershipColumns = ownershipColumnsSql(db)
  execMigration(
    db,
    `
    BEGIN IMMEDIATE;
    DROP VIEW IF EXISTS unique_requests;
    DROP VIEW IF EXISTS unique_tool_calls;
    DROP VIEW IF EXISTS unique_skill_usages;
    DROP VIEW IF EXISTS accounted_usage;
    ALTER TABLE indexed_files ADD COLUMN source_channel TEXT NOT NULL DEFAULT 'pi-session';
    ALTER TABLE sessions ADD COLUMN accounting_session_id TEXT;
    ALTER TABLE sessions ADD COLUMN agent_run_key TEXT;
    ALTER TABLE sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'root';
    ALTER TABLE sessions ADD COLUMN linkage_precision TEXT NOT NULL DEFAULT 'unknown';
    UPDATE sessions SET accounting_session_id = session_id WHERE accounting_session_id IS NULL;
    ALTER TABLE requests ADD COLUMN request_key TEXT;
    ALTER TABLE requests ADD COLUMN accounting_session_id TEXT;
    ALTER TABLE requests ADD COLUMN agent_run_key TEXT;
    ALTER TABLE requests ADD COLUMN output_tokens INTEGER;
    ALTER TABLE requests ADD COLUMN cache_write_tokens INTEGER;
    ALTER TABLE requests ADD COLUMN source_channel TEXT NOT NULL DEFAULT 'pi-session';
    ALTER TABLE requests ADD COLUMN usage_scope TEXT NOT NULL DEFAULT 'self';
    ALTER TABLE requests ADD COLUMN token_precision TEXT NOT NULL DEFAULT 'exact';
    ALTER TABLE requests ADD COLUMN cost_precision TEXT NOT NULL DEFAULT 'exact';
    UPDATE requests SET request_key = source_key,
      accounting_session_id = session_id
      WHERE request_key IS NULL OR accounting_session_id IS NULL;
    CREATE INDEX sessions_id_idx ON sessions(session_id);
    CREATE INDEX sessions_parent_idx ON sessions(parent_session);
    CREATE INDEX requests_key_idx ON requests(request_key);
    CREATE INDEX requests_agent_idx ON requests(agent_run_key, source_channel);
    ${ownershipColumns}
    ${AGENT_TABLES_SQL}
    INSERT OR IGNORE INTO agent_observations (
      observation_key, logical_key, run_key, native_run_key, native_id,
      adapter, channel, source_path, source_entry_id, artifact_version,
      root_session_ref, root_session_file, session_file, parent_native_id,
      workflow_id, workflow_step_index, agent_type, display_name, description,
      status_raw, status_canonical, started_at, completed_at, provider,
      model_id, model_label, usage_scope, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, total_tokens, total_cost,
      request_count, tool_count, turn_count, identity_precision,
      linkage_precision, model_precision, token_precision, cost_precision,
      metadata_priority, usage_priority
    )
    SELECT 'legacy-tool:' || file_path || ':' || id,
      'tintinweb:' || agent_id,
      'legacy:tintinweb:' || session_id || ':' || agent_id,
      agent_id, agent_id, 'tintinweb', 'legacy-tool-details', file_path,
      source_key, NULL, session_id, file_path, NULL, NULL, NULL, NULL,
      agent_name, agent_name, agent_description, NULL, 'unknown', started_at,
      NULL, NULL, NULL, agent_model, 'subtree', NULL, NULL, NULL, NULL,
      agent_tokens, agent_cost, NULL, NULL, NULL, 'exact', 'reported',
      CASE WHEN agent_model IS NULL THEN 'unknown' ELSE 'estimated' END,
      CASE WHEN agent_tokens IS NULL THEN 'unknown' ELSE 'estimated' END,
      CASE WHEN agent_cost IS NULL THEN 'unknown' ELSE 'reported' END, 20, 20
    FROM tool_calls WHERE agent_id IS NOT NULL;
    INSERT OR IGNORE INTO agent_observations (
      observation_key, logical_key, run_key, native_run_key, native_id,
      adapter, channel, source_path, source_entry_id, artifact_version,
      root_session_ref, root_session_file, session_file, parent_native_id,
      workflow_id, workflow_step_index, agent_type, display_name, description,
      status_raw, status_canonical, started_at, completed_at, provider,
      model_id, model_label, usage_scope, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, total_tokens, total_cost,
      request_count, tool_count, turn_count, identity_precision,
      linkage_precision, model_precision, token_precision, cost_precision,
      metadata_priority, usage_priority
    )
    SELECT 'legacy-output:' || s.file_path,
      'tintinweb:' || s.session_id,
      'legacy:tintinweb:' || COALESCE(s.parent_session, s.session_id) || ':' || s.session_id,
      s.session_id, s.session_id, 'tintinweb', 'legacy-output', s.file_path,
      NULL, NULL, s.parent_session, NULL, s.file_path, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, 'unknown', s.started_at,
      MAX(r.timestamp), NULL, NULL, NULL, 'self', SUM(r.input_tokens), NULL,
      SUM(r.cache_read_tokens), NULL, SUM(r.total_tokens), SUM(r.cost),
      COUNT(r.id), NULL, COUNT(r.id), 'exact', 'estimated', 'unknown',
      'exact', 'exact', 70, 70
    FROM sessions AS s
    LEFT JOIN requests AS r ON r.file_path = s.file_path
    WHERE s.file_path LIKE '%.output'
    GROUP BY s.file_path;
    UPDATE indexed_files SET source_channel = 'external-artifact'
      WHERE path LIKE '%.output';
    UPDATE sessions SET accounting_session_id = COALESCE(parent_session, session_id),
      parent_session = NULL,
      session_kind = 'agent', linkage_precision = 'estimated',
      agent_run_key = 'legacy:tintinweb:' || COALESCE(parent_session, session_id) || ':' || session_id
      WHERE file_path LIKE '%.output';
    UPDATE requests SET
      session_id = COALESCE((SELECT session_id FROM sessions WHERE file_path = requests.file_path), session_id),
      accounting_session_id = COALESCE((SELECT accounting_session_id FROM sessions WHERE file_path = requests.file_path), session_id),
      agent_run_key = (SELECT agent_run_key FROM sessions WHERE file_path = requests.file_path),
      source_channel = 'external-artifact'
      WHERE file_path LIKE '%.output';
    INSERT OR REPLACE INTO agent_runs (
      run_key, logical_key, adapter, native_id, root_session_id,
      root_session_file, parent_run_key, parent_native_id, workflow_id,
      workflow_step_index, depth, agent_type, display_name, description,
      status_raw, status_canonical, started_at, completed_at, provider,
      model_id, model_label, selected_channel, usage_scope,
      identity_precision, linkage_precision, model_precision,
      token_precision, cost_precision, coverage, included_in_session_total,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      total_tokens, total_cost, request_count, tool_count, turn_count,
      provenance_json
    )
    SELECT run_key, logical_key, adapter, native_id, root_session_ref,
      root_session_file, NULL, parent_native_id, workflow_id,
      workflow_step_index, 1, agent_type, display_name, description,
      status_raw, status_canonical, started_at, completed_at, provider,
      model_id, model_label, channel, usage_scope, identity_precision,
      linkage_precision, model_precision, token_precision, cost_precision,
      CASE WHEN total_tokens IS NULL AND total_cost IS NULL THEN 'unknown'
        WHEN output_tokens IS NULL OR cache_write_tokens IS NULL THEN 'partial'
        ELSE 'complete' END,
      CASE WHEN usage_scope = 'unassigned' THEN 0 ELSE 1 END,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      total_tokens, total_cost, request_count, tool_count, turn_count,
      json_array(channel)
    FROM agent_observations
    WHERE observation_key IN (
      SELECT observation_key FROM agent_observations AS candidate
      WHERE candidate.logical_key = agent_observations.logical_key
      ORDER BY usage_priority DESC, metadata_priority DESC, observation_key
      LIMIT 1
    );
    UPDATE agent_runs SET
      agent_type = COALESCE(agent_type, (SELECT agent_type FROM agent_observations
        WHERE logical_key = agent_runs.logical_key AND agent_type IS NOT NULL
        ORDER BY metadata_priority DESC LIMIT 1)),
      display_name = COALESCE(display_name, (SELECT display_name FROM agent_observations
        WHERE logical_key = agent_runs.logical_key AND display_name IS NOT NULL
        ORDER BY metadata_priority DESC LIMIT 1)),
      description = COALESCE(description, (SELECT description FROM agent_observations
        WHERE logical_key = agent_runs.logical_key AND description IS NOT NULL
        ORDER BY metadata_priority DESC LIMIT 1)),
      model_label = COALESCE(model_label, (SELECT model_label FROM agent_observations
        WHERE logical_key = agent_runs.logical_key AND model_label IS NOT NULL
        ORDER BY metadata_priority DESC LIMIT 1)),
      model_precision = CASE WHEN model_label IS NULL AND EXISTS (
        SELECT 1 FROM agent_observations WHERE logical_key = agent_runs.logical_key
          AND model_label IS NOT NULL) THEN 'estimated' ELSE model_precision END;
    UPDATE indexed_files SET size = -1
      WHERE path LIKE '%.jsonl' OR path LIKE '%.output';
    ${UNIQUE_VIEWS_SQL}
    PRAGMA user_version = 17;
    COMMIT;
  `
  )
}

function migrate17To18(db: SqliteDatabase): void {
  const ownershipColumns = ownershipColumnsSql(db)
  execMigration(
    db,
    `BEGIN IMMEDIATE;
     DROP VIEW IF EXISTS accounted_usage;
     DROP VIEW IF EXISTS unique_requests;
     DROP VIEW IF EXISTS unique_tool_calls;
     DROP VIEW IF EXISTS unique_skill_usages;
     ${ownershipColumns}
     UPDATE indexed_files SET size = -1
       WHERE path LIKE '%.jsonl' OR path LIKE '%.output'
         OR path LIKE '%/status.json' OR path LIKE '%/events.jsonl';
     ${UNIQUE_VIEWS_SQL}
     PRAGMA user_version = 18;
     COMMIT;`
  )
}

function migrate18To19(db: SqliteDatabase): void {
  execMigration(
    db,
    `BEGIN IMMEDIATE;
     UPDATE indexed_files SET size = -1
       WHERE path LIKE '%.jsonl' OR path LIKE '%.output'
         OR path LIKE '%/status.json' OR path LIKE '%/events.jsonl';
     PRAGMA user_version = 19;
     COMMIT;`
  )
}

function migrate19To20(db: SqliteDatabase): void {
  const ownershipColumns = ownershipColumnsSql(db)
  execMigration(
    db,
    `BEGIN IMMEDIATE;
     DROP VIEW IF EXISTS accounted_usage;
     DROP VIEW IF EXISTS unique_requests;
     DROP VIEW IF EXISTS unique_tool_calls;
     DROP VIEW IF EXISTS unique_skill_usages;
     ${ownershipColumns}
     CREATE INDEX IF NOT EXISTS tool_calls_agent_idx ON tool_calls(agent_run_key, usage_scope);
     CREATE INDEX IF NOT EXISTS skill_usages_agent_idx ON skill_usages(agent_run_key, usage_scope);
     UPDATE indexed_files SET size = -1
       WHERE path LIKE '%.jsonl' OR path LIKE '%.output'
         OR path LIKE '%/status.json' OR path LIKE '%/events.jsonl';
     ${UNIQUE_VIEWS_SQL}
     PRAGMA user_version = 20;
     COMMIT;`
  )
}

export function createDatabase(
  databasePath = join(getPiDirectory(), "stats", "stats.sqlite")
): SqliteDatabase {
  const resolvedDatabasePath = expandHome(databasePath)
  const persistent = resolvedDatabasePath !== ":memory:"
  const databaseDirectory = persistent ? dirname(resolvedDatabasePath) : null
  if (databaseDirectory && !existsSync(resolvedDatabasePath)) {
    mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 })
    chmodSync(databaseDirectory, 0o700)
  }
  const db = new Database(resolvedDatabasePath)

  let version = db.pragma("user_version", { simple: true }) as number
  const hasTables = Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
      )
      .get()
  )
  const isNew = version === 0 && !hasTables
  if (!isNew && (version === 0 || version < 13 || version > SCHEMA_VERSION))
    failUnsupported(db, version)
  if (databaseDirectory) {
    chmodSync(databaseDirectory, 0o700)
    chmodSync(resolvedDatabasePath, 0o600)
  }

  if (isNew) {
    execMigration(
      db,
      `BEGIN IMMEDIATE; ${SCHEMA_SQL} PRAGMA user_version = 20; COMMIT;`
    )
    version = SCHEMA_VERSION
  } else if ([13, 14, 15].includes(version)) {
    migrateTo16(db, version)
    version = 16
  }
  if (version === 16) {
    migrate16To17(db)
    version = 17
  }
  if (version === 17) {
    migrate17To18(db)
    version = 18
  }
  if (version === 18) {
    migrate18To19(db)
    version = 19
  }
  if (version === 19) {
    migrate19To20(db)
    version = SCHEMA_VERSION
  }
  if (version !== SCHEMA_VERSION) failUnsupported(db, version)

  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  return db
}
