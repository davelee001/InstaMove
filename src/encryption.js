const crypto = require("crypto");
const config = require("../config/encryption.json");

function normalizeKey(secretKey) {
  return crypto.createHash("sha256").update(String(secretKey)).digest();
}

function encrypt(payload) {
  const cipher = crypto.createCipheriv(
    config.algorithm,
    normalizeKey(config.secretKey),
    Buffer.alloc(config.ivLength, 0)
  );

  let encrypted = cipher.update(JSON.stringify(payload), "utf8", "hex");
  encrypted += cipher.final("hex");

  return encrypted;
}

function decrypt(payload) {
  const decipher = crypto.createDecipheriv(
    config.algorithm,
    normalizeKey(config.secretKey),
    Buffer.alloc(config.ivLength, 0)
  );

  let decrypted = decipher.update(payload, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return JSON.parse(decrypted);
}

module.exports = { encrypt, decrypt };
