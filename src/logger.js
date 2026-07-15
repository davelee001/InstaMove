const SENSITIVE_KEY = /authorization|token|macaroon|secret|preimage|paymentrequest|payload|ciphertext/i;

function redact(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  }
  return value;
}

function write(level, event, fields = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redact(fields)
  };
  const output = JSON.stringify(record);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
  return record;
}

function info(event, fields) {
  return write("info", event, fields);
}

function warn(event, fields) {
  return write("warn", event, fields);
}

function error(event, fields) {
  return write("error", event, fields);
}

module.exports = { error, info, redact, warn, write };
