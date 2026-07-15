const assert = require("node:assert/strict");
const { test } = require("node:test");
const { applySecurityHeaders } = require("../src/security-headers");

test("security middleware applies a nonce-bound policy", () => {
  const headers = new Map();
  const req = {
    cspNonce: "test-nonce",
    secure: false,
    get: () => undefined
  };
  const res = {
    set(name, value) {
      if (typeof name === "object") {
        for (const [key, item] of Object.entries(name)) headers.set(key, item);
      } else {
        headers.set(name, value);
      }
    }
  };
  let continued = false;

  applySecurityHeaders(req, res, () => { continued = true; });

  assert.equal(continued, true);
  assert.match(headers.get("Content-Security-Policy"), /script-src 'nonce-test-nonce'/);
  assert.match(headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.has("Strict-Transport-Security"), false);
});
