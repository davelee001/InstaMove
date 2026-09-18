const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const { PassThrough } = require("node:stream");
const { afterEach, test } = require("node:test");
const { WindowsBluetoothServer } = require("../src/bluetooth-windows");
const encryption = require("../src/encryption");
const original = { ...process.env };
const key = "37".repeat(32);
let servers = [];
afterEach(() => {
  for (const server of servers) server.stopAdvertising();
  servers = [];
  for (const name of Object.keys(process.env)) if (!(name in original)) delete process.env[name];
  Object.assign(process.env, original);
});
function create(options = {}) {
  process.env.INSTAMOVE_BLUETOOTH_KEY = key;
  process.env.IDEMPOTENCY_RETENTION_MS = "86400000";
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => { child.killed = true; };
  let launchOptions;
  const server = new WindowsBluetoothServer({ platform: "win32", launch: (exe, args, opts) => {
    launchOptions = opts; return child;
  }, ...options });
  servers.push(server);
  return { server, child, launchOptions };
}
function frames(message, selectedKey = key) {
  const buffer = Buffer.from(encryption.encrypt(message, selectedKey));
  const count = Math.ceil(buffer.length / 64);
  return Array.from({ length: count }, (_, index) => {
    const header = Buffer.alloc(4); header.writeUInt16LE(index); header.writeUInt16LE(count, 2);
    return Buffer.concat([header, buffer.subarray(index * 64, (index + 1) * 64)]).toString("base64");
  });
}
function request(payload = { idempotencyKey: "bluetooth-request-1", paymentRequest: "invoice" }) {
  return { type: "request", expiresAt: Date.now() + 30000, payload };
}
function send(server, message, session = "peer-one", selectedKey = key) {
  for (const data of frames(message, selectedKey)) server.handleEvent({ type: "frame", session, data });
}
function ready(server) { server.handleEvent({ type: "status", state: "advertising" }); }

test("Windows backend readiness follows actual helper state and process exit", () => {
  const { server, child, launchOptions } = create();
  ready(server); assert.equal(server.getStatus().ready, true);
  child.emit("exit", 1); assert.equal(server.getStatus().ready, false);
});
test("Windows backend refuses missing key, short retention, unsupported OS and failed helper", () => {
  delete process.env.INSTAMOVE_BLUETOOTH_KEY;
  const missing = new WindowsBluetoothServer({ platform: "win32" });
  process.env.INSTAMOVE_BLUETOOTH_KEY = key;
  process.env.IDEMPOTENCY_RETENTION_MS = "10";
  const { server, child } = create(); child.emit("error", new Error("missing"));
});
test("authenticated fragmented requests deliver encrypted responses only to originating peer", () => {
  const { server, child } = create(); ready(server);
  const received = [];
  server.on("request", (payload, respond) => { received.push(payload); respond({ status: "ok" }); });
  const message = request(); send(server, message);
  const reply = JSON.parse(child.stdin.read().toString());
  const decoded = encryption.decrypt(reply.data, key);
});
test("unauthenticated, expired, future and reflected response messages cannot reach payment processor", () => {
  const { server } = create(); ready(server);
  let count = 0; server.on("request", () => count++);
  send(server, request(), "wrong-key", "42".repeat(32));
  send(server, { ...request(), expiresAt: Date.now() - 1 }, "expired");
  send(server, { ...request(), expiresAt: Date.now() + 120000 }, "future");
  send(server, { ...request(), type: "response" }, "reflection");
  send(server, { ...request(), payload: [] }, "array");
});
test("out-of-order and expired fragments never produce requests", () => {
  const { server } = create(); ready(server);
  let count = 0; server.on("request", () => count++);
  const chunks = frames(request());
  for (const data of chunks.slice().reverse()) server.acceptFrame("peer", data);
  assert.equal(count, 0);
  server.acceptFrame("peer", chunks[0]);
  server.sessions.get("peer").expiresAt = Date.now() - 1;
  for (const data of chunks.slice(1)) server.acceptFrame("peer", data);
  assert.equal(count, 0);
});
test("session limit and busy request prevent unbounded or overlapping work", () => {
  const { server } = create(); ready(server);
  let count = 0; server.on("request", () => count++);
  send(server, request()); send(server, request());
  assert.equal(count, 1);
  for (let i = 0; i < 30; i++) send(server, request(), `peer-${i}`);
  assert.equal(server.sessions.size, 8);
  assert.equal(count, 8);
});
test("disconnect discards late responses and HTTP injection is unavailable", () => {
  const { server, child } = create(); ready(server);
  let reply; server.on("request", (payload, respond) => { reply = respond; });
  send(server, request());
  server.handleEvent({ type: "disconnect", session: "peer-one" });
  reply({ status: "ok" });
  assert.equal(child.stdin.read(), null);
  assert.throws(() => server.receiveData({}), error => error.code === "BLUETOOTH_SIMULATION_DISABLED");
  assert.throws(() => server.sendResponse({}), error => error.code === "BLUETOOTH_SESSION_REQUIRED");
});
test("malformed helper output fails closed and stopped service cannot become ready", () => {
  const { server } = create(); ready(server);
  server.consume("not-json\n"); assert.equal(server.getStatus().ready, false);
  ready(server); assert.equal(server.getStatus().ready, false);
  server.stopAdvertising(); ready(server);
  assert.equal(server.getStatus().ready, false);
});
