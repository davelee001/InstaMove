const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const path = require("path");
const lightningConfig = require("../config/lightning.json");

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

function isRealMode() {
  const mode = getMode();
  return (mode === "lnd" || mode === "regtest") && Boolean(process.env.LND_REST_URL) && Boolean(process.env.LND_MACAROON);
}

function getRuntimeMode() {
  return getMode() === "regtest" ? "regtest" : "lnd";
}

function readMacaroonHeaderValue(source) {
  if (!source) {
    return null;
  }

  if (fs.existsSync(source)) {
    return fs.readFileSync(source).toString("hex");
  }

  return source.replace(/^0x/i, "");
}

function requestJson(urlString, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === "http:" ? http : https;
    const request = transport.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        headers,
        rejectUnauthorized: process.env.LND_ALLOW_INSECURE !== "true"
      },
      (response) => {
        let responseBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 400) {
            return reject(new Error(`Lightning API error ${response.statusCode}: ${responseBody}`));
          }

          if (!responseBody) {
            return resolve({});
          }

          try {
            return resolve(JSON.parse(responseBody));
          } catch (error) {
            return reject(error);
          }
        });
      }
    );

    request.on("error", reject);

    if (body) {
      request.write(JSON.stringify(body));
    }

    request.end();
  });
}

async function callLnd(pathname, options = {}) {
  const baseUrl = process.env.LND_REST_URL;
  const macaroon = readMacaroonHeaderValue(process.env.LND_MACAROON);

  if (!baseUrl || !macaroon) {
    throw new Error("LND_REST_URL and LND_MACAROON are required for lnd/regtest mode");
  }

  return requestJson(`${baseUrl.replace(/\/$/, "")}${pathname}`, {
    method: options.method || "GET",
    headers: {
      "Grpc-Metadata-macaroon": macaroon,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body
  });
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

async function payInvoice(paymentRequest) {
  if (!isRealMode()) {
    return {
      success: true,
      paymentId: `pay-${Date.now()}`,
      status: "settled",
      mode: "mock"
    };
  }

  const response = await callLnd("/v1/channels/transactions", {
    method: "POST",
    body: {
      payment_request: paymentRequest,
      fee_limit_sat: Number(process.env.LND_FEE_LIMIT_SAT || lightningConfig.feeLimitSat || 20)
    }
  });

  return {
    success: true,
    paymentId: response.payment_hash || response.payment_preimage || `pay-${Date.now()}`,
    status: response.payment_error ? "failed" : "settled",
    raw: response,
    mode: getRuntimeMode()
  };
}

async function decodeInvoice(paymentRequest, fallbackAmount) {
  if (!paymentRequest) {
    throw new Error("paymentRequest is required to decode an invoice");
  }

  if (!isRealMode()) {
    const localAmount = getLocalInvoiceAmount(paymentRequest);
    if (localAmount == null) {
      throw new Error(`Unrecognized local invoice: ${paymentRequest}`);
    }

    const amount = Number(localAmount);

    return {
      paymentRequest,
      amount,
      currency: "sats",
      memo: lightningConfig.invoiceMemo,
      destination: "invoice destination",
      mode: "mock",
      raw: null
    };
  }

  const response = await callLnd(`/v1/payreq/${encodeURIComponent(paymentRequest)}`);
  const amount = Number(response.num_satoshis || response.num_sats || fallbackAmount || 0);

  return {
    paymentRequest,
    amount,
    currency: "sats",
    memo: response.description || response.memo || lightningConfig.invoiceMemo,
    destination: response.destination || null,
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
    settledAt: new Date().toISOString(),
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
  const payment = await payInvoice(paymentRequest);
  const amount = Number(decoded.amount || getLocalInvoiceAmount(paymentRequest) || fallbackAmount || 0);
  const amountLabel = `${amount} sats`;
  const destination = decoded.destination || decoded.memo || "invoice destination";
  const confirmationMessage = `${amountLabel} sent successfully`;

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
  getMode
};