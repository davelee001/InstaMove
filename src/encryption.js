const crypto = require("crypto");
const config = require("../config/encryption.json");
const { AppError } = require("./errors");

const KEY_BYTES = 32;

function readKey(source = process.env[config.keyEnvironmentVariable]) {
  if (!source) {
    throw new AppError(
      503,
      "ENCRYPTION_NOT_CONFIGURED",
      `${config.keyEnvironmentVariable} must be configured for encrypted payloads`
    );
  }

  const value = String(source).trim();
  let key;
  if (/^[0-9a-f]{64}$/i.test(value)) {
    key = Buffer.from(value, "hex");
  } else {
    try {
      key = Buffer.from(value, "base64");
    } catch {
      key = null;
    }
  }

  if (!key || key.length !== KEY_BYTES) {
    throw new AppError(
      503,
      "INVALID_ENCRYPTION_KEY",
      `${config.keyEnvironmentVariable} must be 32 bytes encoded as hex or base64`
    );
  }

  return key;
}

function envelopeAad(version) {
  return Buffer.from(`instamove:${version}`, "utf8");
}

function encrypt(payload) {
  const iv = crypto.randomBytes(config.ivLength);
  const cipher = crypto.createCipheriv(config.algorithm, readKey(), iv, {
    authTagLength: config.tagLength
  });
  cipher.setAAD(envelopeAad(config.envelopeVersion));

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    config.envelopeVersion,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

function decrypt(envelope) {
  const parts = String(envelope || "").split(".");
  if (parts.length !== 4 || parts[0] !== config.envelopeVersion) {
    throw new AppError(422, "INVALID_ENCRYPTED_PAYLOAD", "The encrypted payload envelope is invalid");
  }

  try {
    const [version, ivValue, tagValue, ciphertextValue] = parts;
    const iv = Buffer.from(ivValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");

    if (iv.length !== config.ivLength || tag.length !== config.tagLength || ciphertext.length === 0) {
      throw new Error("Invalid envelope lengths");
    }

    const decipher = crypto.createDecipheriv(config.algorithm, readKey(), iv, {
      authTagLength: config.tagLength
    });
    decipher.setAAD(envelopeAad(version));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 503) throw error;
    throw new AppError(422, "INVALID_ENCRYPTED_PAYLOAD", "The encrypted payload could not be authenticated");
  }
}

module.exports = { decrypt, encrypt, readKey };
