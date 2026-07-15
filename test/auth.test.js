const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { authorize, getAuthConfiguration, isUsableToken } = require("../src/auth");

const originalPaymentToken = process.env.INSTAMOVE_PAYMENT_TOKEN;
const originalAdminToken = process.env.INSTAMOVE_ADMIN_TOKEN;

afterEach(() => {
  if (originalPaymentToken === undefined) delete process.env.INSTAMOVE_PAYMENT_TOKEN;
  else process.env.INSTAMOVE_PAYMENT_TOKEN = originalPaymentToken;
  if (originalAdminToken === undefined) delete process.env.INSTAMOVE_ADMIN_TOKEN;
  else process.env.INSTAMOVE_ADMIN_TOKEN = originalAdminToken;
});

test("placeholder and short tokens are unusable", () => {
  assert.equal(isUsableToken("short"), false);
  assert.equal(isUsableToken("replace-with-a-long-random-token"), false);
  assert.equal(isUsableToken("a-secure-development-token-value"), true);
});

test("payment and admin roles must use different tokens", () => {
  process.env.INSTAMOVE_PAYMENT_TOKEN = "shared-token-value-that-is-long-enough";
  process.env.INSTAMOVE_ADMIN_TOKEN = "shared-token-value-that-is-long-enough";
  const configuration = getAuthConfiguration();

  assert.equal(configuration.rolesAreDistinct, false);
  assert.equal(configuration.valid, false);
});

test("misconfigured roles fail authorization closed", () => {
  process.env.INSTAMOVE_PAYMENT_TOKEN = "shared-token-value-that-is-long-enough";
  process.env.INSTAMOVE_ADMIN_TOKEN = "shared-token-value-that-is-long-enough";
  const req = { get: () => "Bearer shared-token-value-that-is-long-enough" };
  const res = { set: () => {} };
  let result;

  authorize("admin")(req, res, (error) => { result = error; });
  assert.equal(result.code, "AUTH_MISCONFIGURED");
  assert.equal(result.statusCode, 503);
});
