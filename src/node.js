const { readJson, updateJson } = require("./storage");
const { AppError } = require("./errors");
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
    throw new AppError(422, "VALIDATION_ERROR", "Node id is required");
  }

  await updateJson(NODES_FILE, (nodes) => {
    if (nodes.some((existing) => existing.id === node.id)) {
      throw new AppError(409, "NODE_EXISTS", "Node already exists");
    }
    return [...nodes, node];
  });

  return node;
}

async function activateNode(nodeId) {
  if (!nodeId) {
    throw new AppError(422, "VALIDATION_ERROR", "Node id is required");
  }

  let activatedNode = null;
  await updateJson(NODES_FILE, (nodes) => {
    if (!nodes.some((node) => node.id === nodeId)) {
      throw new AppError(404, "NODE_NOT_FOUND", "Node not found");
    }
    return nodes.map((node) => {
      const updated = { ...node, status: node.id === nodeId ? "active" : "inactive" };
      if (updated.id === nodeId) activatedNode = updated;
      return updated;
    });
  });
  return activatedNode;
}

module.exports = {
  listNodes,
  getNodeById,
  getActiveNode,
  registerNode,
  activateNode
};
