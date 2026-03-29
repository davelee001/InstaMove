const express = require("express");
const processor = require("./processor");
const nodeService = require("./node");
const { initBluetooth, getBluetooth } = require("./bluetooth");
const lightningConfig = require("../config/lightning.json");

const app = express();
app.use(express.json());

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
  const currentMode = (process.env.LIGHTNING_MODE || lightningConfig.mode || "mock").toLowerCase();
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
                <span class="chip"><strong>Mode:</strong> ${escapeHtml(modeLabel)}</span>
                <span class="chip"><strong>Nodes:</strong> ${escapeHtml(nodeCount)}</span>
                <span class="chip"><strong>Bluetooth:</strong> ${escapeHtml(bluetoothState)}</span>
                <span class="chip"><strong>Bluetooth Mode:</strong> ${bluetoothMode}</span>
                <span class="chip"><strong>Connectivity:</strong> Without internet</span>
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
                  <input id="paymentRequest" name="paymentRequest" placeholder="lnbcrt10000u1instamove..." value="" required />
                </div>
              </div>
              <div class="actions" style="margin-top: 14px;">
                <button class="button" type="submit">Pay Invoice</button>
                <span class="helper" id="formHint"></span>
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

          <div class="footer">
            <span>InstaMove backend is live.</span>
            <span class="status-good">Bluetooth-first, regtest-ready, without internet</span>
          </div>
          <script>
            const form = document.getElementById("transaction-form");
            const output = document.getElementById("responseOutput");
            const hint = document.getElementById("formHint");
            const toast = document.getElementById("toast");

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

              hint.style.color = "";
              hint.textContent = "Decoding local invoice...";

              const body = {
                paymentRequest: val
              };

              try {
                const response = await fetch("/request", {
                  const successMsg = "Sent " + amount + " sats successfully.";
                  hint.textContent = successMsg;
                  hint.style.color = "var(--good)";
                  showToast(successMsg, "success");
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
                }
              } catch (error) {
                renderJson({ status: "error", message: error.message });
                hint.textContent = "Request failed.";
                hint.style.color = "var(--warn)";
                showToast("Request failed", "error")ized invoice";
                  } else if (val.startsWith("lnbcrt") && val.length < 20) {
                    hint.textContent = "Incorrect invoice";
                  } else {
                    hint.textContent = msg || "Invoice failed.";
                  }
                }
              } catch (error) {
                renderJson({ status: "error", message: error.message });
                hint.textContent = "Request failed.";
                hint.style.color = "var(--warn)";
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
  try {
    console.log("Bluetooth request received:", payload);
    const result = await processor.handleRequest(payload);
    logJsonResponse("bluetooth", result);
    bluetooth.sendResponse(result);
  } catch (error) {
    console.error("Bluetooth request error:", error);
    bluetooth.sendResponse({ status: "error", message: error.message });
  }
});

app.get("/", async (req, res) => {
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
});

app.post("/request", async (req, res) => {
  const result = await processor.handleRequest(req.body);
  logJsonResponse("http", result);
  res.status(result.status === "error" ? 400 : 200).json(result);
});

app.get("/nodes", async (req, res) => {
  const nodes = await nodeService.listNodes();
  res.json({ status: "ok", nodes });
});

app.post("/nodes", async (req, res) => {
  try {
    const node = await nodeService.registerNode(req.body || {});
    res.status(201).json({ status: "ok", node });
  } catch (error) {
    res.status(400).json({ status: "error", message: error.message });
  }
});

app.post("/nodes/:id/activate", async (req, res) => {
  try {
    const node = await nodeService.activateNode(req.params.id);
    res.json({ status: "ok", node });
  } catch (error) {
    res.status(400).json({ status: "error", message: error.message });
  }
});

app.get("/bluetooth/status", (req, res) => {
  const bt = getBluetooth();
  if (bt) {
    res.json({ status: "ok", bluetooth: bt.getStatus() });
  } else {
    res.json({ status: "error", message: "Bluetooth not initialized" });
  }
});

app.post("/bluetooth/send", (req, res) => {
  const bt = getBluetooth();
  if (!bt) {
    return res.status(400).json({ status: "error", message: "Bluetooth not initialized" });
  }

  try {
    bt.sendResponse(req.body);
    logJsonResponse("bluetooth-send", req.body);
    res.json({ status: "ok", message: "Response sent over Bluetooth" });
  } catch (error) {
    res.status(400).json({ status: "error", message: error.message });
  }
});

app.post("/bluetooth/receive", async (req, res) => {
  const bt = getBluetooth();
  if (!bt) {
    return res.status(400).json({ status: "error", message: "Bluetooth not initialized" });
  }

  try {
    // Simulate receiving data from Bluetooth client
    bt.receiveData(req.body);
    console.log("[bluetooth-receive] payload:");
    console.log(JSON.stringify(req.body, null, 2));
    res.json({ status: "ok", message: "Data received from Bluetooth" });
  } catch (error) {
    res.status(400).json({ status: "error", message: error.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
