const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { beforeEach, afterEach, test } = require("node:test");
const { getDatabase, closeDatabases } = require("../src/database");
const idempotency = require("../src/idempotency");

const originalEnvironment = { ...process.env };
const payload = { paymentRequest: "original-invoice" };
const fingerprint = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
const oldDate = "2000-01-01T00:00:00.000Z";
let directory;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "instamove-uncertain-migration-"));
  process.env.INSTAMOVE_DATA_DIR = directory;
  process.env.INSTAMOVE_DB_PATH = path.join(directory, "test.sqlite");
});

afterEach(() => {
  closeDatabases();
  fs.rmSync(directory, { recursive: true, force: true });
  for (const name of ["INSTAMOVE_DATA_DIR", "INSTAMOVE_DB_PATH"]) {
    if (originalEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnvironment[name];
  }
});

function seed(key, result, date = oldDate) {
  getDatabase().prepare(`INSERT INTO idempotency_records
    (key, fingerprint, state, owner_id, result_json, created_at, updated_at)
    VALUES (?, ?, 'completed', 'old-worker', ?, ?, ?)`)
    .run(key, fingerprint, JSON.stringify(result), date, date);
}

async function blocked(key, requestPayload = payload, expected = "IDEMPOTENCY_RECONCILIATION_REQUIRED") {
  let calls = 0;
  await assert.rejects(() => idempotency.execute({
    key, payload: requestPayload, operation: async () => { calls += 1; }
  }), (error) => error.code === expected && error.statusCode === 409);
}

for (const code of ["LND_TIMEOUT", "LND_UNAVAILABLE", "LND_HTTP_ERROR",
  "LND_INVALID_RESPONSE", "LND_RESPONSE_TOO_LARGE", "LND_PAYMENT_UNCONFIRMED",
  "PERSISTENCE_CONFIRMATION_FAILED"]) {
  test(`historical ${code} survives expiry and restart without payment replay`, async () => {
    const result = { statusCode: 502, body: { status: "error", code } };
    seed("historical-payment", result);
    await blocked("historical-payment");
    const row = getDatabase().prepare("SELECT * FROM idempotency_records WHERE key = ?")
      .get("historical-payment");
    assert.equal(row.state, "pending");
    assert.equal(row.fingerprint, fingerprint);
    assert.equal(row.created_at, oldDate);
    assert.deepEqual(JSON.parse(row.result_json), result);
    closeDatabases();
    await blocked("historical-payment");
    await blocked("historical-payment", { paymentRequest: "different" }, "IDEMPOTENCY_CONFLICT");
  });
}

test("legacy JSON timeout is preserved before the first retention cleanup", async () => {
  fs.writeFileSync(path.join(directory, "idempotency.json"), JSON.stringify([{
    key: "legacy-timeout", fingerprint, createdAt: oldDate,
    result: { statusCode: 504, body: { status: "error", code: "LND_TIMEOUT" } }
  }]));
  await blocked("legacy-timeout");
  assert.equal(getDatabase().prepare("SELECT state FROM idempotency_records WHERE key = ?")
    .get("legacy-timeout").state, "pending");
});

test("migration preserves success and explicit failure replay", async () => {
  const results = [
    { statusCode: 200, body: { status: "ok", payment: { status: "settled" } } },
    { statusCode: 502, body: { status: "error", code: "PAYMENT_FAILED" } },
    { statusCode: 422, body: { status: "error", code: "VALIDATION_ERROR" } }
  ];
  results.forEach((result, i) => seed(`terminal-${i}`, result, new Date().toISOString()));
  for (const [i, result] of results.entries()) {
    const replay = await idempotency.execute({
      key: `terminal-${i}`, payload, operation: async () => assert.fail("Must not execute")
    });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, result);
  }
});

test("migration rolls back all changes if its marker cannot be committed", async () => {
  seed("rollback-timeout", { statusCode: 504, body: { status: "error", code: "LND_TIMEOUT" } });
  getDatabase().exec(`CREATE TRIGGER fail_migration BEFORE INSERT ON schema_metadata
    WHEN NEW.key = 'uncertain_results_preserved_v1'
    BEGIN SELECT RAISE(ABORT, 'migration interrupted'); END;`);
  await assert.rejects(() => idempotency.execute({
    key: "rollback-timeout", payload, operation: async () => assert.fail("Must not execute")
  }), /migration interrupted/);
  assert.equal(getDatabase().prepare("SELECT state FROM idempotency_records WHERE key = ?")
    .get("rollback-timeout").state, "completed");
  getDatabase().exec("DROP TRIGGER fail_migration");
  await blocked("rollback-timeout");
});

test("migration runs once and does not reclassify subsequent pre-dispatch errors", async () => {
  await idempotency.execute({ key: "initialize", payload, operation: async () => ({ statusCode: 200 }) });
  seed("later-decode-timeout", { statusCode: 504, body: { status: "error", code: "LND_TIMEOUT" } },
    new Date().toISOString());
  closeDatabases();
  const replay = await idempotency.execute({
    key: "later-decode-timeout", payload, operation: async () => assert.fail("Must replay")
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.body.code, "LND_TIMEOUT");
});
