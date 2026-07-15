const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { afterEach, test } = require("node:test");
const encryption = require("../src/encryption");

const originalKey = process.env.INSTAMOVE_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.INSTAMOVE_ENCRYPTION_KEY;
  else process.env.INSTAMOVE_ENCRYPTION_KEY = originalKey;
});

test("authenticated payloads round trip", () => {
  process.env.INSTAMOVE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  const payload = { domain: "merchant.test", amount: 50 };
  const envelope = encryption.encrypt(payload);

  assert.match(envelope, /^v1\./);
  assert.deepEqual(encryption.decrypt(envelope), payload);
});

test("encryption uses a fresh nonce for each envelope", () => {
  process.env.INSTAMOVE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  const first = encryption.encrypt({ domain: "merchant.test" });
  const second = encryption.encrypt({ domain: "merchant.test" });

  assert.notEqual(first, second);
  assert.notEqual(first.split(".")[1], second.split(".")[1]);
});

test("tampered ciphertext is rejected", () => {
  process.env.INSTAMOVE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  const parts = encryption.encrypt({ domain: "merchant.test" }).split(".");
  parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith("A") ? "B" : "A"}`;

  assert.throws(
    () => encryption.decrypt(parts.join(".")),
    (error) => error.code === "INVALID_ENCRYPTED_PAYLOAD" && error.statusCode === 422
  );
});

test("missing encryption keys fail closed", () => {
  delete process.env.INSTAMOVE_ENCRYPTION_KEY;
  assert.throws(
    () => encryption.encrypt({ domain: "merchant.test" }),
    (error) => error.code === "ENCRYPTION_NOT_CONFIGURED" && error.statusCode === 503
  );
});

test("invalid encryption key lengths are rejected", () => {
  process.env.INSTAMOVE_ENCRYPTION_KEY = "too-short";
  assert.throws(
    () => encryption.encrypt({ domain: "merchant.test" }),
    (error) => error.code === "INVALID_ENCRYPTION_KEY" && error.statusCode === 503
  );
});
