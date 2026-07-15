const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..");
const databases = new Map();

function resolveDatabasePath() {
  if (process.env.INSTAMOVE_DB_PATH) {
    return path.resolve(process.env.INSTAMOVE_DB_PATH);
  }

  const dataDirectory = process.env.INSTAMOVE_DATA_DIR
    ? path.resolve(process.env.INSTAMOVE_DATA_DIR)
    : path.join(projectRoot, "data");
  return path.join(dataDirectory, "instamove.sqlite");
}

function initializeSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS schema_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS documents (
      collection TEXT NOT NULL,
      document_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, document_id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS documents_collection_position
      ON documents (collection, position);

    CREATE TABLE IF NOT EXISTS idempotency_records (
      key TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
      owner_id TEXT NOT NULL,
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idempotency_state_created
      ON idempotency_records (state, created_at);
  `);
}

function getDatabase() {
  const databasePath = resolveDatabasePath();
  const existing = databases.get(databasePath);
  if (existing) return existing;

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  initializeSchema(database);
  databases.set(databasePath, database);
  return database;
}

function withImmediateTransaction(operation, database = getDatabase()) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation(database);
    if (result && typeof result.then === "function") {
      throw new TypeError("Database transactions must not contain asynchronous operations");
    }
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original transaction failure.
    }
    throw error;
  }
}

function closeDatabases() {
  for (const database of databases.values()) {
    database.close();
  }
  databases.clear();
}

module.exports = {
  closeDatabases,
  getDatabase,
  resolveDatabasePath,
  withImmediateTransaction
};
