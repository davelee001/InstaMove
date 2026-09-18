const fs = require("node:fs");
const { getDatabase, withImmediateTransaction } = require("./database");
const { resolveDataPath } = require("./storage");

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

function retentionMs() {
  const configured = Number(process.env.IDEMPOTENCY_RETENTION_MS || DEFAULT_RETENTION_MS);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_RETENTION_MS;
}

function importLegacyRecords(database) {
  const metadataKey = "legacy_idempotency_imported";
  if (database.prepare("SELECT value FROM schema_metadata WHERE key = ?").get(metadataKey)) return;

  withImmediateTransaction((transaction) => {
    const legacyPath = resolveDataPath("data/idempotency.json");
    if (fs.existsSync(legacyPath)) {
      const records = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
      const insert = transaction.prepare(`
        INSERT OR IGNORE INTO idempotency_records
          (key, fingerprint, state, owner_id, result_json, created_at, updated_at)
        VALUES (?, ?, 'completed', 'legacy-import', ?, ?, ?)
      `);
      for (const record of records) {
        const createdAt = record.createdAt || new Date().toISOString();
        insert.run(record.key, record.fingerprint, JSON.stringify(record.result), createdAt, createdAt);
      }
    }
    transaction.prepare("INSERT INTO schema_metadata (key, value) VALUES (?, ?)")
      .run(metadataKey, new Date().toISOString());
  }, database);
}

function preparedDatabase() {
  const database = getDatabase();
  importLegacyRecords(database);
  preserveHistoricalUncertainResults(database);
  return database;
}

function preserveHistoricalUncertainResults(database) {
  const migrationKey = "uncertain_results_preserved_v1";
  if (database.prepare("SELECT value FROM schema_metadata WHERE key = ?").get(migrationKey)) return;

  withImmediateTransaction((transaction) => {
    // Recheck under the write lock: two processes can initialize together.
    if (transaction.prepare("SELECT value FROM schema_metadata WHERE key = ?").get(migrationKey)) return;
    // Older versions persisted transport errors as completed operations. We lack
    // dispatch metadata, so conservatively preserve these before TTL cleanup.
    // Retain result_json as evidence; pending records never replay that result.
    transaction.prepare(`
      UPDATE idempotency_records
      SET state = 'pending', updated_at = ?
      WHERE state = 'completed'
        AND json_extract(result_json, '$.body.status') = 'error'
        AND json_extract(result_json, '$.body.code') IN (
          'LND_TIMEOUT', 'LND_UNAVAILABLE', 'LND_HTTP_ERROR'
        )
    `).run(new Date().toISOString());
    transaction.prepare("INSERT INTO schema_metadata (key, value) VALUES (?, ?)")
      .run(migrationKey, new Date().toISOString());
  }, database);
}

function claimRecord({ key, fingerprint, ownerId }) {
  const database = preparedDatabase();
  return withImmediateTransaction((transaction) => {
    const cutoff = new Date(Date.now() - retentionMs()).toISOString();
    transaction.prepare("DELETE FROM idempotency_records WHERE state = 'completed' AND created_at < ?").run(cutoff);

    const stored = transaction.prepare(`
      SELECT fingerprint, state, result_json, created_at
      FROM idempotency_records
      WHERE key = ?
    `).get(key);

    if (stored) {
      if (stored.fingerprint !== fingerprint) return { status: "conflict" };
      if (stored.state === "completed") {
        return { status: "completed", result: JSON.parse(stored.result_json) };
      }
      return { status: "pending", createdAt: stored.created_at };
    }

    const timestamp = new Date().toISOString();
    transaction.prepare(`
      INSERT INTO idempotency_records
        (key, fingerprint, state, owner_id, result_json, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, NULL, ?, ?)
    `).run(key, fingerprint, ownerId, timestamp, timestamp);
    return { status: "acquired" };
  }, database);
}

function completeRecord({ key, fingerprint, ownerId, result }) {
  const database = preparedDatabase();
  return withImmediateTransaction((transaction) => {
    const update = transaction.prepare(`
      UPDATE idempotency_records
      SET state = 'completed', result_json = ?, updated_at = ?
      WHERE key = ? AND fingerprint = ? AND owner_id = ? AND state = 'pending'
    `).run(JSON.stringify(result), new Date().toISOString(), key, fingerprint, ownerId);
    if (Number(update.changes) !== 1) {
      throw new Error("Idempotency reservation ownership was lost");
    }
  }, database);
}

function releaseRecord({ key, fingerprint, ownerId }) {
  const database = preparedDatabase();
  withImmediateTransaction((transaction) => {
    transaction.prepare(`
      DELETE FROM idempotency_records
      WHERE key = ? AND fingerprint = ? AND owner_id = ? AND state = 'pending'
    `).run(key, fingerprint, ownerId);
  }, database);
}

module.exports = { claimRecord, completeRecord, releaseRecord };
