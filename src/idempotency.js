const crypto = require("crypto");
const { AppError } = require("./errors");
const { readJson, writeJson } = require("./storage");

const IDEMPOTENCY_FILE = "data/idempotency.json";
const RETENTION_MS = 24 * 60 * 60 * 1000;
const inFlight = new Map();
let persistenceQueue = Promise.resolve();

function fingerprint(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function findRecord(key) {
  const records = await readJson(IDEMPOTENCY_FILE, []);
  return records.find((record) => record.key === key) || null;
}

async function persistRecord(record) {
  const operation = persistenceQueue.then(async () => {
    const now = Date.now();
    const records = await readJson(IDEMPOTENCY_FILE, []);
    const retained = records.filter(
      (item) => item.key !== record.key && Date.parse(item.createdAt) >= now - RETENTION_MS
    );
    await writeJson(IDEMPOTENCY_FILE, [...retained, record]);
  });
  persistenceQueue = operation.catch(() => {});
  return operation;
}

async function execute({ key, payload, operation }) {
  const requestFingerprint = fingerprint(payload);
  const stored = await findRecord(key);

  if (stored) {
    if (stored.fingerprint !== requestFingerprint) {
      throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different request");
    }
    return { replayed: true, result: stored.result };
  }

  const active = inFlight.get(key);
  if (active) {
    if (active.fingerprint !== requestFingerprint) {
      throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key is being used with a different request");
    }
    return { replayed: true, result: await active.promise };
  }

  const promise = (async () => {
    const result = await operation();
    await persistRecord({
      key,
      fingerprint: requestFingerprint,
      createdAt: new Date().toISOString(),
      result
    });
    return result;
  })();

  inFlight.set(key, { fingerprint: requestFingerprint, promise });
  try {
    return { replayed: false, result: await promise };
  } finally {
    inFlight.delete(key);
  }
}

module.exports = { execute };
