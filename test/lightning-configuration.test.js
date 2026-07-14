const assert = require("node:assert/strict");
const http = require("node:http");
const { afterEach, test } = require("node:test");
const lightning = require("../src/lightning");

const originalEnvironment = {
  LIGHTNING_MODE: process.env.LIGHTNING_MODE,
  LND_REST_URL: process.env.LND_REST_URL,
  LND_MACAROON: process.env.LND_MACAROON
};

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test("mock mode works without LND credentials", () => {
  process.env.LIGHTNING_MODE = "mock";
  delete process.env.LND_REST_URL;
  delete process.env.LND_MACAROON;

  assert.equal(lightning.assertConfiguration(), "mock");
  assert.equal(lightning.isRealMode(), false);
});

test("regtest mode fails when LND credentials are missing", () => {
  process.env.LIGHTNING_MODE = "regtest";
  delete process.env.LND_REST_URL;
  delete process.env.LND_MACAROON;

  assert.throws(
    () => lightning.assertConfiguration(),
    /LIGHTNING_MODE=regtest requires LND_REST_URL and LND_MACAROON/
  );
});

test("lnd mode fails when one credential is missing", () => {
  process.env.LIGHTNING_MODE = "lnd";
  process.env.LND_REST_URL = "https://127.0.0.1:8080";
  delete process.env.LND_MACAROON;

  assert.throws(() => lightning.assertConfiguration(), /requires LND_MACAROON/);
});

test("regtest mode is real only with complete credentials", () => {
  process.env.LIGHTNING_MODE = "regtest";
  process.env.LND_REST_URL = "https://127.0.0.1:8080";
  process.env.LND_MACAROON = "00ff";

  assert.equal(lightning.assertConfiguration(), "regtest");
  assert.equal(lightning.isRealMode(), true);
});

test("unknown modes are rejected", () => {
  process.env.LIGHTNING_MODE = "production";

  assert.throws(() => lightning.assertConfiguration(), /Unsupported LIGHTNING_MODE/);
});

test("a node cannot settle its own invoice", async () => {
  process.env.LIGHTNING_MODE = "mock";
  const paymentRequest = lightning.buildLocalInvoice(10);

  await assert.rejects(
    () => lightning.settleInvoice({ paymentRequest }, paymentRequest.toUpperCase()),
    (error) => error.code === "SELF_PAYMENT_NOT_ALLOWED" && error.statusCode === 409
  );
});

test("an LND payment error is never reported as settled", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/v1/payreq/")) {
      res.end(JSON.stringify({ num_satoshis: "10", destination: "remote-node" }));
      return;
    }
    res.end(JSON.stringify({ payment_error: "route unavailable", payment_hash: "payment-hash" }));
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    process.env.LIGHTNING_MODE = "lnd";
    process.env.LND_REST_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.LND_MACAROON = "00ff";
    const result = await lightning.settlePaymentRequest({
      paymentRequest: lightning.buildLocalInvoice(10)
    });

    assert.equal(result.status, "error");
    assert.equal(result.payment.success, false);
    assert.equal(result.payment.status, "failed");
    assert.equal(result.message, "The Lightning payment was not settled");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
