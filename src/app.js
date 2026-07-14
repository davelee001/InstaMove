const crypto = require("crypto");
const express = require("express");
const processor = require("./processor");
const nodeService = require("./node");
const lightning = require("./lightning");
const { initBluetooth, getBluetooth } = require("./bluetooth");
const { authorize } = require("./auth");
const { AppError, normalizeError, toErrorResponse } = require("./errors");
const idempotency = require("./idempotency");
const { createAdminRateLimiter, createPaymentRateLimiter } = require("./rate-limit");
const {
  validateBluetoothBody,
  validateIdempotencyKey,
  validateNodeBody,
  validateNodeId,
  validateRequestBody
} = require("./validation");

lightning.assertConfiguration();

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const suppliedRequestId = req.get("x-request-id");
  req.requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId || "")
    ? suppliedRequestId
    : crypto.randomUUID();
  res.set("X-Request-Id", req.requestId);
  next();
});
app.use(express.json({ limit: "32kb", strict: true }));

const paymentRateLimit = createPaymentRateLimiter();
const adminRateLimit = createAdminRateLimiter();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function safeOperationError(error, requestId) {
  const normalized = normalizeError(error);
  if (normalized.statusCode === 500) {
    console.error(`[${requestId}] internal request failure (${error?.name || "Error"})`);
  }
  return toErrorResponse(normalized, requestId);
}

function logJsonResponse(source, payload) {
  console.log(`[${source}] response:`);
  console.log(JSON.stringify(payload, null, 2));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLandingPage({ activeNode, nodeCount, bluetoothStatus }) {
  const currentMode = lightning.getMode();
  const modeLabel = currentMode === "regtest" ? "Regtest" : currentMode === "lnd" ? "LND" : "Mock";
  const activeNodeLabel = activeNode ? `${escapeHtml(activeNode.id)}${activeNode.ip ? ` • ${escapeHtml(activeNode.ip)}` : ""}` : "No active node";
  const bluetoothMode = bluetoothStatus ? escapeHtml(bluetoothStatus.mode) : "unknown";
  const bluetoothState = bluetoothStatus ? (bluetoothStatus.advertising ? "Advertising" : "Idle") : "Unavailable";

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>InstaMove</title>
        <style>
          :root {
            color-scheme: dark;
            --bg: #07111f;
            --bg-soft: rgba(11, 20, 35, 0.88);
            --panel: rgba(15, 25, 44, 0.92);
            --panel-border: rgba(148, 163, 184, 0.16);
            --text: #e5eefc;
            --muted: #94a3b8;
            --accent: #f59e0b;
            --accent-2: #38bdf8;
            --good: #22c55e;
            --warn: #f97316;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 0;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            color: var(--text);
            background:
              radial-gradient(circle at top left, rgba(56, 189, 248, 0.22), transparent 32%),
              radial-gradient(circle at top right, rgba(245, 158, 11, 0.18), transparent 30%),
              linear-gradient(135deg, #030712, var(--bg));
          }
          .shell {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            gap: 0;
            padding: 0;
          }
          .hero {
            flex: 0 0 auto;
            display: grid;
            grid-template-columns: 1fr 340px;
            gap: 12px;
            padding: 12px;
          }
          .panel {
            background: var(--panel);
            border: 1px solid var(--panel-border);
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(18px);
            animation: panelEntrance 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
          }
          @keyframes panelEntrance {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .hero-main {
            padding: 16px 20px;
            animation-delay: 0.1s;
          }
          .hero-side {
            animation-delay: 0.2s;
          }
          .tx-panel {
            animation-delay: 0.3s;
          }
          .activity-panel {
            animation-delay: 0.4s;
          }
          .hero-main {
            padding: 16px 20px;
          }
          .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            border-radius: 999px;
            background: rgba(245, 158, 11, 0.12);
            color: #fcd34d;
            font-size: 0.82rem;
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }
          .eyebrow-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--good);
            box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.16);
          }
          h1 {
            margin: 12px 0 8px;
            font-size: clamp(1.5rem, 3vw, 2.4rem);
            line-height: 1.1;
            letter-spacing: -0.04em;
          }
          .lede {
            max-width: 70ch;
            margin: 0;
            color: var(--muted);
            font-size: 0.9rem;
            line-height: 1.5;
          }
          .chips {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 16px;
          }
          .chip {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 14px;
            border-radius: 999px;
            background: rgba(148, 163, 184, 0.08);
            color: #dbeafe;
            font-size: 0.75rem;
            border: 1px solid rgba(148, 163, 184, 0.14);
          }
          .chip strong {
            color: #fff;
          }
          .hero-side {
            padding: 16px;
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
            align-items: stretch;
          }
          .metric-inline {
            padding: 12px 14px;
            border-radius: 12px;
            background: rgba(3, 7, 18, 0.28);
            border: 1px solid rgba(148, 163, 184, 0.12);
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            white-space: nowrap;
          }
          .metric-label {
            color: var(--muted);
            font-size: 0.75rem;
          }
          .metric-value {
            font-size: 0.85rem;
            font-weight: 700;
          }
          .progress-container {
            width: 100%;
            height: 4px;
            background: rgba(148, 163, 184, 0.1);
            border-radius: 2px;
            overflow: hidden;
            margin-top: 8px;
            display: none;
          }
          .progress-bar {
            width: 0%;
            height: 100%;
            background: var(--accent);
            transition: width 0.3s ease;
          }
          .tx-panel {
            flex: 1;
            margin: 0 12px 12px 12px;
            padding: 20px 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            min-height: 0;
            overflow: hidden;
          }
          .form-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 12px;
          }
          .field {
            display: grid;
            gap: 8px;
          }
          .field label {
            font-size: 0.82rem;
            color: var(--muted);
          }
          .field input {
            width: 100%;
            border-radius: 14px;
            border: 1px solid rgba(148, 163, 184, 0.16);
            background: rgba(2, 6, 23, 0.72);
            color: var(--text);
            padding: 16px 18px;
            font-size: 1.08rem;
            outline: none;
          }
          .field input:focus {
            border-color: rgba(56, 189, 248, 0.7);
            box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
          }
          .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
          }
          .button {
            border: 0;
            border-radius: 14px;
            padding: 14px 24px;
            background: linear-gradient(135deg, #f59e0b, #f97316);
            color: #fff;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 14px 30px rgba(245, 158, 11, 0.18);
            transition: transform 0.2s;
          }
          .button:active {
            transform: scale(0.98);
          }
          .copy-btn {
            background: rgba(148, 163, 184, 0.12);
            color: #dbeafe;
            border: 1px solid rgba(148, 163, 184, 0.14);
            border-radius: 6px;
            padding: 2px 8px;
            font-size: 0.7rem;
            cursor: pointer;
            margin-left: 8px;
            transition: all 0.2s;
          }
          .copy-btn:hover { background: rgba(148, 163, 184, 0.2); }
          .helper {
            color: var(--muted);
            font-size: 0.8rem;
          }
          .response-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 0;
          }
          .response-box {
            flex: 1;
            margin: 0;
            padding: 16px;
            border-radius: 12px;
            overflow: auto;
            background: #020617;
            color: #86efac;
            border: 1px solid rgba(148, 163, 184, 0.14);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            font-size: 0.85rem;
            line-height: 1.4;
          }
          .footer {
            flex: 0 0 auto;
            display: flex;
            justify-content: space-between;
            padding: 12px 24px;
            color: var(--muted);
            font-size: 0.75rem;
            background: rgba(3, 7, 18, 0.4);
            border-top: 1px solid var(--panel-border);
          }
          .status-good {
            color: #86efac;
          }
          .toast {
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: rgba(14, 165, 233, 0.9);
            color: white;
            padding: 12px 24px;
            border-radius: 12px;
            font-weight: 600;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(8px);
            z-index: 1000;
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          }
          .toast.show {
            opacity: 1;
            visibility: visible;
            transform: translateX(-50%) translateY(0);
          }
          .toast.success { 
            background: rgba(245, 158, 11, 0.95); 
            border-left: 4px solid #22c55e;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .toast.success::before {
            content: "✓";
            color: #22c55e;
            font-size: 1.2rem;
            font-weight: 900;
          }
          .toast.error { background: rgba(239, 68, 68, 0.95); }
          .status-warn {
            color: #fdba74;
          }
          @media (max-width: 980px) {
            .hero {
              grid-template-columns: 1fr;
              max-width: 100%;
            }
            .tx-panel {
              padding: 24px;
              max-width: 100%;
            }
            .footer {
              flex-direction: column;
              align-items: flex-start;
            }
          }
          @media (min-width: 981px) {
            .hero {
              align-items: start;
            }
            .hero-main {
              min-height: 0;
            }
            .hero-side {
              align-content: stretch;
            }
          }
        </style>
      </head>
      <body>
        <div id="toast" class="toast"></div>
        <main class="shell">
          <section class="hero">
            <div class="panel hero-main">
              <div class="eyebrow"><span class="eyebrow-dot"></span> InstaMove Lightning Node Test Hub</div>
              <h1>Send and settle transactions over Bluetooth.</h1>
              <p class="lede">InstaMove is designed for paying bitcoin using Bluetooth, creating invoices, settlement verification, and JSON exchange. It supports regtest first development, which enables you to complete your payment without internet access.</p>
              <div class="chips">
                <span class="chip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <strong>Mode:</strong> ${escapeHtml(modeLabel)}
                </span>
                <span class="chip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                  <strong>Nodes:</strong> ${escapeHtml(nodeCount)}
                </span>
                <span class="chip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m7 7 10 10-5 5V2l5 5L7 17"/></svg>
                  <strong>Bluetooth:</strong> ${escapeHtml(bluetoothState)}
                </span>
                <span class="chip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  <strong>Bluetooth Mode:</strong> ${bluetoothMode}
                </span>
                <span class="chip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M12 20h.01"/></svg>
                  <strong>Connectivity:</strong> Without internet
                </span>
              </div>
            </div>

            <aside class="panel hero-side">
              <div class="metric-inline">
                <span class="metric-label">Active Node</span>
                <span class="metric-value">${activeNodeLabel}</span>
              </div>
              <div class="metric-inline">
                <span class="metric-label">Transaction Status</span>
                <span class="metric-value ${bluetoothStatus ? "status-good" : "status-warn"}">${bluetoothStatus ? "Ready to process" : "Bluetooth offline"}</span>
              </div>
              <div class="metric-inline">
                <span class="metric-label">Current Flow</span>
                <span class="metric-value">Request → Invoice → Settlement</span>
              </div>
              <div class="metric-inline">
                <span class="metric-label">Connected Peers</span>
                <span class="metric-value status-good" id="peer-count">6 active nodes</span>
              </div>
              <div class="metric-inline" style="flex-direction: column; align-items: flex-start; gap: 8px;">
                <span class="metric-label">Node Management</span>
                <div style="display: flex; gap: 6px; width: 100%;">
                  <button class="button" style="flex: 1; padding: 6px 10px; font-size: 0.7rem;" onclick="location.reload()">Refresh Nodes</button>
                  <button class="button" id="toggleNodes" style="flex: 1; padding: 6px 10px; font-size: 0.7rem; background: rgba(148, 163, 184, 0.12); color: #dbeafe;">Switch Node</button>
                </div>
              </div>
            </aside>
          </section>

          <section class="panel tx-panel" id="transaction-panel">
            <div style="flex: 0 0 auto;">
              <h2 style="margin: 0 0 4px; font-size: 1.2rem;">Run a transaction</h2>
            </div>
            <form id="transaction-form" style="flex: 0 0 auto;">
              <div class="form-grid">
                <div class="field">
                  <label for="paymentRequest">Invoice</label>
                  <input id="paymentRequest" name="paymentRequest" placeholder="lnbcrt10000u1instamove..." value="" required autofocus />
                </div>
                <div class="field">
                  <label for="accessToken">Payment access token</label>
                  <input id="accessToken" name="accessToken" type="password" autocomplete="current-password" required />
                </div>
              </div>
              <div class="actions" style="margin-top: 14px; flex-direction: column; align-items: stretch; gap: 4px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                  <button class="button" id="payButton" type="submit">Pay Invoice</button>
                  <span class="helper" id="formHint"></span>
                </div>
                <div id="settleProgress" class="progress-container">
                  <div id="settleBar" class="progress-bar"></div>
                </div>
              </div>
            </form>
            <div class="response-container">
              <h2 style="margin: 0 0 4px; font-size: 1rem;">Live response</h2>
              <pre class="response-box" id="responseOutput">{
  "status": "waiting",
  "message": "Submit the form to see the invoice confirmation."
}</pre>
            </div>
          </section>

          <section class="panel activity-panel" style="margin: 0 12px 12px 12px; padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; min-height: 140px; overflow: hidden; max-height: 200px;">
            <h2 style="margin: 0; font-size: 0.9rem; color: var(--muted); display: flex; justify-content: space-between; align-items: center;">
              <span>Activity History</span>
              <span style="font-size: 0.7rem; font-weight: normal; opacity: 0.6;">Simulated local log</span>
            </h2>
            <div id="historyList" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; font-size: 0.75rem;">
              <div style="color: var(--muted); font-style: italic; text-align: center; margin-top: 10px;">No recent activity</div>
            </div>
          </section>

          <div class="footer">
            <span id="uptime">Loading dashboard...</span>
            <span class="status-good">Bluetooth-first, regtest-ready, without internet</span>
          </div>
          <script>
            const form = document.getElementById("transaction-form");
            const output = document.getElementById("responseOutput");
            const hint = document.getElementById("formHint");
            const toast = document.getElementById("toast");
            const toggleNodes = document.getElementById("toggleNodes");
            const historyList = document.getElementById("historyList");
            const settleProgress = document.getElementById("settleProgress");
            const settleBar = document.getElementById("settleBar");
            const payButton = document.getElementById("payButton");
            const uptimeDisplay = document.getElementById("uptime");
            const accessTokenInput = document.getElementById("accessToken");
            const startTime = Date.now();
            let pendingPayment = null;

            function updateUptime() {
              const seconds = Math.floor((Date.now() - startTime) / 1000);
              const m = Math.floor(seconds / 60);
              const s = seconds % 60;
              uptimeDisplay.textContent = "Dashboard Uptime: " + (m > 0 ? m + "m " : "") + s + "s";
            }
            setInterval(updateUptime, 1000);
            updateUptime();

            function addToHistory(message, type = "info") {
              const item = document.createElement("div");
              const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const color = type === "success" ? "#22c55e" : (type === "error" ? "#ef4444" : "#94a3b8");
              
              if (historyList.children.length === 1 && historyList.children[0].style.fontStyle === "italic") {
                historyList.innerHTML = "";
              }

              item.style.padding = "4px 8px";
              item.style.borderLeft = "2px solid " + color;
              item.style.background = "rgba(148, 163, 184, 0.04)";
              item.style.borderRadius = "4px";
              item.innerHTML = "<span style='opacity: 0.5; margin-right: 8px;'>" + time + "</span> " + message;
              
              historyList.prepend(item);
              if (historyList.children.length > 3) historyList.lastElementChild.remove();
            }

            toggleNodes.addEventListener("click", () => {
              showToast("Switching node (simulated)...", "success");
              setTimeout(() => location.reload(), 1500);
            });

            function showToast(message, type = "success") {
              toast.textContent = message;
              toast.className = "toast show " + type;
              setTimeout(() => {
                toast.className = "toast " + type;
              }, 4000);
            }
            const paymentRequestInput = document.getElementById("paymentRequest");

            paymentRequestInput.addEventListener("input", () => {
              if (!paymentRequestInput.value.trim()) {
                hint.textContent = "";
              }
            });

            function renderJson(data) {
              output.textContent = JSON.stringify(data, null, 2);
            }

            form.addEventListener("submit", async (event) => {
              event.preventDefault();
              
              const val = paymentRequestInput.value.trim();
              if (!val) return;

              payButton.disabled = true;
              settleProgress.style.display = "block";
              settleBar.style.width = "40%";
              
              hint.style.color = "";
              hint.textContent = "Validating invoice...";

              const body = {
                paymentRequest: val
              };
              const idempotencyKey = pendingPayment && pendingPayment.invoice === val
                ? pendingPayment.key
                : crypto.randomUUID();
              pendingPayment = { invoice: val, key: idempotencyKey };

              try {
                // Simulation of short latency
                await new Promise(r => setTimeout(r, 600));
                settleBar.style.width = "75%";
                hint.textContent = "Submitting Lightning payment...";

                const response = await fetch("/request", {
                  method: "POST",
                  headers: {
                    "Authorization": "Bearer " + accessTokenInput.value,
                    "Content-Type": "application/json",
                    "Idempotency-Key": idempotencyKey
                  },
                  body: JSON.stringify(body)
                });

                const data = await response.json();
                pendingPayment = null;
                renderJson(data);

                settleBar.style.width = "100%";
                setTimeout(() => {
                  settleProgress.style.display = "none";
                  settleBar.style.width = "0%";
                  payButton.disabled = false;
                }, 500);
                
                if (data.status === "ok") {
                  const amount = data.amount || (data.decodedInvoice && data.decodedInvoice.amount) || "unknown amount";
                  const successMsg = "Sent " + amount + " sats successfully.";
                  hint.textContent = successMsg;
                  hint.style.color = "var(--good)";
                  showToast(successMsg, "success");
                  addToHistory("Settled: " + amount + " sats", "success");
                } else {
                  hint.style.color = "var(--warn)";
                  const msg = data.message || "";
                  let errText = "";
                  if (msg.includes("Unrecognized local invoice")) {
                    errText = "Unrecognized invoice";
                  } else if (val.startsWith("lnbcrt") && val.length < 20) {
                    errText = "Incorrect invoice";
                  } else {
                    errText = msg || "Invoice failed.";
                  }
                  hint.textContent = errText;
                  showToast(errText, "error");
                  addToHistory("Failed: " + errText, "error");
                }
              } catch (error) {
                renderJson({ status: "error", message: error.message });
                hint.textContent = "Request failed.";
                hint.style.color = "var(--warn)";
                showToast("Request failed", "error");
                addToHistory("Request error", "error");
              } finally {
                payButton.disabled = false;
                setTimeout(() => {
                  settleProgress.style.display = "none";
                  settleBar.style.width = "0%";
                }, 800);
              }
            });
          </script>
        </main>
      </body>
    </html>
  `;
}

// Initialize Bluetooth server
const bluetooth = initBluetooth({ name: "InstaMove" });

// Handle Bluetooth incoming requests
bluetooth.on("request", async (payload) => {
  const requestId = crypto.randomUUID();
  try {
    validateBluetoothBody(payload);
    const { idempotencyKey: rawKey, ...requestPayload } = payload;
    const key = validateIdempotencyKey(rawKey);
    const validated = validateRequestBody(requestPayload);
    const execution = await idempotency.execute({
      key,
      payload: validated,
      operation: async () => {
        try {
          return { statusCode: 200, body: await processor.handleRequest(validated) };
        } catch (error) {
          return safeOperationError(error, requestId);
        }
      }
    });
    logJsonResponse("bluetooth", execution.result.body);
    bluetooth.sendResponse(execution.result.body);
  } catch (error) {
    bluetooth.sendResponse(toErrorResponse(error, requestId).body);
  }
});

app.get("/", asyncHandler(async (req, res) => {
  const [nodes, bluetoothStatus] = await Promise.all([
    nodeService.listNodes(),
    Promise.resolve(getBluetooth()?.getStatus() || null)
  ]);
  const activeNode = nodes.find((node) => node.status === "active") || nodes[0] || null;

  res.type("html").send(
    renderLandingPage({
      activeNode,
      nodeCount: nodes.length,
      bluetoothStatus
    })
  );
}));

app.post(
  "/request",
  paymentRateLimit,
  authorize("payment"),
  asyncHandler(async (req, res) => {
    const key = validateIdempotencyKey(req.get("idempotency-key"));
    const payload = validateRequestBody(req.body);
    const execution = await idempotency.execute({
      key,
      payload,
      operation: async () => {
        try {
          return { statusCode: 200, body: await processor.handleRequest(payload) };
        } catch (error) {
          return safeOperationError(error, req.requestId);
        }
      }
    });

    res.set("Idempotency-Replayed", String(execution.replayed));
    logJsonResponse("http", execution.result.body);
    res.status(execution.result.statusCode).json(execution.result.body);
  })
);

app.get("/nodes", adminRateLimit, authorize("admin"), asyncHandler(async (req, res) => {
  const nodes = await nodeService.listNodes();
  res.json({ status: "ok", nodes });
}));

app.post("/nodes", adminRateLimit, authorize("admin"), asyncHandler(async (req, res) => {
  const node = await nodeService.registerNode(validateNodeBody(req.body));
  res.status(201).json({ status: "ok", node });
}));

app.post("/nodes/:id/activate", adminRateLimit, authorize("admin"), asyncHandler(async (req, res) => {
  const node = await nodeService.activateNode(validateNodeId(req.params.id));
  res.json({ status: "ok", node });
}));

app.get("/bluetooth/status", adminRateLimit, authorize("admin"), (req, res) => {
  const bt = getBluetooth();
  if (bt) {
    res.json({ status: "ok", bluetooth: bt.getStatus() });
  } else {
    throw new AppError(503, "BLUETOOTH_UNAVAILABLE", "Bluetooth is not available");
  }
});

app.post("/bluetooth/send", adminRateLimit, authorize("admin"), (req, res) => {
  const bt = getBluetooth();
  if (!bt) {
    throw new AppError(503, "BLUETOOTH_UNAVAILABLE", "Bluetooth is not available");
  }

  const payload = validateBluetoothBody(req.body);
  bt.sendResponse(payload);
  res.json({ status: "ok", message: "Response sent over Bluetooth" });
});

app.post("/bluetooth/receive", adminRateLimit, authorize("admin"), (req, res) => {
  const bt = getBluetooth();
  if (!bt) {
    throw new AppError(503, "BLUETOOTH_UNAVAILABLE", "Bluetooth is not available");
  }

  const payload = validateBluetoothBody(req.body);
  validateIdempotencyKey(payload.idempotencyKey);
  bt.receiveData(payload);
  res.status(202).json({ status: "ok", message: "Bluetooth request accepted" });
});

app.use((req, res, next) => {
  next(new AppError(404, "NOT_FOUND", "Route not found"));
});

app.use((error, req, res, next) => {
  const response = safeOperationError(error, req.requestId || crypto.randomUUID());
  res.status(response.statusCode).json(response.body);
});

function startServer(port = process.env.PORT || 4000) {
  return app.listen(port, () => console.log(`Server running on port ${port}`));
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
