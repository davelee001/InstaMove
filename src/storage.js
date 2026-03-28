const fs = require("fs/promises");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function resolveDataPath(relativePath) {
  return path.join(projectRoot, relativePath);
}

async function readJson(relativePath, fallbackValue) {
  try {
    const content = await fs.readFile(resolveDataPath(relativePath), "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (fallbackValue !== undefined) {
      return fallbackValue;
    }

    throw error;
  }
}

async function writeJson(relativePath, data) {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(resolveDataPath(relativePath), content, "utf8");
}

module.exports = {
  readJson,
  writeJson,
  resolveDataPath
};