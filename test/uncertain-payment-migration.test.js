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

for (const code of [  
    "LND_PAYMENT_UNCONFIRMED",
  "PERSISTENCE_CONFIRMATION_FAILED"]) {
  test(`historical ${code} survives expiry and restart without payment replay`, async () => {
    const result = { statusCode: 502, body: { status: "error", code } };
    seed("historical-payment", result);
    await blocked("historical-payment");
    const row = getDatabase().prepare("SELECT * FROM idempotency_records WHERE key = ?")
      .get("historical-payment");
    closeDatabases();
    await blocked("historical-payment");
    await blocked("historical-payment", { paymentRequest: "different" }, "IDEMPOTENCY_CONFLICT");
  });
}




