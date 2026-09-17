const crypto = require("crypto");
const lightningConfig = require("../config/lightning.json");
const { AppError } = require("./errors");
const { callLnd } = require("./lnd-client");
const { getMaxPaymentSats, validateInvoice } = require("./validation");

const SUPPORTED_MODES = new Set(["mock", "regtest", "lnd"]);
const LND_MODES = new Set(["regtest", "lnd"]);

function buildLocalInvoice(amount) {
  const suffix = crypto.createHash("sha256").update(`instamove:${amount}`).digest("hex").slice(0, 16);
  return `lnbcrt${amount}u1instamove${suffix}`;
}

const localInvoiceCatalog = new Map([
  [buildLocalInvoice(10000), 10000],
  [buildLocalInvoice(5000), 5000],
  [buildLocalInvoice(10), 10]
]);

function getLocalInvoiceAmount(paymentRequest) {
  if (!paymentRequest) {
    return null;
  }

  return localInvoiceCatalog.get(String(paymentRequest).trim()) || null;
}

function getMode() {
  return (process.env.LIGHTNING_MODE || lightningConfig.mode || "mock").toLowerCase();
}

function assertConfiguration() {
  const mode = getMode();

  if (!SUPPORTED_MODES.has(mode)) {
    throw new Error(
      `Unsupported LIGHTNING_MODE "${mode}". Expected one of: mock, regtest, lnd`
    );
  }

  if (LND_MODES.has(mode)) {
    const missing = ["LND_REST_URL", "LND_MACAROON"].filter(
      (name) => !String(process.env[name] || "").trim()
    );

    if (missing.length > 0) {
      throw new Error(
        `LIGHTNING_MODE=${mode} requires ${missing.join(" and ")}. ` +
          "Set the missing environment variables or use LIGHTNING_MODE=mock explicitly"
      );
    }
  }

  return mode;
}

function isRealMode() {
  return LND_MODES.has(assertConfiguration());
}

function getRuntimeMode() {
  return assertConfiguration();
}

async function createInvoice({ requestId, amount, memo, expirySeconds }) {
  if (!isRealMode()) {
    return {
      id: `inv-${Date.now()}`,
      requestId: requestId || null,
      amount,
      currency: "sats",
      status: "created",
      created: true,
      paymentRequest: `mock-pr-${Date.now()}`,
      mode: "mock"
    };
  }

  const response = await callLnd("/v1/invoices", {
    method: "POST",
    body: {
      value: amount,
      memo: memo || lightningConfig.invoiceMemo,
      expiry: expirySeconds || lightningConfig.invoiceExpirySeconds
    }
  });

  return {
    id: response.r_hash || `inv-${Date.now()}`,
    requestId: requestId || null,
    amount,
    currency: "sats",
    status: "created",
    created: true,
    paymentRequest: response.payment_request,
    rHash: response.r_hash,
    addIndex: response.add_index,
      mode: getRuntimeMode()
  };
}

function unconfirmedPayment() {
  return new AppError(
    502,
    "LND_PAYMENT_UNCONFIRMED",
    "The Lightning payment outcome is unconfirmed; reconcile with LND before retrying"
  );
}

function isResponseObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodePaymentBytes(value) {
  // SendPaymentSync REST byte fields use canonical padded base64, not hex.
  // Buffer.from alone is permissive: reject junk, truncation and invalid padding.
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw unconfirmedPayment();
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) {
    throw unconfirmedPayment();
  }
  return bytes;
}

function validatePaymentResponse(response, expectedPaymentHash) {
  if (!isResponseObject(response)) throw unconfirmedPayment();
  if (response.payment_error !== undefined && typeof response.payment_error !== "string") {
    throw unconfirmedPayment();
  }

  // Explicit failures take precedence even when a response also contains a proof.
  if (response.payment_error || response.status === "FAILED") {
    return { success: false, paymentId: null, status: "failed", mode: getRuntimeMode() };
  }

  // This endpoint is synchronous. A status from another API must never turn an
  // in-flight, unknown or otherwise unexpected response into a settled payment.
  if (response.status !== undefined && response.status !== "SUCCEEDED") {
    throw unconfirmedPayment();
  }
  if (response.error !== undefined || response.code !== undefined) throw unconfirmedPayment();

  const paymentHash = decodePaymentBytes(response.payment_hash);
  const preimage = decodePaymentBytes(response.payment_preimage);
  if (preimage.equals(Buffer.alloc(32))) throw unconfirmedPayment();
  const proofHash = crypto.createHash("sha256").update(preimage).digest();
  const invoiceHash = Buffer.from(expectedPaymentHash, "hex");
  if (!crypto.timingSafeEqual(proofHash, paymentHash) ||
      !crypto.timingSafeEqual(paymentHash, invoiceHash)) {
    throw unconfirmedPayment();
  }

  return {
    success: true,
    // Keep the existing REST hash representation; never expose the preimage or
    // manufacture a payment ID when the upstream response is incomplete.
    paymentId: response.payment_hash,
    status: "settled",
    mode: getRuntimeMode()
  };
}

async function sendDecodedPayment(paymentRequest, expectedPaymentHash) {
  let response;
  try {
    response = await callLnd("/v1/channels/transactions", {
      method: "POST",
      body: {
        payment_request: paymentRequest,
        fee_limit_sat: Number(process.env.LND_FEE_LIMIT_SAT || lightningConfig.feeLimitSat || 20)
      }
    });
  } catch (error) {
    // A lost or unusable response does not prove that the payment failed.
    if (["LND_TIMEOUT", "LND_UNAVAILABLE", "LND_HTTP_ERROR",
      "LND_INVALID_RESPONSE", "LND_RESPONSE_TOO_LARGE"].includes(error.code)) {
      throw unconfirmedPayment();
    }
    throw error;
  }
  return validatePaymentResponse(response, expectedPaymentHash);
}

async function payInvoice(paymentRequest) {
  const normalizedPaymentRequest = validateInvoice(paymentRequest);
  if (!isRealMode()) {
    return {
      success: true,
      paymentId: `pay-${Date.now()}`,
      status: "settled",
      mode: "mock"
    };
  }
  const decoded = await decodeInvoice(normalizedPaymentRequest);
  return sendDecodedPayment(normalizedPaymentRequest, decoded.paymentHash);
}

async function decodeInvoice(paymentRequest, fallbackAmount) {
  const normalizedPaymentRequest = validateInvoice(paymentRequest);

  if (!isRealMode()) {
    const localAmount = getLocalInvoiceAmount(normalizedPaymentRequest);
    if (localAmount == null) {
      throw new AppError(422, "UNRECOGNIZED_INVOICE", "The invoice is not available in mock mode");
    }

    const amount = Number(localAmount);

    return {
      paymentRequest: normalizedPaymentRequest,
      amount,
      currency: "sats",
      memo: lightningConfig.invoiceMemo,
      destination: "invoice destination",
      mode: "mock",
      raw: null
    };
  }

  const response = await callLnd(`/v1/payreq/${encodeURIComponent(normalizedPaymentRequest)}`);
  if (!isResponseObject(response) || typeof response.payment_hash !== "string" ||
      !/^[0-9a-fA-F]{64}$/.test(response.payment_hash)) {
    throw new AppError(502, "LND_INVALID_RESPONSE", "The Lightning service returned an invalid decoded invoice");
  }
  const amount = Number(response.num_satoshis || response.num_sats || fallbackAmount || 0);

  return {
    paymentRequest: normalizedPaymentRequest,
    amount,
    currency: "sats",
    memo: response.description || response.memo || lightningConfig.invoiceMemo,
    destination: response.destination || null,
    paymentHash: response.payment_hash.toLowerCase(),
    descriptionHash: response.description_hash || null,
    expiry: response.expiry || null,
    mode: getRuntimeMode(),
    raw: response
  };
}

function shouldIgnorePeerConnectError(errorMessage) {
  const message = String(errorMessage || "").toLowerCase();
  return message.includes("already connected") || message.includes("already exists");
}

async function connectPeer(peerPubkey, peerHost) {
  if (!peerPubkey || !peerHost || !isRealMode()) {
    return { connected: false, skipped: true };
  }

  try {
    const response = await callLnd("/v1/peers", {
      method: "POST",
      body: {
        addr: {
          pubkey: peerPubkey,
          host: peerHost
        },
        perm: true
      }
    });

    return {
      connected: true,
      skipped: false,
      response
    };
  } catch (error) {
    if (shouldIgnorePeerConnectError(error.message)) {
      return {
        connected: true,
        skipped: false,
        note: "Peer already connected"
      };
    }

    throw error;
  }
}

async function ensureChannel({ nodeId, nodeIp, nodeHost, nodePubkey, target, fundingAmount, requestId }) {
  if (!isRealMode()) {
    return {
      id: `channel-${Date.now()}`,
      nodeId: nodeId || null,
      nodeIp: nodeIp || null,
      nodeHost: nodeHost || nodeIp || null,
      nodePubkey: nodePubkey || null,
      target: target || null,
      requestId: requestId || null,
      status: "open",
      fundingAmount: fundingAmount || lightningConfig.channelFundingSats,
      mode: "mock"
    };
  }

  const peerPubkey = nodePubkey || process.env.LND_PEER_PUBKEY || null;
  const peerHost = nodeHost || nodeIp || process.env.LND_PEER_HOST || null;
  const localFundingAmount = Number(process.env.LND_CHANNEL_FUNDING_SATS || fundingAmount || lightningConfig.channelFundingSats);

  if (!peerPubkey) {
    return {
      id: `channel-${Date.now()}`,
      nodeId: nodeId || null,
      nodeIp: nodeIp || null,
      nodeHost: peerHost,
      nodePubkey: null,
      target: target || null,
      requestId: requestId || null,
      status: "open",
      fundingAmount: localFundingAmount,
      mode: getRuntimeMode(),
      note: "Node pubkey is not set, returned routing record only"
    };
  }

  const peer = await connectPeer(peerPubkey, peerHost);

  const response = await callLnd("/v1/channels", {
    method: "POST",
    body: {
      node_pubkey: peerPubkey,
      local_funding_amount: localFundingAmount,
      private: Boolean(process.env.LND_PRIVATE_CHANNEL === "true")
    }
  });

  return {
    id: response.funding_txid_str || `channel-${Date.now()}`,
    nodeId: nodeId || null,
    nodeIp: nodeIp || null,
    nodeHost: peerHost,
    nodePubkey: peerPubkey,
    target: target || null,
    requestId: requestId || null,
    status: response.status || "opening",
    fundingAmount: localFundingAmount,
    peer,
    raw: response,
    mode: getRuntimeMode()
  };
}

async function settleInvoice(invoiceRecord, paymentRequest) {
  const shouldAutoSettle = process.env.LIGHTNING_AUTO_SETTLE
    ? process.env.LIGHTNING_AUTO_SETTLE === "true"
    : lightningConfig.autoSettle;

  const requestToPay = paymentRequest || (shouldAutoSettle ? invoiceRecord.paymentRequest : null);

  if (
    requestToPay &&
    String(requestToPay).toLowerCase() === String(invoiceRecord.paymentRequest || "").toLowerCase()
  ) {
    throw new AppError(409, "SELF_PAYMENT_NOT_ALLOWED", "The active node cannot pay an invoice it created");
  }

  if (!requestToPay) {
    return {
      ...invoiceRecord,
      status: "pending",
      settled: false,
      settlementPending: true,
      mode: isRealMode() ? "lnd" : "mock"
    };
  }

  const payment = await payInvoice(requestToPay);

  return {
    ...invoiceRecord,
    status: payment.status === "settled" ? "settled" : "failed",
    settled: payment.status === "settled",
    settlementPending: false,
    settledAt: payment.status === "settled" ? new Date().toISOString() : null,
    paymentId: payment.paymentId,
    paymentRequest: invoiceRecord.paymentRequest,
    mode: payment.mode,
    payment
  };
}

async function settlePaymentRequest({ paymentRequest, fallbackAmount }) {
  if (!paymentRequest) {
    throw new Error("paymentRequest is required to settle a payment");
  }

  const decoded = await decodeInvoice(paymentRequest, fallbackAmount);
  const amount = Number(decoded.amount || getLocalInvoiceAmount(paymentRequest) || fallbackAmount || 0);
  const maxAmount = getMaxPaymentSats();
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > maxAmount) {
    throw new AppError(422, "AMOUNT_LIMIT_EXCEEDED", `Invoice amount must be between 1 and ${maxAmount} sats`);
  }

  const payment = decoded.mode === "mock"
    ? await payInvoice(paymentRequest)
    : await sendDecodedPayment(validateInvoice(paymentRequest), decoded.paymentHash);
  const amountLabel = `${amount} sats`;
  const destination = decoded.destination || decoded.memo || "invoice destination";
  const confirmationMessage = payment.success
    ? `${amountLabel} sent successfully`
    : "The Lightning payment was not settled";

  return {
    status: payment.status === "settled" ? "ok" : "error",
    amount,
    amountLabel,
    sentTo: destination,
    message: confirmationMessage,
    paymentRequest,
    decoded,
    payment,
    mode: payment.mode
  };
}

module.exports = {
  createInvoice,
  decodeInvoice,
  payInvoice,
  ensureChannel,
  settleInvoice,
  settlePaymentRequest,
  getLocalInvoiceAmount,
  buildLocalInvoice,
  isRealMode,
  getMode,
  assertConfiguration
};
