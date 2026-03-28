const encryption = require("./encryption");
const channel = require("./channel");
const invoice = require("./invoice");
const lightning = require("./lightning");
const notifier = require("./notifier");
const nodeService = require("./node");
const { readJson, writeJson } = require("./storage");
const networkConfig = require("../config/network.json");
const invoiceConfig = require("../config/invoice.json");

function resolvePayloadSource(data, storedRequest) {
  return data.payload || storedRequest?.payload || storedRequest?.encryptedPayload || null;
}

async function handleRequest(data) {
  try {
    const requests = await readJson("data/requests.json", []);
    const channels = await readJson("data/channels.json", []);
    const storedRequest = requests.find(
      (request) => request.id === data.requestId || request.id === data.id || request.domain === data.domain
    ) || null;

    const payload = resolvePayloadSource(data, storedRequest);
    const decrypted = payload ? encryption.decrypt(payload) : {
      domain: data.domain || storedRequest?.domain || null,
      address: data.address || storedRequest?.address || null
    };

    if (data.paymentRequest || data.invoiceRequest || data.bolt11) {
      const paymentRequest = data.paymentRequest || data.invoiceRequest || data.bolt11;

      const settlement = await lightning.settlePaymentRequest({
        paymentRequest,
        fallbackAmount: Number(data.amount || invoiceConfig.defaultAmount)
      });

      const connectionStatus = settlement.payment?.success ? "connection successful" : "connection failed";

      return {
        status: settlement.status,
        requestProcessed: true,
        connectionSuccess: Boolean(settlement.payment?.success),
        connectionStatus,
        invoiceCreated: false,
        invoiceSettled: settlement.status === "ok",
        lightningMode: settlement.mode || "mock",
        amount: settlement.amount,
        amountLabel: settlement.amountLabel,
        sentTo: settlement.sentTo,
        message: settlement.message,
        request: {
          id: storedRequest?.id || data.requestId || data.id || null,
          paymentRequest,
          decrypted
        },
        payment: settlement.payment,
        decodedInvoice: settlement.decoded,
        transaction: settlement
      };
    }

    if (!decrypted.domain && !decrypted.address) {
      return {
        status: "error",
        message: "No request payload or address found"
      };
    }

    const selectedNode = data.nodeId
      ? await nodeService.getNodeById(data.nodeId)
      : await nodeService.getActiveNode();

    if (!selectedNode) {
      return {
        status: "error",
        message: "No Lightning node is configured"
      };
    }

    const channelRecord = await channel.create({
      ...decrypted,
      nodeId: selectedNode?.id || null,
      nodeIp: selectedNode?.ip || null,
      nodeHost: selectedNode?.host || selectedNode?.ip || null,
      nodePubkey: selectedNode?.pubkey || null,
      attempts: networkConfig.retryAttempts,
      timeoutMs: networkConfig.timeoutMs
    });

    await writeJson("data/channels.json", [...channels, channelRecord]);

    const invoiceDraft = await invoice.create({
      requestId: storedRequest?.id || data.requestId || data.id || null,
      currency: invoiceConfig.currency,
      amount: invoiceConfig.defaultAmount
    });

    const settledInvoice = await invoice.settle(invoiceDraft, {
      nodeId: selectedNode?.id || null,
      paymentRequest: data.paymentRequest || data.settlementRequest || null
    });

    const connection = notifier.send("Connection successful");
    const connectionStatus = connection.success ? "connection successful" : "connection failed";

    if (storedRequest) {
      const updatedRequests = requests.map((request) => {
        if (request.id !== storedRequest.id) {
          return request;
        }

        return {
          ...request,
          status: "processed",
          settled: true,
          channelId: channelRecord.id,
          invoiceId: settledInvoice.id
        };
      });

      await writeJson("data/requests.json", updatedRequests);
    }

    return {
      status: "ok",
      requestProcessed: true,
      connectionSuccess: connection.success,
      connectionStatus,
      invoiceCreated: invoiceDraft.created,
      invoiceSettled: Boolean(settledInvoice.settled),
      lightningMode: settledInvoice.mode || invoiceDraft.mode || "mock",
      request: {
        id: storedRequest?.id || data.requestId || data.id || null,
        decrypted
      },
      connection,
      node: selectedNode,
      channel: channelRecord,
      invoice: settledInvoice
    };
  } catch (error) {
    return {
      status: "error",
      message: error.message
    };
  }
}

module.exports = { handleRequest };
