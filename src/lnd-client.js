const fs = require("fs");
const http = require("http");
const https = require("https");
const networkConfig = require("../config/network.json");
const { AppError } = require("./errors");

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getTransportConfig() {
  return {
    timeoutMs: positiveInteger(process.env.LND_REQUEST_TIMEOUT_MS, networkConfig.lndRequestTimeoutMs),
    maxResponseBytes: positiveInteger(process.env.LND_MAX_RESPONSE_BYTES, networkConfig.lndMaxResponseBytes),
    getRetryAttempts: positiveInteger(process.env.LND_GET_RETRY_ATTEMPTS, networkConfig.lndGetRetryAttempts),
    retryDelayMs: positiveInteger(process.env.LND_RETRY_DELAY_MS, networkConfig.lndRetryDelayMs)
  };
}

function readMacaroonHeaderValue(source) {
  if (!source) return null;
  if (fs.existsSync(source)) return fs.readFileSync(source).toString("hex");
  return String(source).replace(/^0x/i, "");
}

function requestJson(urlString, { method = "GET", headers = {}, body, timeoutMs, maxResponseBytes } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      reject(new AppError(500, "INVALID_LND_URL", "The configured LND REST URL is invalid"));
      return;
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      reject(new AppError(500, "INVALID_LND_URL", "The configured LND REST URL must use HTTP or HTTPS"));
      return;
    }

    const transport = url.protocol === "http:" ? http : https;
    const request = transport.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        headers,
        rejectUnauthorized: process.env.LND_ALLOW_INSECURE !== "true"
      },
      (response) => {
        const chunks = [];
        let receivedBytes = 0;

        response.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maxResponseBytes) {
            response.destroy(new AppError(502, "LND_RESPONSE_TOO_LARGE", "The Lightning service returned an oversized response"));
            return;
          }
          chunks.push(chunk);
        });

        response.on("error", reject);
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode >= 400) {
            reject(new AppError(502, "LND_HTTP_ERROR", "The Lightning service rejected the request", {
              upstreamStatus: response.statusCode
            }));
            return;
          }

          if (!responseBody) {
            resolve({});
            return;
          }

          try {
            resolve(JSON.parse(responseBody));
          } catch {
            reject(new AppError(502, "LND_INVALID_RESPONSE", "The Lightning service returned invalid JSON"));
          }
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new AppError(504, "LND_TIMEOUT", "The Lightning service did not respond in time"));
    });
    request.on("error", (error) => {
      if (error instanceof AppError) reject(error);
      else reject(new AppError(502, "LND_UNAVAILABLE", "The Lightning service is unavailable"));
    });

    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRetriable(error) {
  return ["LND_TIMEOUT", "LND_UNAVAILABLE", "LND_HTTP_ERROR"].includes(error?.code);
}

async function callLnd(pathname, options = {}) {
  const baseUrl = process.env.LND_REST_URL;
  const macaroon = readMacaroonHeaderValue(process.env.LND_MACAROON);
  if (!baseUrl || !macaroon) {
    throw new AppError(503, "LND_NOT_CONFIGURED", "LND REST access is not configured");
  }

  const method = String(options.method || "GET").toUpperCase();
  const transportConfig = getTransportConfig();
  const attempts = method === "GET" ? transportConfig.getRetryAttempts : 1;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestJson(`${baseUrl.replace(/\/$/, "")}${pathname}`, {
        method,
        headers: {
          "Grpc-Metadata-macaroon": macaroon,
          "Content-Type": "application/json",
          ...(options.headers || {})
        },
        body: options.body,
        timeoutMs: transportConfig.timeoutMs,
        maxResponseBytes: transportConfig.maxResponseBytes
      });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetriable(error)) throw error;
      await wait(transportConfig.retryDelayMs * attempt);
    }
  }

  throw lastError;
}

module.exports = { callLnd, getTransportConfig, readMacaroonHeaderValue, requestJson };
