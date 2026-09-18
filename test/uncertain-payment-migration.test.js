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









