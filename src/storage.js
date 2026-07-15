const fs = require("node:fs");
const path = require("path");
const { getDatabase, withImmediateTransaction } = require("./database");

const projectRoot = path.resolve(__dirname, "..");
const COLLECTION_PATTERN = /^data\/([a-z][a-z0-9-]*)\.json$/;
const LEGACY_COLLECTIONS = ["nodes", "requests", "channels", "invoices"];

function resolveDataPath(relativePath) {
  if (process.env.INSTAMOVE_DATA_DIR && relativePath.replace(/\\/g, "/").startsWith("data/")) {
    return path.join(path.resolve(process.env.INSTAMOVE_DATA_DIR), relativePath.replace(/\\/g, "/").slice(5));
  }
  return path.join(projectRoot, relativePath);
}

function collectionName(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const match = normalized.match(COLLECTION_PATTERN);
  if (!match || match[1] === "idempotency") {
    throw new TypeError(`Unsupported persisted collection: ${relativePath}`);
  }
  return match[1];
}

function documentId(document, position) {
  const explicitId = document && typeof document === "object" ? document.id : null;
  return explicitId === undefined || explicitId === null || explicitId === ""
    ? `position:${position}`
    : `id:${String(explicitId)}`;
}

function replaceCollection(database, collection, documents, updatedAt) {
  if (!Array.isArray(documents)) {
    throw new TypeError(`Collection ${collection} must be an array`);
  }

  const remove = database.prepare("DELETE FROM documents WHERE collection = ?");
  const insert = database.prepare(`
    INSERT INTO documents (collection, document_id, position, document_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  remove.run(collection);
  documents.forEach((document, position) => {
    insert.run(collection, documentId(document, position), position, JSON.stringify(document), updatedAt);
  });
}

function importLegacyCollections(database) {
  const imported = database.prepare("SELECT value FROM schema_metadata WHERE key = ?").get("legacy_json_imported");
  if (imported) return;

  withImmediateTransaction((transaction) => {
    const updatedAt = new Date().toISOString();
    for (const collection of LEGACY_COLLECTIONS) {
      const legacyPath = resolveDataPath(`data/${collection}.json`);
      if (!fs.existsSync(legacyPath)) continue;
      const documents = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
      replaceCollection(transaction, collection, documents, updatedAt);
    }
    transaction.prepare("INSERT INTO schema_metadata (key, value) VALUES (?, ?)")
      .run("legacy_json_imported", updatedAt);
  }, database);
}

function databaseWithImportedData() {
  const database = getDatabase();
  importLegacyCollections(database);
  return database;
}

function readCollection(database, collection) {
  return database.prepare(`
    SELECT document_json
    FROM documents
    WHERE collection = ?
    ORDER BY position ASC
  `).all(collection).map((row) => JSON.parse(row.document_json));
}

async function readJson(relativePath, fallbackValue) {
  const collection = collectionName(relativePath);
  const database = databaseWithImportedData();
  const documents = readCollection(database, collection);

  if (documents.length === 0) return fallbackValue === undefined ? [] : fallbackValue;
  return documents;
}

async function writeJson(relativePath, data) {
  return writeCollections({ [relativePath]: data });
}

async function writeCollections(collections) {
  const database = databaseWithImportedData();
  const entries = Object.entries(collections).map(([relativePath, documents]) => [
    collectionName(relativePath),
    documents
  ]);

  withImmediateTransaction((transaction) => {
    const updatedAt = new Date().toISOString();
    for (const [collection, documents] of entries) {
      replaceCollection(transaction, collection, documents, updatedAt);
    }
  }, database);
}

async function updateCollections(relativePaths, update) {
  const database = databaseWithImportedData();
  const collections = relativePaths.map((relativePath) => [relativePath, collectionName(relativePath)]);

  return withImmediateTransaction((transaction) => {
    const current = Object.fromEntries(
      collections.map(([relativePath, collection]) => [relativePath, readCollection(transaction, collection)])
    );
    const next = update(current);
    if (!next || typeof next !== "object") {
      throw new TypeError("Collection update must return an object keyed by collection path");
    }

    const updatedAt = new Date().toISOString();
    for (const [relativePath, collection] of collections) {
      if (!Object.hasOwn(next, relativePath)) {
        throw new TypeError(`Collection update omitted ${relativePath}`);
      }
      replaceCollection(transaction, collection, next[relativePath], updatedAt);
    }
    return next;
  }, database);
}

async function updateJson(relativePath, update) {
  const next = await updateCollections([relativePath], (collections) => ({
    [relativePath]: update(collections[relativePath])
  }));
  return next[relativePath];
}

module.exports = {
  readJson,
  updateCollections,
  updateJson,
  writeJson,
  writeCollections,
  resolveDataPath
};
