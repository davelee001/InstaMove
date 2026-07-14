const invoiceConfig = require("../config/invoice.json");
const { AppError } = require("./errors");

const INVOICE_PATTERN = /^ln(?:bc|tb|bcrt|sb)[0-9a-z]+$/i;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function getMaxPaymentSats() {
  const configured = Number(process.env.MAX_PAYMENT_SATS || invoiceConfig.maxAmountSats || 1000000);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 1000000;
}

function validationError(message, details) {
  throw new AppError(422, "VALIDATION_ERROR", message, details);
}

function assertPlainObject(value, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    validationError(`${label} must be a JSON object`);
  }
}

function rejectUnknownKeys(value, allowedKeys) {
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    validationError("Request contains unsupported fields", { fields: unknown });
  }
}

function optionalString(value, name, maxLength) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    validationError(`${name} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    validationError(`${name} must contain between 1 and ${maxLength} characters`);
  }

  return normalized;
}

function optionalAmount(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const amount = value;
  const maxAmount = getMaxPaymentSats();
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1 || amount > maxAmount) {
    validationError(`amount must be an integer between 1 and ${maxAmount} sats`);
  }

  return amount;
}

function validateInvoice(paymentRequest) {
  const normalized = optionalString(paymentRequest, "paymentRequest", 4096);
  if (!normalized || normalized.length < 20 || !INVOICE_PATTERN.test(normalized)) {
    validationError("paymentRequest must be a valid BOLT11 invoice");
  }
  return normalized;
}

function validatePaymentAmount(amount) {
  return optionalAmount(amount);
}

function validateRequestBody(body) {
  assertPlainObject(body);
  rejectUnknownKeys(body, [
    "paymentRequest",
    "invoiceRequest",
    "bolt11",
    "amount",
    "domain",
    "address",
    "payload",
    "requestId",
    "id",
    "nodeId",
    "memo"
  ]);

  const aliases = [body.paymentRequest, body.invoiceRequest, body.bolt11].filter(
    (value) => value !== undefined && value !== null
  );
  if (aliases.length > 1) {
    validationError("Use only paymentRequest; invoice aliases cannot be combined");
  }
  if (body.requestId !== undefined && body.id !== undefined) {
    validationError("Use requestId or id, not both");
  }

  const paymentRequest = aliases.length === 1 ? validateInvoice(aliases[0]) : undefined;
  const amount = optionalAmount(body.amount);
  const domain = optionalString(body.domain, "domain", 255);
  const address = optionalString(body.address, "address", 255);
  const payload = optionalString(body.payload, "payload", 16384);
  const requestId = optionalString(body.requestId || body.id, "requestId", 128);
  const nodeId = optionalString(body.nodeId, "nodeId", 128);
  const memo = optionalString(body.memo, "memo", 256);

  if (requestId && !ID_PATTERN.test(requestId)) {
    validationError("requestId contains unsupported characters");
  }
  if (nodeId && !ID_PATTERN.test(nodeId)) {
    validationError("nodeId contains unsupported characters");
  }
  if (payload && (!/^[0-9a-f]+$/i.test(payload) || payload.length % 2 !== 0)) {
    validationError("payload must be an even-length hexadecimal string");
  }
  if (paymentRequest && (domain || address || payload)) {
    validationError("A payment request cannot be combined with invoice-creation fields");
  }
  if (!paymentRequest && !domain && !address && !payload && !requestId) {
    validationError("Provide paymentRequest or invoice request data");
  }

  return {
    ...(paymentRequest && { paymentRequest }),
    ...(amount !== undefined && { amount }),
    ...(domain && { domain }),
    ...(address && { address }),
    ...(payload && { payload }),
    ...(requestId && { requestId }),
    ...(nodeId && { nodeId }),
    ...(memo && { memo })
  };
}

function validateNodeBody(body) {
  assertPlainObject(body);
  rejectUnknownKeys(body, ["id", "ip", "host", "pubkey", "alias", "status"]);

  const id = optionalString(body.id, "id", 128);
  if (!id || !ID_PATTERN.test(id)) {
    validationError("id is required and may contain letters, numbers, dots, colons, underscores, or hyphens");
  }

  const status = body.status === undefined ? "inactive" : optionalString(body.status, "status", 16);
  if (!["active", "inactive"].includes(status)) {
    validationError("status must be active or inactive");
  }

  return {
    id,
    ip: optionalString(body.ip, "ip", 255),
    host: optionalString(body.host, "host", 255),
    pubkey: optionalString(body.pubkey, "pubkey", 128),
    alias: optionalString(body.alias, "alias", 128),
    status
  };
}

function validateNodeId(value) {
  const id = optionalString(value, "node id", 128);
  if (!id || !ID_PATTERN.test(id)) {
    validationError("node id is invalid");
  }
  return id;
}

function validateBluetoothBody(body) {
  assertPlainObject(body);
  const size = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (size > 16384) {
    validationError("Bluetooth payload must not exceed 16384 bytes");
  }
  return body;
}

function validateIdempotencyKey(value) {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value.trim())) {
    throw new AppError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key must contain 8 to 128 letters, numbers, dots, colons, underscores, or hyphens"
    );
  }
  return value.trim();
}

module.exports = {
  getMaxPaymentSats,
  validateBluetoothBody,
  validateIdempotencyKey,
  validateInvoice,
  validateNodeBody,
  validateNodeId,
  validatePaymentAmount,
  validateRequestBody
};
