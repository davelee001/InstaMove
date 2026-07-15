const encryption = require("./encryption");
const invoice = require("./invoice");
const lightning = require("./lightning");
const notifier = require("./notifier");
const nodeService = require("./node");
const { AppError } = require("./errors");
const { readJson, updateCollections } = require("./storage");
const invoiceConfig = require("../config/invoice.json");

function resolvePayloadSource(data, storedRequest) {
  return data.payload || storedRequest?.payload || storedRequest?.encryptedPayload || null;
}

function publicPayment(payment) {
  return {
    success: payment.success,
    paymentId: payment.paymentId,
    status: payment.status,
    mode: payment.mode
  };
}

function publicDecodedInvoice(decoded) {
  return {
    amount: decoded.amount,
    currency: decoded.currency,
    memo: decoded.memo,
    destination: decoded.destination,
    expiry: decoded.expiry,
    mode: decoded.mode
  };
}

async function handlePayment(data, storedRequest, invoices) {
  const normalizedPaymentRequest = data.paymentRequest.toLowerCase();
  const ownedInvoice = invoices.find(
    (item) => String(item.paymentRequest || "").toLowerCase() === normalizedPaymentRequest
  );
  if (ownedInvoice) {
    throw new AppError(409, "SELF_PAYMENT_NOT_ALLOWED", "The active node cannot pay an invoice it created");
  }

  const settlement = await lightning.settlePaymentRequest({
    paymentRequest: data.paymentRequest,
    fallbackAmount: data.amount
  });

  if (!settlement.payment.success || settlement.status !== "ok") {
    throw new AppError(502, "PAYMENT_FAILED", "The Lightning payment was not settled");
  }

  return {
    status: "ok",
    requestProcessed: true,
    connectionSuccess: true,
    connectionStatus: "payment settled",
    invoiceCreated: false,
    invoiceSettled: true,
    channelCreated: false,
    lightningMode: settlement.mode,
    amount: settlement.amount,
    amountLabel: settlement.amountLabel,
    sentTo: settlement.sentTo,
    message: settlement.message,
    request: {
      id: storedRequest?.id || data.requestId || null,
      paymentRequest: data.paymentRequest
    },
    payment: publicPayment(settlement.payment),
    decodedInvoice: publicDecodedInvoice(settlement.decoded)
  };
}

async function handleInvoiceCreation(data, storedRequest) {
  const payload = resolvePayloadSource(data, storedRequest);
  let decrypted;

  try {
    decrypted = payload
      ? encryption.decrypt(payload)
      : {
          domain: data.domain || storedRequest?.domain || null,
          address: data.address || storedRequest?.address || null
        };
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 503) throw error;
    throw new AppError(422, "INVALID_ENCRYPTED_PAYLOAD", "The encrypted request payload is invalid");
  }

  if (!decrypted.domain && !decrypted.address) {
    throw new AppError(422, "MISSING_DESTINATION", "The invoice request has no domain or address");
  }

  const selectedNode = data.nodeId
    ? await nodeService.getNodeById(data.nodeId)
    : await nodeService.getActiveNode();
  if (!selectedNode) {
    throw new AppError(409, "NO_ACTIVE_NODE", "No active Lightning node is configured");
  }

  const invoiceDraft = await invoice.create({
    requestId: storedRequest?.id || data.requestId || null,
    amount: data.amount || invoiceConfig.defaultAmount,
    memo: data.memo
  });
  const invoiceRecord = {
    ...invoiceDraft,
    nodeId: selectedNode.id,
    origin: "local-node",
    status: "created",
    settled: false,
    createdAt: new Date().toISOString()
  };

  const paths = storedRequest
    ? ["data/invoices.json", "data/requests.json"]
    : ["data/invoices.json"];
  await updateCollections(paths, (collections) => {
    const next = {
      "data/invoices.json": [...collections["data/invoices.json"], invoiceRecord]
    };
    if (storedRequest) {
      next["data/requests.json"] = collections["data/requests.json"].map((request) =>
        request.id === storedRequest.id
          ? { ...request, status: "invoice-created", settled: false, invoiceId: invoiceRecord.id }
          : request
      );
    }
    return next;
  });

  const notification = notifier.send("Invoice created");
  return {
    status: "ok",
    requestProcessed: true,
    connectionSuccess: false,
    connectionStatus: "invoice awaiting external payment",
    invoiceCreated: true,
    invoiceSettled: false,
    channelCreated: false,
    lightningMode: invoiceRecord.mode,
    request: {
      id: storedRequest?.id || data.requestId || null,
      decrypted
    },
    notification,
    node: selectedNode,
    invoice: invoiceRecord
  };
}

async function handleRequest(data) {
  const [requests, invoices] = await Promise.all([
    readJson("data/requests.json", []),
    readJson("data/invoices.json", [])
  ]);
  const storedRequest =
    requests.find(
      (request) =>
        (data.requestId && request.id === data.requestId) ||
        (data.domain && request.domain === data.domain)
    ) || null;

  if (data.paymentRequest) {
    return handlePayment(data, storedRequest, invoices);
  }

  return handleInvoiceCreation(data, storedRequest);
}

module.exports = { handleRequest };
