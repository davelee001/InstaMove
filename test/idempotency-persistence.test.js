const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "instamove-idempotency-"));
process.env.INSTAMOVE_DATA_DIR = dataDirectory;
const legacyPayload = { invoice: "legacy" };
const legacyFingerprint = crypto.createHash("sha256").update(JSON.stringify(legacyPayload)).digest("hex");
fs.writeFileSync(
  path.join(dataDirectory, "idempotency.json"),
  JSON.stringify([{
    key: "legacy-key",
    fingerprint: legacyFingerprint,
    createdAt: new Date().toISOString(),
    result: { statusCode: 200, body: { status: "ok", source: "legacy" } }
  }])
);

const { closeDatabases } = require("../src/database");
const idempotency = require("../src/idempotency");
const { claimRecord } = require("../src/idempotency-store");

after(() => {
  closeDatabases();
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});

test("legacy idempotency results migrate without replaying operations", async () => {
  let executions = 0;
  const replay = await idempotency.execute({
    key: "legacy-key",
    payload: legacyPayload,
    operation: async () => {
      executions += 1;
    }
  });

  assert.equal(executions, 0);
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.body.source, "legacy");
});

test("concurrent executions share one operation", async () => {
  let executions = 0;
  const operation = async () => {
    executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { statusCode: 200, body: { status: "ok", paymentId: "payment-1" } };
  };

  const [first, second] = await Promise.all([
    idempotency.execute({ key: "concurrent-key", payload: { amount: 10 }, operation }),
    idempotency.execute({ key: "concurrent-key", payload: { amount: 10 }, operation })
  ]);

  assert.equal(executions, 1);
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.deepEqual(first.result, second.result);
});

test("completed results replay after the database is reopened", async () => {
  let executions = 0;
  const operation = async () => {
    executions += 1;
    return { statusCode: 200, body: { status: "ok" } };
  };

  await idempotency.execute({ key: "restart-key", payload: { invoice: "one" }, operation });
  closeDatabases();
  const replay = await idempotency.execute({ key: "restart-key", payload: { invoice: "one" }, operation });

  assert.equal(executions, 1);
  assert.equal(replay.replayed, true);
});

test("failed operations release their reservation for a safe retry", async () => {
  await assert.rejects(
    idempotency.execute({
      key: "failed-key",
      payload: { invoice: "two" },
      operation: async () => {
        throw new Error("operation failed before payment completion");
      }
    }),
    /operation failed/
  );

  const retry = await idempotency.execute({
    key: "failed-key",
    payload: { invoice: "two" },
    operation: async () => ({ statusCode: 200, body: { status: "ok" } })
  });
  assert.equal(retry.replayed, false);
});

test("orphaned pending payments require reconciliation instead of retry", async () => {
  const payload = { invoice: "three" };
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  claimRecord({ key: "orphan-key", fingerprint, ownerId: "crashed-worker" });
  closeDatabases();

  let executions = 0;
  await assert.rejects(
    idempotency.execute({
      key: "orphan-key",
      payload,
      operation: async () => {
        executions += 1;
      }
    }),
    (error) => error.code === "IDEMPOTENCY_RECONCILIATION_REQUIRED" && error.statusCode === 409
  );
  assert.equal(executions, 0);
});
