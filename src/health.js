const packageInfo = require("../package.json");
const { getAuthConfiguration } = require("./auth");
const lightning = require("./lightning");
const nodeService = require("./node");
const { getBluetooth } = require("./bluetooth");
const { getDatabase } = require("./database");
const { callLnd } = require("./lnd-client");

// Share concurrent probes, but never reuse an old healthy result after completion.
let probe;
let probeKey;
async function checkLightningNode(mode) {
  if (mode === "mock") return { reachable: true, healthy: true };
  const configured = Number(process.env.LND_READINESS_TIMEOUT_MS || 2000);
  const timeoutMs = Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 10000) : 2000;
  const key = JSON.stringify([mode, process.env.LND_REST_URL, process.env.LND_MACAROON, timeoutMs]);
  if (probe && probeKey === key) return probe;
  probeKey = key;
  const pending = (async () => {
    try {
      const info = await callLnd("/v1/getinfo", { timeoutMs, getRetryAttempts: 1 });
      const valid = info && typeof info === "object" && !Array.isArray(info) &&
        typeof info.identity_pubkey === "string" && /^(02|03)[0-9a-f]{64}$/i.test(info.identity_pubkey);
      const networkValid = Array.isArray(info?.chains) && info.chains.some(chain =>
        chain?.chain === "bitcoin" && (mode !== "regtest" || chain.network === "regtest"));
      return { reachable: Boolean(valid), healthy: Boolean(valid && networkValid &&
        info.synced_to_chain === true && info.synced_to_graph === true) };
    } catch {
      return { reachable: false, healthy: false };
    }
  })();
  probe = pending;
  try { return await pending; }
  finally { if (probe === pending) { probe = null; probeKey = null; } }
}

function getLiveness() {
  return {
    status: "ok",
    service: packageInfo.name,
    version: packageInfo.version,
    uptimeSeconds: Math.floor(process.uptime())
  };
}

async function getReadiness() {
  const auth = getAuthConfiguration();
  const checks = {
    lightningConfiguration: false,
    lightningReachable: false,
    lightningHealthy: false,
    storage: false,
    paymentAuthentication: auth.rolesAreDistinct && (auth.paymentConfigured || auth.adminConfigured),
    adminAuthentication: auth.rolesAreDistinct && auth.adminConfigured,
    bluetooth: Boolean(getBluetooth()?.getStatus().ready)
  };
  let mode = "unknown";

  try {
    mode = lightning.assertConfiguration();
    checks.lightningConfiguration = true;
    if (mode !== "mock" && getBluetooth()?.getStatus().mode === "simulated") checks.bluetooth = false;
    const node = await checkLightningNode(mode);
    checks.lightningReachable = node.reachable;
    checks.lightningHealthy = node.healthy;
  } catch {
    checks.lightningConfiguration = false;
  }

  try {
    getDatabase().prepare("SELECT 1 AS healthy").get();
    await nodeService.listNodes();
    checks.storage = true;
  } catch {
    checks.storage = false;
  }

  // Re-read after the asynchronous LND probe: the radio/helper may have stopped.
  const bluetooth = getBluetooth()?.getStatus();
  checks.bluetooth = Boolean(bluetooth?.ready && (mode === "mock" || bluetooth.mode !== "simulated"));
  const ready = Object.values(checks).every(Boolean);
  return {
    status: ready ? "ready" : "not_ready",
    mode,
    checks
  };
}

module.exports = { getLiveness, getReadiness, checkLightningNode };
