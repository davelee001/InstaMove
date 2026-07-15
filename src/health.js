const packageInfo = require("../package.json");
const { getAuthConfiguration } = require("./auth");
const lightning = require("./lightning");
const nodeService = require("./node");
const { getBluetooth } = require("./bluetooth");
const { getDatabase } = require("./database");

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
    storage: false,
    paymentAuthentication: auth.rolesAreDistinct && (auth.paymentConfigured || auth.adminConfigured),
    adminAuthentication: auth.rolesAreDistinct && auth.adminConfigured,
    bluetooth: Boolean(getBluetooth())
  };
  let mode = "unknown";

  try {
    mode = lightning.assertConfiguration();
    checks.lightningConfiguration = true;
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

  const ready = Object.values(checks).every(Boolean);
  return {
    status: ready ? "ready" : "not_ready",
    mode,
    checks
  };
}

module.exports = { getLiveness, getReadiness };
