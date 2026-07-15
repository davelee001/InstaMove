const crypto = require("crypto");
const { AppError } = require("./errors");
const { claimRecord, completeRecord, releaseRecord } = require("./idempotency-store");

const inFlight = new Map();

function fingerprint(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function execute({ key, payload, operation }) {
  const requestFingerprint = fingerprint(payload);
  const active = inFlight.get(key);
  if (active) {
    if (active.fingerprint !== requestFingerprint) {
      throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key is being used with a different request");
    }
    return { replayed: true, result: (await active.promise).result };
  }

  const ownerId = crypto.randomUUID();
  const promise = (async () => {
    const claim = claimRecord({ key, fingerprint: requestFingerprint, ownerId });
    if (claim.status === "conflict") {
      throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different request");
    }
    if (claim.status === "pending") {
      throw new AppError(
        409,
        "IDEMPOTENCY_RECONCILIATION_REQUIRED",
        "The original request is incomplete and must be reconciled before retrying"
      );
    }
    if (claim.status === "completed") {
      return { replayed: true, result: claim.result };
    }

    let result;
    try {
      result = await operation();
    } catch (error) {
      releaseRecord({ key, fingerprint: requestFingerprint, ownerId });
      throw error;
    }

    try {
      completeRecord({ key, fingerprint: requestFingerprint, ownerId, result });
    } catch {
      throw new AppError(
        503,
        "PERSISTENCE_CONFIRMATION_FAILED",
        "The operation completed but its durable result could not be confirmed"
      );
    }
    return { replayed: false, result };
  })();

  inFlight.set(key, { fingerprint: requestFingerprint, promise });
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

module.exports = { execute };
