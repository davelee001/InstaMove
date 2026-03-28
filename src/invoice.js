const config = require("../config/invoice.json");
const lightning = require("./lightning");

async function create(data) {
  return lightning.createInvoice({
    requestId: data.requestId || null,
    amount: Number(data.amount || config.defaultAmount),
    memo: data.memo || config.currency || "InstaMove payment",
    expirySeconds: config.paymentTimeout || 600
  });
}

async function settle(invoiceRecord, payment) {
  return lightning.settleInvoice(invoiceRecord, payment?.paymentRequest || payment?.settlementRequest || null);
}

module.exports = { create, settle };
