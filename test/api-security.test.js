const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const PAYMENT_TOKEN = "payment-token-for-integration-tests";
const ADMIN_TOKEN = "admin-token-for-integration-tests";
const LOCAL_INVOICE_10 = "lnbcrt10u1instamove7edd898728b93fc5";
const LOCAL_INVOICE_5000 = "lnbcrt5000u1instamoved8353f1c82f4a3bb";
const LOCAL_INVOICE_10000 = "lnbcrt10000u1instamovefc1a2cb6ab734c15";

let dataDirectory;
let server;
let baseUrl;

async function writeData(name, value) {
  await fs.writeFile(path.join(dataDirectory, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function request(route, { method = "GET", token, key, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers["Idempotency-Key"] = key;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json()
  };
}

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "instamove-api-"));
  await Promise.all([
    writeData("nodes.json", [{ id: "node-1", ip: "127.0.0.1", status: "active" }]),
    writeData("requests.json", []),
    writeData("channels.json", [{ id: "existing-channel", nodeId: "node-1", status: "open" }]),
    writeData("invoices.json", []),
    writeData("idempotency.json", [])
  ]);

  process.env.INSTAMOVE_DATA_DIR = dataDirectory;
  process.env.LIGHTNING_MODE = "mock";
  process.env.INSTAMOVE_PAYMENT_TOKEN = PAYMENT_TOKEN;
  process.env.INSTAMOVE_ADMIN_TOKEN = ADMIN_TOKEN;
  process.env.MAX_PAYMENT_SATS = "5000";
  process.env.PAYMENT_RATE_LIMIT = "100";
  process.env.ADMIN_RATE_LIMIT = "100";

  const { app } = require("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  require("../src/database").closeDatabases();
  if (dataDirectory) await fs.rm(dataDirectory, { recursive: true, force: true });
});

test("landing page renders operational widgets and its hero image", async () => {
  const page = await fetch(`${baseUrl}/`);
  const html = await page.text();
  const hero = await fetch(`${baseUrl}/assets/instamove-hero.png`);

  assert.equal(page.status, 200);
  assert.equal(html.includes("Payment workspace"), true);
  assert.equal(html.includes("Security posture"), true);
  assert.equal(html.includes("Quick mock invoices"), true);
  assert.equal(html.includes("Services operational"), true);
  assert.equal(html.includes("color-scheme: light"), true);
  assert.equal(html.includes("--surface: #e5e8e1"), true);
  const policy = page.headers.get("content-security-policy");
  const nonce = policy.match(/script-src 'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.equal(html.includes(`<script nonce="${nonce}">`), true);
  assert.equal(html.includes(`<style nonce="${nonce}">`), true);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(hero.status, 200);
  assert.equal(hero.headers.get("content-type"), "image/png");
  assert.equal(Number(hero.headers.get("content-length")) > 100000, true);
});

test("liveness and readiness endpoints report operational state", async () => {
  const health = await request("/health");
  const ready = await request("/ready");

  assert.equal(health.status, 200);
  assert.equal(health.body.status, "ok");
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal(ready.status, 200);
  assert.equal(ready.body.status, "ready");
  assert.equal(ready.body.checks.paymentAuthentication, true);
  assert.equal(ready.body.checks.adminAuthentication, true);
});

test("readiness fails when administrative authentication is missing", async () => {
  const adminToken = process.env.INSTAMOVE_ADMIN_TOKEN;
  delete process.env.INSTAMOVE_ADMIN_TOKEN;
  try {
    const response = await request("/ready");
    const page = await fetch(`${baseUrl}/`);
    const html = await page.text();
    assert.equal(response.status, 503);
    assert.equal(response.body.status, "not_ready");
    assert.equal(response.body.checks.adminAuthentication, false);
    assert.equal(html.includes("Configuration required"), true);
  } finally {
    process.env.INSTAMOVE_ADMIN_TOKEN = adminToken;
  }
});

test("payment endpoint requires authentication", async () => {
  const response = await request("/request", {
    method: "POST",
    key: "auth-required-1",
    body: { paymentRequest: LOCAL_INVOICE_10 }
  });
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "UNAUTHORIZED");
});

test("request schema rejects unsupported fields", async () => {
  const response = await request("/request", {
    method: "POST",
    token: PAYMENT_TOKEN,
    key: "invalid-schema-1",
    body: { paymentRequest: LOCAL_INVOICE_10, unexpected: true }
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.code, "VALIDATION_ERROR");
  assert.deepEqual(response.body.details.fields, ["unexpected"]);
});

test("amount values must be JSON integers rather than numeric strings", async () => {
  const response = await request("/request", {
    method: "POST",
    token: PAYMENT_TOKEN,
    key: "strict-amount-1",
    body: { domain: "merchant.test", amount: "50" }
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

test("malformed JSON errors are sanitized and retain a request id", async () => {
  const response = await fetch(`${baseUrl}/request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYMENT_TOKEN}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "malformed-json-1",
      "X-Request-Id": "json-test-request"
    },
    body: "{"
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("x-request-id"), "json-test-request");
  assert.equal(body.code, "INVALID_JSON");
  assert.equal(body.requestId, "json-test-request");
});

test("encrypted request processing fails closed without a configured key", async () => {
  const encryption = require("../src/encryption");
  process.env.INSTAMOVE_ENCRYPTION_KEY = "11".repeat(32);
  const payload = encryption.encrypt({ domain: "merchant.test" });
  delete process.env.INSTAMOVE_ENCRYPTION_KEY;

  const response = await request("/request", {
    method: "POST",
    token: PAYMENT_TOKEN,
    key: "encryption-config-1",
    body: { payload }
  });

  assert.equal(response.status, 503);
  assert.equal(response.body.code, "ENCRYPTION_NOT_CONFIGURED");
});

test("decoded invoice amounts above the configured limit are rejected", async () => {
  const response = await request("/request", {
    method: "POST",
    token: PAYMENT_TOKEN,
    key: "amount-limit-1",
    body: { paymentRequest: LOCAL_INVOICE_10000 }
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.code, "AMOUNT_LIMIT_EXCEEDED");
});

test("payment retries replay the original result", async () => {
  const options = {
    method: "POST",
    token: PAYMENT_TOKEN,
    key: "payment-replay-1",
    body: { paymentRequest: LOCAL_INVOICE_10 }
  };
  const first = await request("/request", options);
  const replay = await request("/request", options);

  assert.equal(first.status, 200);
  assert.equal(first.headers.get("idempotency-replayed"), "false");
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal(replay.body.payment.paymentId, first.body.payment.paymentId);
});

test("an idempotency key cannot be reused for a different payment", async () => {
  const response = await request("/request", {
    method: "POST",
    token: PAYMENT_TOKEN,
    key: "payment-replay-1",
    body: { paymentRequest: LOCAL_INVOICE_5000 }
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "IDEMPOTENCY_CONFLICT");
});

test("invoice creation does not open or settle a channel", async () => {
  const response = await request("/request", {
    method: "POST",
    token: PAYMENT_TOKEN,
    key: "invoice-create-1",
    body: { domain: "merchant.test", amount: 50 }
  });
  const { readJson } = require("../src/storage");
  const channels = await readJson("data/channels.json", []);
  const invoices = await readJson("data/invoices.json", []);

  assert.equal(response.status, 200);
  assert.equal(response.body.channelCreated, false);
  assert.equal(response.body.invoiceSettled, false);
  assert.equal(channels.length, 1);
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].settled, false);
});

test("payment tokens cannot perform admin operations", async () => {
  const forbidden = await request("/nodes/node-1/activate", {
    method: "POST",
    token: PAYMENT_TOKEN
  });
  const allowed = await request("/nodes/node-1/activate", {
    method: "POST",
    token: ADMIN_TOKEN
  });

  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, "FORBIDDEN");
  assert.equal(allowed.status, 200);
});

test("Bluetooth endpoints require an admin token", async () => {
  const response = await request("/bluetooth/status");
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "UNAUTHORIZED");
});

test("unexpected internal errors return a sanitized response", async () => {
  const database = require("../src/database").getDatabase();
  database.exec("DROP TABLE documents");
  const response = await request("/request", {
    method: "POST",
    token: PAYMENT_TOKEN,
    key: "sanitized-error-1",
    body: { paymentRequest: LOCAL_INVOICE_10 }
  });

  assert.equal(response.status, 500);
  assert.equal(response.body.code, "INTERNAL_ERROR");
  assert.equal(response.body.message, "The request could not be completed");
  assert.equal(JSON.stringify(response.body).includes("Unexpected token"), false);
});
