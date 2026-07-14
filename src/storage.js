const fs = require("fs/promises");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const writeQueues = new Map();

function resolveDataPath(relativePath) {
  if (process.env.INSTAMOVE_DATA_DIR && relativePath.replace(/\\/g, "/").startsWith("data/")) {
    return path.join(path.resolve(process.env.INSTAMOVE_DATA_DIR), relativePath.replace(/\\/g, "/").slice(5));
  }
  return path.join(projectRoot, relativePath);
}

async function readJson(relativePath, fallbackValue) {
  try {
    const content = await fs.readFile(resolveDataPath(relativePath), "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (fallbackValue !== undefined && error.code === "ENOENT") {
      return fallbackValue;
    }

    throw error;
  }
}

async function writeJson(relativePath, data) {
  const targetPath = resolveDataPath(relativePath);
  const previous = writeQueues.get(targetPath) || Promise.resolve();
  const operation = previous.then(async () => {
    const content = `${JSON.stringify(data, null, 2)}\n`;
    const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(temporaryPath, content, "utf8");
    await fs.rename(temporaryPath, targetPath);
  });

  writeQueues.set(targetPath, operation.catch(() => {}));
  return operation;
}

module.exports = {
  readJson,
  writeJson,
  resolveDataPath
};
