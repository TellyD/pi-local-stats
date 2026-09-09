import type { SqliteDatabase } from "./database.ts"
import { reconcileAgentRuns } from "./agents.ts"

const HISTORY_TABLES = ["requests", "tool_calls", "skill_usages"] as const

export const MODEL_HISTORY_SCHEMA_SQL = `
  CREATE TABLE deleted_agent_usage (
    kind TEXT NOT NULL,
    record_key TEXT NOT NULL,
    suppression INTEGER NOT NULL CHECK (suppression IN (1, 2)),
    PRIMARY KEY (kind, record_key)
  );
  CREATE TABLE deleted_model_records (
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    record_key TEXT NOT NULL,
    PRIMARY KEY (kind, provider, model, record_key)
  );
  ${HISTORY_TABLES.map(
    (table) => `
    CREATE TRIGGER skip_deleted_${table} BEFORE INSERT ON ${table}
    WHEN EXISTS (
      SELECT 1 FROM deleted_model_records
      WHERE kind = '${table}' AND provider = NEW.provider AND model = NEW.model
        AND record_key = NEW.source_key
    )${
      table === "requests"
        ? ` OR EXISTS (
      SELECT 1 FROM deleted_model_records
      WHERE kind = 'request_key' AND provider = NEW.provider AND model = NEW.model
        AND record_key = NEW.request_key
    )`
        : ""
    }
    BEGIN
      INSERT INTO deleted_agent_usage (kind, record_key, suppression)
      VALUES ('usage_file', NEW.file_path, 2)
      ON CONFLICT (kind, record_key) DO UPDATE SET suppression = 2;
      SELECT RAISE(IGNORE);
    END;
  `
  ).join("\n")}
`

export function deleteModelHistory(
  db: SqliteDatabase,
  provider: string,
  model: string
): boolean {
  return db.transaction(() => {
    let deleted =
      db
        .prepare("DELETE FROM hidden_models WHERE provider = ? AND model = ?")
        .run(provider, model).changes > 0
    const affectedAgents = db
      .prepare(
        `
      INSERT INTO deleted_agent_usage (kind, record_key, suppression)
      SELECT 'observation', observation_key, 2 FROM agent_observations
      WHERE logical_key IN (
        SELECT logical_key FROM agent_runs
        WHERE (COALESCE(provider, 'unknown') = ? AND COALESCE(model_id, 'unknown') = ?)
          OR run_key IN (
            ${HISTORY_TABLES.map((table) => `SELECT agent_run_key FROM ${table} WHERE provider = ? AND model = ?`).join(" UNION ")}
          )
        UNION
        SELECT logical_key FROM agent_observations
        WHERE COALESCE(provider, 'unknown') = ? AND COALESCE(model_id, 'unknown') = ?
      )
      ON CONFLICT (kind, record_key) DO UPDATE SET suppression = 2
    `
      )
      .run(
        ...Array.from({ length: HISTORY_TABLES.length + 2 }, () => [
          provider,
          model,
        ]).flat()
      )
    deleted ||= affectedAgents.changes > 0
    db.prepare(
      `
      INSERT OR IGNORE INTO deleted_model_records
      SELECT 'request_key', provider, model, request_key FROM requests
      WHERE provider = ? AND model = ? AND request_key IS NOT NULL
    `
    ).run(provider, model)
    for (const table of HISTORY_TABLES) {
      // Retain transcript provenance even when its agent linkage arrives later.
      db.prepare(
        `
        INSERT INTO deleted_agent_usage (kind, record_key, suppression)
        SELECT 'usage_file', file_path, 2 FROM ${table}
        WHERE provider = ? AND model = ?
        ON CONFLICT (kind, record_key) DO UPDATE SET suppression = 2
      `
      ).run(provider, model)
      db.prepare(
        `
        INSERT OR IGNORE INTO deleted_model_records
        SELECT '${table}', provider, model, source_key FROM ${table}
        WHERE provider = ? AND model = ?
      `
      ).run(provider, model)
      const { changes } = db
        .prepare(`DELETE FROM ${table} WHERE provider = ? AND model = ?`)
        .run(provider, model)
      deleted ||= changes > 0
    }
    if (deleted) reconcileAgentRuns(db)
    return deleted
  })()
}
