const { readJson, writeJson } = require("./storage");
const networkConfig = require("../config/network.json");

const NODES_FILE = "data/nodes.json";

function normalizeNodePayload(payload = {}) {
  return {
    id: String(payload.id || "").trim(),
    ip: payload.ip ? String(payload.ip).trim() : null,
    host: payload.host ? String(payload.host).trim() : null,
    pubkey: payload.pubkey ? String(payload.pubkey).trim() : null,
    alias: payload.alias ? String(payload.alias).trim() : null,
    status: payload.status === "active" ? "active" : "inactive"
  };
}

async function listNodes() {
  return readJson(NODES_FILE, []);
}

async function getNodeById(nodeId) {
  const nodes = await listNodes();
  return nodes.find((node) => node.id === nodeId) || null;
}

async function getActiveNode() {
  const nodes = await listNodes();

  return (
    nodes.find((node) => node.id === networkConfig.defaultNode && node.status === "active") ||
    nodes.find((node) => node.status === "active") ||
    nodes[0] ||
    null
  );
}

async function registerNode(payload) {
  const node = normalizeNodePayload(payload);

  if (!node.id) {
    throw new Error("Node id is required");
  }

  const nodes = await listNodes();
  if (nodes.some((existing) => existing.id === node.id)) {
    throw new Error("Node already exists");
  }

  const nextNodes = [...nodes, node];
  await writeJson(NODES_FILE, nextNodes);

  return node;
}

async function activateNode(nodeId) {
  if (!nodeId) {
    throw new Error("Node id is required");
  }

  const nodes = await listNodes();
  const hasNode = nodes.some((node) => node.id === nodeId);

  if (!hasNode) {
    throw new Error("Node not found");
  }

  const nextNodes = nodes.map((node) => ({
    ...node,
    status: node.id === nodeId ? "active" : "inactive"
  }));

  await writeJson(NODES_FILE, nextNodes);
  return nextNodes.find((node) => node.id === nodeId) || null;
}

module.exports = {
  listNodes,
  getNodeById,
  getActiveNode,
  registerNode,
  activateNode
};