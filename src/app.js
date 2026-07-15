const crypto = require("crypto");
const path = require("path");
const express = require("express");
const processor = require("./processor");
const nodeService = require("./node");
const lightning = require("./lightning");
const { initBluetooth, getBluetooth } = require("./bluetooth");
const { authorize } = require("./auth");
const { AppError, normalizeError, toErrorResponse } = require("./errors");
const idempotency = require("./idempotency");
const { renderLandingPage } = require("./landing");
const { createAdminRateLimiter, createPaymentRateLimiter } = require("./rate-limit");
const {
  validateBluetoothBody,
  validateIdempotencyKey,
  validateNodeBody,
  validateNodeId,
  validateRequestBody
} = require("./validation");

lightning.assertConfiguration();

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const suppliedRequestId = req.get("x-request-id");
  req.requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId || "")
    ? suppliedRequestId
    : crypto.randomUUID();
  res.set("X-Request-Id", req.requestId);
  next();
});
app.use("/assets", express.static(path.resolve(__dirname, "../public"), {
  fallthrough: false,
  immutable: true,
  maxAge: "7d"
}));
app.use(express.json({ limit: "32kb", strict: true }));

const paymentRateLimit = createPaymentRateLimiter();
const adminRateLimit = createAdminRateLimiter();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function safeOperationError(error, requestId) {
  const normalized = normalizeError(error);
  if (normalized.statusCode === 500) {
    console.error(`[${requestId}] internal request failure (${error?.name || "Error"})`);
  }
  return toErrorResponse(normalized, requestId);
}

function logJsonResponse(source, payload) {
  console.log(`[${source}] response:`);
  console.log(JSON.stringify(payload, null, 2));
}

const bluetooth = initBluetooth({ name: "InstaMove" });

bluetooth.on("request", async (payload) => {
  const requestId = crypto.randomUUID();
  try {
    validateBluetoothBody(payload);
    const { idempotencyKey: rawKey, ...requestPayload } = payload;
    const key = validateIdempotencyKey(rawKey);
    const validated = validateRequestBody(requestPayload);
    const execution = await idempotency.execute({
      key,
      payload: validated,
      operation: async () => {
        try {
          return { statusCode: 200, body: await processor.handleRequest(validated) };
        } catch (error) {
          return safeOperationError(error, requestId);
        }
      }
    });
    logJsonResponse("bluetooth", execution.result.body);
    bluetooth.sendResponse(execution.result.body);
  } catch (error) {
    bluetooth.sendResponse(toErrorResponse(error, requestId).body);
  }
});

app.get("/", asyncHandler(async (req, res) => {
  const [nodes, bluetoothStatus] = await Promise.all([
    nodeService.listNodes(),
    Promise.resolve(getBluetooth()?.getStatus() || null)
  ]);
  const activeNode = nodes.find((node) => node.status === "active") || nodes[0] || null;

  res.type("html").send(renderLandingPage({
    activeNode,
    nodeCount: nodes.length,
    bluetoothStatus,
    lightningMode: lightning.getMode()
  }));
}));

app.post(
  "/request",
  paymentRateLimit,
  authorize("payment"),
  asyncHandler(async (req, res) => {
    const key = validateIdempotencyKey(req.get("idempotency-key"));
    const payload = validateRequestBody(req.body);
    const execution = await idempotency.execute({
      key,
      payload,
      operation: async () => {
        try {
          return { statusCode: 200, body: await processor.handleRequest(payload) };
        } catch (error) {
          return safeOperationError(error, req.requestId);
        }
      }
    });

    res.set("Idempotency-Replayed", String(execution.replayed));
    logJsonResponse("http", execution.result.body);
    res.status(execution.result.statusCode).json(execution.result.body);
  })
);

app.get("/nodes", adminRateLimit, authorize("admin"), asyncHandler(async (req, res) => {
  const nodes = await nodeService.listNodes();
  res.json({ status: "ok", nodes });
}));

app.post("/nodes", adminRateLimit, authorize("admin"), asyncHandler(async (req, res) => {
  const node = await nodeService.registerNode(validateNodeBody(req.body));
  res.status(201).json({ status: "ok", node });
}));

app.post("/nodes/:id/activate", adminRateLimit, authorize("admin"), asyncHandler(async (req, res) => {
  const node = await nodeService.activateNode(validateNodeId(req.params.id));
  res.json({ status: "ok", node });
}));

app.get("/bluetooth/status", adminRateLimit, authorize("admin"), (req, res) => {
  const bt = getBluetooth();
  if (!bt) throw new AppError(503, "BLUETOOTH_UNAVAILABLE", "Bluetooth is not available");
  res.json({ status: "ok", bluetooth: bt.getStatus() });
});

app.post("/bluetooth/send", adminRateLimit, authorize("admin"), (req, res) => {
  const bt = getBluetooth();
  if (!bt) throw new AppError(503, "BLUETOOTH_UNAVAILABLE", "Bluetooth is not available");
  const payload = validateBluetoothBody(req.body);
  bt.sendResponse(payload);
  res.json({ status: "ok", message: "Response sent over Bluetooth" });
});

app.post("/bluetooth/receive", adminRateLimit, authorize("admin"), (req, res) => {
  const bt = getBluetooth();
  if (!bt) throw new AppError(503, "BLUETOOTH_UNAVAILABLE", "Bluetooth is not available");
  const payload = validateBluetoothBody(req.body);
  validateIdempotencyKey(payload.idempotencyKey);
  bt.receiveData(payload);
  res.status(202).json({ status: "ok", message: "Bluetooth request accepted" });
});

app.use((req, res, next) => {
  next(new AppError(404, "NOT_FOUND", "Route not found"));
});

app.use((error, req, res, next) => {
  const response = safeOperationError(error, req.requestId || crypto.randomUUID());
  res.status(response.statusCode).json(response.body);
});

function startServer(port = process.env.PORT || 4000) {
  return app.listen(port, () => console.log(`Server running on port ${port}`));
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
