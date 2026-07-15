const assert = require("node:assert/strict");
const http = require("node:http");
const { afterEach, test } = require("node:test");
const { callLnd, requestJson } = require("../src/lnd-client");

const environmentNames = [
  "LND_REST_URL",
  "LND_MACAROON",
  "LND_REQUEST_TIMEOUT_MS",
  "LND_MAX_RESPONSE_BYTES",
  "LND_GET_RETRY_ATTEMPTS",
  "LND_RETRY_DELAY_MS"
];
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function startServer(handler) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`
  };
}

async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

test("LND requests time out with a typed error", async () => {
  const { server, url } = await startServer(() => {});
  try {
    await assert.rejects(
      () => requestJson(url, { timeoutMs: 20, maxResponseBytes: 1024 }),
      (error) => error.code === "LND_TIMEOUT" && error.statusCode === 504
    );
  } finally {
    await closeServer(server);
  }
});

test("oversized LND responses are rejected", async () => {
  const { server, url } = await startServer((req, res) => {
    res.end(JSON.stringify({ value: "x".repeat(256) }));
  });
  try {
    await assert.rejects(
      () => requestJson(url, { timeoutMs: 1000, maxResponseBytes: 32 }),
      (error) => error.code === "LND_RESPONSE_TOO_LARGE" && error.statusCode === 502
    );
  } finally {
    await closeServer(server);
  }
});

test("invalid LND JSON is rejected", async () => {
  const { server, url } = await startServer((req, res) => res.end("not-json"));
  try {
    await assert.rejects(
      () => requestJson(url, { timeoutMs: 1000, maxResponseBytes: 1024 }),
      (error) => error.code === "LND_INVALID_RESPONSE"
    );
  } finally {
    await closeServer(server);
  }
});

test("safe LND GET requests retry transient failures", async () => {
  let requests = 0;
  const { server, url } = await startServer((req, res) => {
    requests += 1;
    res.setHeader("Content-Type", "application/json");
    if (requests === 1) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "temporary" }));
      return;
    }
    res.end(JSON.stringify({ alias: "node" }));
  });

  try {
    process.env.LND_REST_URL = url;
    process.env.LND_MACAROON = "00ff";
    process.env.LND_GET_RETRY_ATTEMPTS = "3";
    process.env.LND_RETRY_DELAY_MS = "1";
    const response = await callLnd("/v1/getinfo");

    assert.equal(response.alias, "node");
    assert.equal(requests, 2);
  } finally {
    await closeServer(server);
  }
});

test("LND POST requests are never retried", async () => {
  let requests = 0;
  const { server, url } = await startServer((req, res) => {
    requests += 1;
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "do not replay this payment", secret: "upstream-detail" }));
  });

  try {
    process.env.LND_REST_URL = url;
    process.env.LND_MACAROON = "00ff";
    process.env.LND_GET_RETRY_ATTEMPTS = "5";
    await assert.rejects(
      () => callLnd("/v1/channels/transactions", { method: "POST", body: { payment_request: "invoice" } }),
      (error) => {
        assert.equal(error.code, "LND_HTTP_ERROR");
        assert.equal(error.message.includes("upstream-detail"), false);
        return true;
      }
    );
    assert.equal(requests, 1);
  } finally {
    await closeServer(server);
  }
});
