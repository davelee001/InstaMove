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







