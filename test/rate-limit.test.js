const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRateLimiter } = require("../src/rate-limit");

test("rate limiter rejects requests beyond the configured maximum", () => {
  const limiter = createRateLimiter({ name: "test", max: 1, windowMs: 60000 });
  const req = { ip: "127.0.0.1" };
  const headers = new Map();
  const res = { set: (name, value) => headers.set(name, value) };

  let firstError;
  let secondError;
  limiter(req, res, (error) => { firstError = error; });
  limiter(req, res, (error) => { secondError = error; });

  assert.equal(firstError, undefined);
  assert.equal(secondError.statusCode, 429);
  assert.equal(secondError.code, "RATE_LIMITED");
  assert.equal(headers.get("Retry-After"), "60");
});
