const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const lightning = require("../src/lightning");
const { toErrorResponse } = require("../src/errors");

const preimage = Buffer.alloc(32, 7);
const hash = crypto.createHash("sha256").update(preimage).digest();
const otherPreimage = Buffer.alloc(32, 8);
const otherHash = crypto.createHash("sha256").update(otherPreimage).digest();
const invoice = lightning.buildLocalInvoice(10);
const proof = {
  payment_error: "",
  payment_hash: hash.toString("base64"),
  payment_preimage: preimage.toString("base64")
};
const decoded = { num_satoshis: "10", payment_hash: hash.toString("hex") };
const environment = { ...process.env };
let upstream;
let api;
let apiUrl;
let dataDirectory;
let paymentResponse;
let decodeResponse;
let responseStatus;
let payments;
let decodes;
let rawResponse;
let responseBehavior;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "instamove-settlement-"));
  process.env.INSTAMOVE_DATA_DIR = dataDirectory;
  process.env.INSTAMOVE_DB_PATH = path.join(dataDirectory, "test.sqlite");
  process.env.INSTAMOVE_PAYMENT_TOKEN = "payment-token-for-settlement-tests";
  process.env.INSTAMOVE_ADMIN_TOKEN = "admin-token-for-settlement-tests";
  process.env.PAYMENT_RATE_LIMIT = "1000";
  process.env.LND_MACAROON = "00ff";
  process.env.LND_REQUEST_TIMEOUT_MS = "1000";
  process.env.LND_GET_RETRY_ATTEMPTS = "1";
  process.env.LIGHTNING_MODE = "lnd";
  upstream = http.createServer((req, res) => {
    req.resume();
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/v1/payreq/")) {
      decodes += 1;
      res.end(JSON.stringify(decodeResponse));
      return;
    }
    assert.equal(req.url, "/v1/channels/transactions");
    assert.equal(req.method, "POST");
    payments += 1;
    if (responseBehavior === "timeout") return;
    if (responseBehavior === "disconnect") { req.socket.destroy(); return; }
    if (responseBehavior === "truncated") {
      res.setHeader("Content-Length", "1000");
      res.write("{");
      setTimeout(() => res.destroy(), 10);
      return;
    }
    res.statusCode = responseStatus;
    res.end(rawResponse === undefined ? JSON.stringify(paymentResponse) : rawResponse);
  });
  upstream.listen(0, "127.0.0.1");
  await new Promise((resolve) => upstream.once("listening", resolve));
  process.env.LND_REST_URL = `http://127.0.0.1:${upstream.address().port}`;
  api = require("../src/app").app.listen(0, "127.0.0.1");
  await new Promise((resolve) => api.once("listening", resolve));
  apiUrl = `http://127.0.0.1:${api.address().port}`;
});

after(async () => {
  for (const server of [api, upstream]) {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
  require("../src/database").closeDatabases();
  if (dataDirectory) await fs.rm(dataDirectory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (!(key in environment)) delete process.env[key];
  }
  Object.assign(process.env, environment);
});

function reset(response = proof) {
  paymentResponse = response;
  decodeResponse = decoded;
  responseStatus = 200;
  rawResponse = undefined;
  responseBehavior = undefined;
  payments = 0;
  decodes = 0;
}

function assertUnconfirmed(error) {
  assert.equal(error.code, "LND_PAYMENT_UNCONFIRMED");
  assert.equal(error.statusCode, 502);
  const serialized = JSON.stringify(toErrorResponse(error, "test-request"));
  assert.equal(serialized.includes(proof.payment_preimage), false);
  assert.equal(serialized.includes("upstream-secret"), false);
  return true;
}

async function request(key) {
  const response = await fetch(`${apiUrl}/request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INSTAMOVE_PAYMENT_TOKEN}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key
    },
    body: JSON.stringify({ paymentRequest: invoice })
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

const invalidResponses = [
  ["empty object", {}],
  ["null", null],
  ["array", []],
  ["string", "success"],
  ["number", 1],
  ["boolean", true],
  ["error envelope", { error: "upstream-secret", code: 13 }],
  ["empty error alone", { payment_error: "" }],
  ["hash without proof", { payment_hash: proof.payment_hash }],
  ["proof without hash", { payment_preimage: proof.payment_preimage }],
  ["success status alone", { status: "SUCCEEDED" }],
  ["in-flight with proof", { ...proof, status: "IN_FLIGHT" }],
  ["unknown with proof", { ...proof, status: "UNKNOWN" }],
  ["initiated with proof", { ...proof, status: "INITIATED" }],
  ["numeric status", { ...proof, status: 2 }],
  ["null status", { ...proof, status: null }],
  ["unexpected status", { ...proof, status: "settled" }],
  ["malformed error type", { ...proof, payment_error: false }],
  ["null error", { ...proof, payment_error: null }],
  ["numeric error", { ...proof, payment_error: 0 }],
  ["error object", { ...proof, payment_error: {} }],
  ["conflicting error envelope", { ...proof, error: "upstream-secret" }],
  ["conflicting code", { ...proof, code: 13 }],
  ["invalid base64", { ...proof, payment_preimage: "!".repeat(44) }],
  ["base64 with whitespace", { ...proof, payment_preimage: proof.payment_preimage + "\n" }],
  ["truncated preimage", { ...proof, payment_preimage: Buffer.alloc(31, 7).toString("base64") }],
  ["oversized preimage", { ...proof, payment_preimage: Buffer.alloc(33, 7).toString("base64") }],
  ["zero preimage", { ...proof, payment_preimage: Buffer.alloc(32).toString("base64") }],
  ["hex instead of REST bytes", { ...proof, payment_preimage: preimage.toString("hex") }],
  ["non-string preimage", { ...proof, payment_preimage: Array.from(preimage) }],
  ["malformed hash", { ...proof, payment_hash: "invalid" }],
  ["wrong proof", { ...proof, payment_preimage: otherPreimage.toString("base64") }],
  ["proof for another invoice", {
    ...proof, payment_hash: otherHash.toString("base64"),
    payment_preimage: otherPreimage.toString("base64")
  }]
];

for (const [name, response] of invalidResponses) {
  test(`settlement rejects ${name} without replaying payment`, async () => {
    reset(response);
    await assert.rejects(() => lightning.settlePaymentRequest({ paymentRequest: invoice }), assertUnconfirmed);
    assert.equal(payments, 1);
    assert.equal(decodes, 1);
  });
}

test("empty and malformed HTTP bodies cannot confirm settlement", async () => {
  for (const body of ["", "{not-json", " "]) {
    reset();
    rawResponse = body;
    await assert.rejects(() => lightning.payInvoice(invoice), assertUnconfirmed);
    assert.equal(payments, 1);
  }
});

test("HTTP failure with a valid-looking proof cannot confirm settlement", async () => {
  reset();
  responseStatus = 503;
  await assert.rejects(() => lightning.payInvoice(invoice), assertUnconfirmed);
  assert.equal(payments, 1);
});

test("missing or malformed decoded invoice hashes prevent payment dispatch", async () => {
  for (const value of [undefined, null, "", "abcd", 123, hash.toString("base64")]) {
    reset();
    decodeResponse = { ...decoded, payment_hash: value };
    await assert.rejects(
      () => lightning.payInvoice(invoice),
      (error) => error.code === "LND_INVALID_RESPONSE" && error.statusCode === 502
    );
    assert.equal(payments, 0);
  }
});

test("non-object decoded invoices prevent payment dispatch", async () => {
  for (const value of [null, [], "invoice"]) {
    reset();
    decodeResponse = value;
    await assert.rejects(() => lightning.payInvoice(invoice), (error) => error.code === "LND_INVALID_RESPONSE");
    assert.equal(payments, 0);
  }
});

test("valid proof settles with omitted or empty default error and no status", async () => {
  for (const mode of ["lnd", "regtest"]) {
    process.env.LIGHTNING_MODE = mode;
    for (const omitError of [false, true]) {
      reset({ ...proof });
      if (omitError) delete paymentResponse.payment_error;
      const result = await lightning.settlePaymentRequest({ paymentRequest: invoice });
      assert.equal(result.status, "ok");
      assert.equal(result.payment.status, "settled");
      assert.equal(result.payment.success, true);
      assert.equal(result.payment.paymentId, proof.payment_hash);
      assert.equal(result.payment.mode, mode);
      assert.equal(JSON.stringify(result).includes(proof.payment_preimage), false);
      assert.equal(payments, 1);
      assert.equal(decodes, 1);
    }
  }
  process.env.LIGHTNING_MODE = "lnd";
});

test("explicit success still requires proof and accepts uppercase invoice hash", async () => {
  reset({ ...proof, status: "SUCCEEDED" });
  decodeResponse = { ...decoded, payment_hash: decoded.payment_hash.toUpperCase() };
  const result = await lightning.payInvoice(invoice);
  assert.equal(result.success, true);
});

test("explicit failure overrides valid proof and never exposes upstream details", async () => {
  for (const response of [
    { ...proof, payment_error: "upstream-secret", status: "SUCCEEDED" },
    { ...proof, status: "FAILED" }
  ]) {
    reset(response);
    const result = await lightning.settlePaymentRequest({ paymentRequest: invoice });
    assert.equal(result.status, "error");
    assert.equal(result.payment.status, "failed");
    assert.equal(result.payment.success, false);
    assert.equal(result.payment.paymentId, null);
    assert.equal(JSON.stringify(result).includes("upstream-secret"), false);
  }
});

test("settleInvoice shares validation and only timestamps verified settlement", async () => {
  reset({});
  await assert.rejects(() => lightning.settleInvoice({ paymentRequest: "different" }, invoice), assertUnconfirmed);
  reset({ payment_error: "no route" });
  const failed = await lightning.settleInvoice({ paymentRequest: "different" }, invoice);
  assert.equal(failed.settled, false);
  assert.equal(failed.settledAt, null);
  reset();
  const settled = await lightning.settleInvoice({ paymentRequest: "different" }, invoice);
  assert.equal(settled.settled, true);
  assert.ok(settled.settledAt);
});

test("HTTP ambiguous payment stays pending across restart and retention expiry", async () => {
  reset({});
  const key = "unconfirmed-payment-http";
  const first = await request(key);
  assert.equal(first.status, 502);
  assert.equal(first.body.code, "LND_PAYMENT_UNCONFIRMED");
  assert.equal(first.body.invoiceSettled, undefined);
  const { getDatabase, closeDatabases } = require("../src/database");
  const row = getDatabase().prepare("SELECT state, result_json FROM idempotency_records WHERE key = ?").get(key);
  assert.equal(row.state, "pending");
  assert.equal(row.result_json, null);
  getDatabase().prepare("UPDATE idempotency_records SET created_at = ? WHERE key = ?")
    .run("2000-01-01T00:00:00.000Z", key);
  closeDatabases();
  paymentResponse = proof;
  const retry = await request(key);
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, "IDEMPOTENCY_RECONCILIATION_REQUIRED");
  assert.equal(payments, 1);
});

test("direct idempotency execution also retains an unconfirmed reservation", async () => {
  reset({});
  const idempotency = require("../src/idempotency");
  const options = {
    key: "unconfirmed-payment-direct",
    payload: { paymentRequest: invoice },
    operation: () => lightning.payInvoice(invoice)
  };
  await assert.rejects(() => idempotency.execute(options), assertUnconfirmed);
  await assert.rejects(() => idempotency.execute(options),
    (error) => error.code === "IDEMPOTENCY_RECONCILIATION_REQUIRED");
  assert.equal(payments, 1);
});

test("HTTP confirmed payment returns settlement and replays without payment or preimage", async () => {
  reset();
  const key = "confirmed-payment-http";
  const first = await request(key);
  const second = await request(key);
  assert.equal(first.status, 200);
  assert.equal(first.body.invoiceSettled, true);
  assert.equal(first.body.payment.paymentId, proof.payment_hash);
  assert.equal(second.headers.get("idempotency-replayed"), "true");
  assert.deepEqual(second.body, first.body);
  assert.equal(payments, 1);
  assert.equal(JSON.stringify(first.body).includes(proof.payment_preimage), false);
  const row = require("../src/database").getDatabase()
    .prepare("SELECT result_json FROM idempotency_records WHERE key = ?").get(key);
  assert.equal(row.result_json.includes(proof.payment_preimage), false);
});

