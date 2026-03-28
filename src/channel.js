const lightning = require("./lightning");

async function create(data) {
  return lightning.ensureChannel({
    nodeId: data.nodeId || null,
    nodeIp: data.nodeIp || null,
    target: data.domain || data.address || null,
    requestId: data.requestId || null,
    fundingAmount: data.fundingAmount || null
  });
}

module.exports = { create };
