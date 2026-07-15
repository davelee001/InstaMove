const assert = require("node:assert/strict");
const { test } = require("node:test");
const { redact } = require("../src/logger");

test("structured log fields redact secrets recursively", () => {
  const result = redact({
    authorization: "Bearer secret",
    request: {
      paymentRequest: "lnbc-private",
      amount: 10
    },
    macaroon: "00ff"
  });

  assert.equal(result.authorization, "[REDACTED]");
  assert.equal(result.request.paymentRequest, "[REDACTED]");
  assert.equal(result.request.amount, 10);
  assert.equal(result.macaroon, "[REDACTED]");
});
