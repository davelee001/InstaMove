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
  if (server) await new Promise((resolve) => server.close(resolve));
  if (dataDirectory) await fs.rm(dataDirectory, { recursive: true, force: true });
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
  const channels = JSON.parse(await fs.readFile(path.join(dataDirectory, "channels.json"), "utf8"));
  const invoices = JSON.parse(await fs.readFile(path.join(dataDirectory, "invoices.json"), "utf8"));

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
  await fs.writeFile(path.join(dataDirectory, "invoices.json"), "not-json");
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
