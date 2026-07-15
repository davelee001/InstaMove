const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "instamove-storage-"));
process.env.INSTAMOVE_DATA_DIR = dataDirectory;

fs.writeFileSync(
  path.join(dataDirectory, "nodes.json"),
  JSON.stringify([{ id: "legacy-node", status: "active" }])
);
fs.writeFileSync(path.join(dataDirectory, "requests.json"), "[]");
fs.writeFileSync(path.join(dataDirectory, "channels.json"), "[]");
fs.writeFileSync(path.join(dataDirectory, "invoices.json"), "[]");

const { closeDatabases, resolveDatabasePath } = require("../src/database");
const { readJson, updateJson, writeCollections, writeJson } = require("../src/storage");

after(() => {
  closeDatabases();
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});

test("legacy JSON collections are imported exactly once", async () => {
  const imported = await readJson("data/nodes.json", []);
  assert.deepEqual(imported, [{ id: "legacy-node", status: "active" }]);
  assert.equal(fs.existsSync(resolveDatabasePath()), true);

  fs.writeFileSync(path.join(dataDirectory, "nodes.json"), JSON.stringify([{ id: "late-edit" }]));
  closeDatabases();
  assert.deepEqual(await readJson("data/nodes.json", []), imported);
});

test("multi-collection writes roll back as one unit", async () => {
  const originalInvoices = [{ id: "invoice-original", status: "created" }];
  const originalRequests = [{ id: "request-original", status: "pending" }];
  await writeCollections({
    "data/invoices.json": originalInvoices,
    "data/requests.json": originalRequests
  });

  await assert.rejects(
    writeCollections({
      "data/invoices.json": [{ id: "invoice-replacement" }],
      "data/requests.json": [{ id: "duplicate" }, { id: "duplicate" }]
    }),
    /UNIQUE constraint failed/
  );

  assert.deepEqual(await readJson("data/invoices.json", []), originalInvoices);
  assert.deepEqual(await readJson("data/requests.json", []), originalRequests);
});

test("transactional updates retain every concurrent change", async () => {
  await writeJson("data/channels.json", []);
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      updateJson("data/channels.json", (channels) => [...channels, { id: `channel-${index}` }])
    )
  );

  const channels = await readJson("data/channels.json", []);
  assert.equal(channels.length, 20);
  assert.equal(new Set(channels.map((channel) => channel.id)).size, 20);
});
