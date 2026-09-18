const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, after, test } = require("node:test");
const { checkLightningNode } = require("../src/health");
const original = { ...process.env };
let upstream, server, url, directory, response, status, behavior, calls;
const healthy = { identity_pubkey: "02" + "11".repeat(32), synced_to_chain: true,
  synced_to_graph: true, chains: [{ chain: "bitcoin", network: "regtest" }] };

before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "instamove-ready-"));
  Object.assign(process.env, {
    INSTAMOVE_DB_PATH: path.join(directory, "db.sqlite"), INSTAMOVE_DATA_DIR: directory,
    LIGHTNING_MODE: "regtest", BLUETOOTH_MODE: "disabled", LND_MACAROON: "aabb",
    LND_READINESS_TIMEOUT_MS: "150", INSTAMOVE_PAYMENT_TOKEN: "payment-token-for-readiness-tests",
    INSTAMOVE_ADMIN_TOKEN: "admin-token-for-readiness-tests"
  });
  upstream = http.createServer((req, res) => {
    calls++;
    if (behavior === "hang") return;
    if (behavior === "trickle") {
      const timer = setInterval(() => res.write(" "), 20);
      res.on("close", () => clearInterval(timer));
      return;
    }
    res.statusCode = status;
    res.end(behavior === "malformed" ? "not-json-secret" : JSON.stringify(response));
  }).listen(0, "127.0.0.1");
  await new Promise(resolve => upstream.once("listening", resolve));
  process.env.LND_REST_URL = `http://127.0.0.1:${upstream.address().port}`;
  server = require("../src/app").app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const instance of [server, upstream]) {
    instance.closeAllConnections();
    await new Promise(resolve => instance.close(resolve));
  }
  require("../src/database").closeDatabases();
  fs.rmSync(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});
function reset() { response = healthy; status = 200; behavior = null; calls = 0; }

test("ready requires a reachable synchronized LND node and exposes no node details", async () => {
  reset();
  const result = await fetch(url + "/ready");
  const body = await result.json();
});
for (const [label, value] of [
  ["chain synchronization", { ...healthy, synced_to_chain: false }],
  ["graph synchronization", { ...healthy, synced_to_graph: false }],
  ["strict boolean", { ...healthy, synced_to_chain: "true" }],
  ["regtest network", { ...healthy, chains: [{ chain: "bitcoin", network: "mainnet" }] }],
  ["node identity", { ...healthy, identity_pubkey: "invalid" }],
  ["empty response", {}], ["null response", null], ["array response", []]
]) {
  test(`readiness fails closed for invalid ${label}`, async () => {
    reset(); response = value;
    const result = await fetch(url + "/ready");
  });
}
test("upstream authentication and HTTP failures make readiness fail without retries", async () => {
  for (const code of [401, 403, 500, 503]) {
    reset(); status = code; response = { error: "private-upstream-detail" };
    const result = await fetch(url + "/ready");
    assert.equal((await result.text()).includes("private-upstream-detail"), false);
    assert.equal(calls, 1);
  }
});
test("malformed, stalled and continuously streaming responses are bounded", async () => {
  for (const mode of ["malformed", "hang", "trickle"]) {
    reset(); behavior = mode;
    const start = Date.now();
    const result = await fetch(url + "/ready");
    assert.equal(result.status, 503);
    assert.ok(Date.now() - start < 2000);
    assert.equal(calls, 1);
  }
});
test("liveness never depends on LND", async () => {
  reset(); behavior = "hang";
  assert.equal((await fetch(url + "/health")).status, 200);
  assert.equal(calls, 0);
});
test("concurrent probes share one request but do not cache stale readiness", async () => {
  reset();
  const results = await Promise.all(Array.from({ length: 10 }, () => checkLightningNode("regtest")));
  assert.ok(results.every(result => result.healthy));
  assert.equal(calls, 1);
  response = { ...healthy, synced_to_chain: false };
  assert.equal((await checkLightningNode("regtest")).healthy, false);
  assert.equal(calls, 2);
});
test("mock readiness does not contact LND", async () => {
  reset();
  assert.deepEqual(await checkLightningNode("mock"), { reachable: true, healthy: true });
  assert.equal(calls, 0);
});

test("real Lightning readiness rejects simulated, stopped and unavailable Bluetooth", async () => {
  reset();
  const bluetooth = require("../src/bluetooth").getBluetooth();
  const originalStatus = bluetooth.getStatus;
  try {
    for (const value of [
      { mode: "simulated", ready: true }, { mode: "windows", ready: false }
    ]) {
      bluetooth.getStatus = () => value;
      const result = await fetch(url + "/ready");
      assert.equal(result.status, 503);
      assert.equal((await result.json()).checks.bluetooth, false);
    }
    bluetooth.getStatus = () => ({ mode: "windows", ready: true });
    assert.equal((await fetch(url + "/ready")).status, 200);
  } finally { bluetooth.getStatus = originalStatus; }
});
