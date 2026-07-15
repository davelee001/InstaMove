function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function icon(name, size = 18) {
  const paths = {
    bolt: '<path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/>',
    bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
    server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/><path d="m9 12 2 2 4-4"/>',
    activity: '<path d="M3 12h4l3-9 4 18 3-9h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>'
  };
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.activity}</svg>`;
}

function renderLandingPage({ activeNode, nodeCount, bluetoothStatus, lightningMode, nonce, serviceReady }) {
  const mode = String(lightningMode || "mock").toLowerCase();
  const modeLabel = mode === "regtest" ? "Regtest" : mode === "lnd" ? "LND" : "Mock";
  const nodeId = activeNode?.id || "No active node";
  const nodeAddress = activeNode?.ip || activeNode?.host || "Not configured";
  const bluetoothReady = Boolean(bluetoothStatus?.advertising);
  const bluetoothLabel = bluetoothReady ? "Advertising" : "Idle";
  const subscriberCount = Number(bluetoothStatus?.subscribers || 0);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#151814" />
    <title>InstaMove | Lightning Operations</title>
    <style nonce="${escapeHtml(nonce)}">
      :root {
        color-scheme: light;
        --ink: #171915;
        --ink-soft: #363a33;
        --muted: #71766c;
        --line: #d9dcd3;
        --surface: #ffffff;
        --canvas: #f2f3ee;
        --canvas-deep: #e8ebe3;
        --amber: #e9a629;
        --amber-dark: #9f6500;
        --teal: #137a72;
        --teal-soft: #e0f1ee;
        --danger: #b43b35;
        --danger-soft: #f8e6e4;
        --radius: 6px;
        --shadow: 0 10px 30px rgba(27, 31, 24, 0.08);
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-width: 320px;
        overflow-x: hidden;
        background: var(--canvas);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      button, input { font: inherit; letter-spacing: 0; }
      button { touch-action: manipulation; }
      .icon { flex: 0 0 auto; }
      .topbar {
        height: 64px;
        background: #151814;
        color: #fff;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .topbar-inner {
        width: min(1240px, calc(100% - 40px));
        height: 100%;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
      }
      .brand { display: flex; align-items: center; gap: 11px; font-weight: 800; }
      .brand-mark {
        width: 34px; height: 34px; display: grid; place-items: center;
        background: var(--amber); color: #191b17; border-radius: 6px;
      }
      .brand-copy { display: grid; gap: 1px; }
      .brand-name { font-size: 0.98rem; }
      .brand-sub { color: #9fa69b; font-size: 0.69rem; font-weight: 500; }
      .top-status { display: flex; align-items: center; gap: 10px; color: #dfe4db; font-size: 0.78rem; }
      .pulse { width: 8px; height: 8px; border-radius: 50%; background: #42c59b; box-shadow: 0 0 0 4px rgba(66,197,155,0.14); }
      .pulse.warn { background: var(--amber); box-shadow: 0 0 0 4px rgba(233,166,41,0.16); }

      .hero {
        min-height: 306px;
        color: #fff;
        background-image: linear-gradient(90deg, rgba(10,14,13,0.95) 0%, rgba(10,14,13,0.83) 38%, rgba(10,14,13,0.12) 76%), url('/assets/instamove-hero.png');
        background-size: cover;
        background-position: center;
        display: flex;
        align-items: stretch;
      }
      .hero-inner {
        width: min(1240px, calc(100% - 40px));
        margin: 0 auto;
        padding: 48px 0 30px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .eyebrow { display: flex; align-items: center; gap: 8px; color: #f3c76f; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; }
      h1 { max-width: 620px; margin: 12px 0 10px; font-size: 2.7rem; line-height: 1.05; font-weight: 780; }
      .hero-copy { max-width: 610px; margin: 0; color: #d5d9d2; font-size: 0.98rem; line-height: 1.65; }
      .hero-status { display: flex; flex-wrap: wrap; gap: 22px; margin-top: 28px; }
      .hero-status-item { display: flex; align-items: center; gap: 9px; font-size: 0.78rem; color: #dfe3dc; }
      .hero-status-item strong { color: #fff; font-weight: 700; }

      .metrics-band { background: var(--canvas-deep); border-bottom: 1px solid var(--line); }
      .metrics {
        width: min(1240px, calc(100% - 40px));
        margin: 0 auto;
        padding: 18px 0;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .metric {
        min-width: 0; min-height: 94px; padding: 16px;
        background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
        display: grid; grid-template-columns: 38px minmax(0,1fr); gap: 12px; align-items: center;
      }
      .metric-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 6px; background: #f7ead1; color: var(--amber-dark); }
      .metric:nth-child(2) .metric-icon { background: var(--teal-soft); color: var(--teal); }
      .metric:nth-child(3) .metric-icon { background: #e7ece5; color: #4c5849; }
      .metric:nth-child(4) .metric-icon { background: #eee8f5; color: #665079; }
      .metric-label { display: block; color: var(--muted); font-size: 0.71rem; font-weight: 700; text-transform: uppercase; }
      .metric-value { margin-top: 4px; font-size: 1rem; font-weight: 780; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .metric-meta { margin-top: 3px; color: var(--muted); font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .content { width: min(1240px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 42px; }
      .section-heading { margin-bottom: 14px; display: flex; align-items: end; justify-content: space-between; gap: 20px; }
      .section-heading h2 { margin: 0; font-size: 1.18rem; }
      .section-heading p { margin: 4px 0 0; color: var(--muted); font-size: 0.8rem; }
      .security-note { display: flex; align-items: center; gap: 7px; color: var(--teal); font-size: 0.76rem; font-weight: 700; }
      .workspace { display: grid; grid-template-columns: minmax(0, 1.22fr) minmax(340px, 0.78fr); gap: 16px; align-items: stretch; }
      .panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
      .payment-panel { padding: 22px; }
      .panel-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
      .panel-title h3 { margin: 0; font-size: 1rem; }
      .mode-tag { padding: 5px 8px; border-radius: 4px; background: #f7ead1; color: var(--amber-dark); font-size: 0.68rem; font-weight: 800; text-transform: uppercase; }
      .quick-label { margin-bottom: 8px; color: var(--muted); font-size: 0.72rem; font-weight: 700; }
      .quick-invoices { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; margin-bottom: 18px; }
      .quick-invoice { min-height: 42px; border: 0; border-right: 1px solid var(--line); background: #fafbf8; color: var(--ink-soft); cursor: pointer; font-size: 0.76rem; font-weight: 700; }
      .quick-invoice:last-child { border-right: 0; }
      .quick-invoice:hover, .quick-invoice:focus-visible { background: #f5ead3; color: var(--amber-dark); outline: none; }
      .field { display: grid; gap: 7px; margin-bottom: 14px; }
      .field-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      label { color: var(--ink-soft); font-size: 0.76rem; font-weight: 760; }
      .input-wrap { position: relative; }
      input {
        width: 100%; height: 48px; border: 1px solid #cfd3c9; border-radius: 6px;
        background: #fbfcf9; color: var(--ink); padding: 0 46px 0 13px; outline: none;
      }
      input:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(19,122,114,0.12); }
      .icon-button { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 4px; background: transparent; color: var(--muted); cursor: pointer; }
      .icon-button:hover, .icon-button:focus-visible { color: var(--ink); background: #eef0ea; outline: none; }
      .input-action { position: absolute; right: 6px; top: 6px; }
      .field-help { color: var(--muted); font-size: 0.7rem; }
      .submit-row { display: flex; align-items: center; gap: 14px; margin-top: 20px; }
      .primary-button {
        min-width: 154px; height: 46px; border: 0; border-radius: 6px; padding: 0 18px;
        display: inline-flex; align-items: center; justify-content: center; gap: 9px;
        background: var(--ink); color: #fff; font-weight: 760; cursor: pointer;
      }
      .primary-button:hover { background: #2b3029; }
      .primary-button:disabled { opacity: 0.52; cursor: not-allowed; }
      .form-status { min-height: 20px; color: var(--muted); font-size: 0.76rem; }
      .form-status.success { color: var(--teal); }
      .form-status.error { color: var(--danger); }
      .stages { margin-top: 18px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .stage { height: 4px; background: #e6e9e1; border-radius: 2px; transition: background 180ms ease; }
      .stage.active { background: var(--amber); }
      .stage.complete { background: var(--teal); }

      .response-panel { min-height: 100%; display: flex; flex-direction: column; overflow: hidden; }
      .response-header { min-height: 60px; padding: 14px 16px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .response-header h3 { margin: 0; font-size: 0.92rem; }
      .response-state { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 0.7rem; }
      .response-dot { width: 7px; height: 7px; border-radius: 50%; background: #9aa094; }
      .response-dot.success { background: var(--teal); }
      .response-dot.error { background: var(--danger); }
      .response-body { flex: 1; min-height: 310px; padding: 16px; background: #171a17; color: #cdd6ca; overflow: auto; }
      pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 0.75rem/1.6 "Cascadia Code", "SFMono-Regular", Consolas, monospace; }
      .response-footer { min-height: 48px; padding: 8px 12px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: 0.7rem; }

      .lower-grid { margin-top: 16px; display: grid; grid-template-columns: 1.35fr 0.65fr; gap: 16px; }
      .activity-panel, .posture-panel { padding: 18px; box-shadow: none; }
      .activity-list { display: grid; gap: 0; min-height: 116px; }
      .activity-empty { min-height: 116px; display: grid; place-items: center; color: var(--muted); font-size: 0.78rem; }
      .activity-item { min-height: 44px; display: grid; grid-template-columns: 84px 1fr auto; gap: 12px; align-items: center; border-top: 1px solid #eceee8; font-size: 0.76rem; }
      .activity-time { color: var(--muted); font-variant-numeric: tabular-nums; }
      .activity-type { color: var(--muted); font-size: 0.68rem; text-transform: uppercase; font-weight: 800; }
      .activity-type.success { color: var(--teal); }
      .activity-type.error { color: var(--danger); }
      .posture-list { display: grid; gap: 12px; }
      .posture-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 0.76rem; }
      .posture-row span:first-child { color: var(--muted); }
      .posture-value { display: flex; align-items: center; gap: 6px; font-weight: 760; }
      .posture-value.good { color: var(--teal); }
      .footer { border-top: 1px solid var(--line); background: #e8ebe3; }
      .footer-inner { width: min(1240px, calc(100% - 40px)); min-height: 62px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 20px; color: var(--muted); font-size: 0.72rem; }
      .toast { position: fixed; right: 20px; bottom: 20px; z-index: 10; max-width: min(380px, calc(100% - 40px)); padding: 12px 14px; border-radius: 6px; background: #171a17; color: #fff; box-shadow: 0 14px 36px rgba(0,0,0,0.22); transform: translateY(18px); opacity: 0; pointer-events: none; transition: 180ms ease; font-size: 0.78rem; }
      .toast.show { transform: translateY(0); opacity: 1; }
      .toast.error { background: #8e2e29; }

      @media (max-width: 960px) {
        .metrics { grid-template-columns: repeat(2, 1fr); }
        .workspace, .lower-grid { grid-template-columns: 1fr; }
        .response-body { min-height: 250px; }
      }
      @media (max-width: 640px) {
        .topbar-inner, .hero-inner, .metrics, .content, .footer-inner { width: min(100% - 24px, 1240px); }
        .brand-sub, .top-status span:last-child, .security-note { display: none; }
        .hero { min-height: 330px; background-position: 64% center; }
        .hero-inner { padding: 38px 0 24px; }
        h1 { max-width: 100%; font-size: 2rem; }
        .hero-copy { max-width: 100%; font-size: 0.84rem; overflow-wrap: anywhere; }
        .hero-status { gap: 12px; }
        .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .metric { min-height: 92px; padding: 12px; grid-template-columns: 32px minmax(0, 1fr); gap: 8px; }
        .metric-icon { width: 32px; height: 32px; }
        .metric-label { font-size: 0.61rem; }
        .metric-value { font-size: 0.86rem; }
        .metric-meta { font-size: 0.64rem; }
        .content { padding-top: 22px; }
        .section-heading { align-items: start; }
        .payment-panel { padding: 16px; }
        .quick-invoices { grid-template-columns: 1fr; }
        .quick-invoice { border-right: 0; border-bottom: 1px solid var(--line); }
        .quick-invoice:last-child { border-bottom: 0; }
        .submit-row { align-items: stretch; flex-direction: column; }
        .primary-button { width: 100%; }
        .activity-item { grid-template-columns: 70px 1fr; }
        .activity-type { grid-column: 2; }
        .footer-inner { padding: 14px 0; align-items: start; flex-direction: column; }
      }
      @media (prefers-reduced-motion: reduce) {
        * { scroll-behavior: auto !important; transition: none !important; }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="brand-mark">${icon("bolt", 19)}</div>
          <div class="brand-copy"><span class="brand-name">InstaMove</span><span class="brand-sub">Lightning operations console</span></div>
        </div>
        <div class="top-status"><span class="pulse${serviceReady ? "" : " warn"}"></span><span>${serviceReady ? "Services operational" : "Configuration required"}</span></div>
      </div>
    </header>

    <main>
      <section class="hero">
        <div class="hero-inner">
          <div>
            <div class="eyebrow">${icon("activity", 15)} Secure local settlement</div>
            <h1>InstaMove Lightning payments.</h1>
            <p class="hero-copy">Operate invoices, validate settlement, and coordinate local Bluetooth exchange from one focused console.</p>
          </div>
          <div class="hero-status">
            <div class="hero-status-item">${icon("bolt", 16)} <span>Mode <strong>${escapeHtml(modeLabel)}</strong></span></div>
            <div class="hero-status-item">${icon("server", 16)} <span>Node <strong>${escapeHtml(nodeId)}</strong></span></div>
            <div class="hero-status-item">${icon("bluetooth", 16)} <span>Bluetooth <strong>${escapeHtml(bluetoothLabel)}</strong></span></div>
          </div>
        </div>
      </section>

      <section class="metrics-band" aria-label="System overview">
        <div class="metrics">
          <article class="metric"><div class="metric-icon">${icon("server")}</div><div><span class="metric-label">Active node</span><div class="metric-value">${escapeHtml(nodeId)}</div><div class="metric-meta">${escapeHtml(nodeAddress)}</div></div></article>
          <article class="metric"><div class="metric-icon">${icon("bluetooth")}</div><div><span class="metric-label">Bluetooth</span><div class="metric-value">${escapeHtml(bluetoothLabel)}</div><div class="metric-meta">${subscriberCount} connected subscriber${subscriberCount === 1 ? "" : "s"}</div></div></article>
          <article class="metric"><div class="metric-icon">${icon("activity")}</div><div><span class="metric-label">Network inventory</span><div class="metric-value">${escapeHtml(nodeCount)} node${nodeCount === 1 ? "" : "s"}</div><div class="metric-meta">Local routing records</div></div></article>
          <article class="metric"><div class="metric-icon">${icon("clock")}</div><div><span class="metric-label">Session</span><div class="metric-value" id="session-count">0 payments</div><div class="metric-meta" id="session-uptime">Uptime 00:00</div></div></article>
        </div>
      </section>

      <section class="content">
        <div class="section-heading">
          <div><h2>Payment workspace</h2><p>Validate and settle a BOLT11 invoice through the active Lightning mode.</p></div>
          <div class="security-note">${icon("shield", 16)} Authenticated and idempotent</div>
        </div>

        <div class="workspace">
          <section class="panel payment-panel">
            <div class="panel-title"><h3>New payment</h3><span class="mode-tag">${escapeHtml(modeLabel)}</span></div>
            <div class="quick-label">Quick mock invoices</div>
            <div class="quick-invoices" role="group" aria-label="Quick invoice amounts">
              <button class="quick-invoice" type="button" data-invoice="lnbcrt10u1instamove7edd898728b93fc5">10 sats</button>
              <button class="quick-invoice" type="button" data-invoice="lnbcrt5000u1instamoved8353f1c82f4a3bb">5,000 sats</button>
              <button class="quick-invoice" type="button" data-invoice="lnbcrt10000u1instamovefc1a2cb6ab734c15">10,000 sats</button>
            </div>
            <form id="payment-form">
              <div class="field">
                <div class="field-row"><label for="paymentRequest">BOLT11 invoice</label><span class="field-help">Maximum configured server-side</span></div>
                <input id="paymentRequest" name="paymentRequest" autocomplete="off" spellcheck="false" placeholder="lnbcrt..." required />
              </div>
              <div class="field">
                <div class="field-row"><label for="accessToken">Payment access token</label><span class="field-help">Held in this tab only</span></div>
                <div class="input-wrap">
                  <input id="accessToken" name="accessToken" type="password" autocomplete="current-password" required />
                  <button class="icon-button input-action" id="toggle-token" type="button" title="Show or hide token" aria-label="Show or hide token">${icon("eye", 17)}</button>
                </div>
              </div>
              <div class="submit-row">
                <button class="primary-button" id="pay-button" type="submit">${icon("bolt", 17)} <span>Pay invoice</span></button>
                <div class="form-status" id="form-status" role="status" aria-live="polite">Ready for an invoice.</div>
              </div>
              <div class="stages" aria-hidden="true"><span class="stage" id="stage-1"></span><span class="stage" id="stage-2"></span><span class="stage" id="stage-3"></span></div>
            </form>
          </section>

          <section class="panel response-panel">
            <div class="response-header"><h3>Live response</h3><div class="response-state"><span class="response-dot" id="response-dot"></span><span id="response-label">Waiting</span></div></div>
            <div class="response-body"><pre id="response-output">{
  "status": "waiting",
  "message": "Submit an invoice to inspect settlement data."
}</pre></div>
            <div class="response-footer"><span id="response-time">No response yet</span><button class="icon-button" id="copy-response" type="button" title="Copy response" aria-label="Copy response">${icon("copy", 16)}</button></div>
          </section>
        </div>

        <div class="lower-grid">
          <section class="panel activity-panel">
            <div class="panel-title"><h3>Session activity</h3><span class="mode-tag" id="activity-total">0 events</span></div>
            <div class="activity-list" id="activity-list"><div class="activity-empty">No payment activity in this session.</div></div>
          </section>
          <aside class="panel posture-panel">
            <div class="panel-title"><h3>Security posture</h3>${icon("shield", 18)}</div>
            <div class="posture-list">
              <div class="posture-row"><span>Bearer authorization</span><span class="posture-value good">${icon("check", 14)} Required</span></div>
              <div class="posture-row"><span>Idempotency</span><span class="posture-value good">${icon("check", 14)} Enforced</span></div>
              <div class="posture-row"><span>Lightning mode</span><span class="posture-value">${escapeHtml(modeLabel)}</span></div>
              <div class="posture-row"><span>Transport</span><span class="posture-value">Local HTTP</span></div>
            </div>
          </aside>
        </div>
      </section>
    </main>

    <footer class="footer"><div class="footer-inner"><span>InstaMove Lightning operations</span><span>Node-side prototype · ${escapeHtml(modeLabel)} mode</span></div></footer>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>

    <script nonce="${escapeHtml(nonce)}">
      const form = document.getElementById("payment-form");
      const invoiceInput = document.getElementById("paymentRequest");
      const tokenInput = document.getElementById("accessToken");
      const payButton = document.getElementById("pay-button");
      const formStatus = document.getElementById("form-status");
      const output = document.getElementById("response-output");
      const responseDot = document.getElementById("response-dot");
      const responseLabel = document.getElementById("response-label");
      const responseTime = document.getElementById("response-time");
      const activityList = document.getElementById("activity-list");
      const activityTotal = document.getElementById("activity-total");
      const toast = document.getElementById("toast");
      const stages = [1, 2, 3].map((number) => document.getElementById("stage-" + number));
      const startedAt = Date.now();
      let pendingPayment = null;
      let paymentCount = 0;
      let activityCount = 0;

      function setStages(activeCount, complete = false) {
        stages.forEach((stage, index) => {
          stage.className = "stage";
          if (index < activeCount) stage.classList.add(complete ? "complete" : "active");
        });
      }

      function setStatus(message, type = "") {
        formStatus.textContent = message;
        formStatus.className = "form-status" + (type ? " " + type : "");
      }

      function renderResponse(data, type = "") {
        output.textContent = JSON.stringify(data, null, 2);
        responseDot.className = "response-dot" + (type ? " " + type : "");
        responseLabel.textContent = type === "success" ? "Settled" : type === "error" ? "Failed" : "Received";
        responseTime.textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }

      function addActivity(message, type) {
        if (activityList.querySelector(".activity-empty")) activityList.replaceChildren();
        const item = document.createElement("div");
        item.className = "activity-item";
        const time = document.createElement("span");
        time.className = "activity-time";
        time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const description = document.createElement("span");
        description.textContent = message;
        const label = document.createElement("span");
        label.className = "activity-type " + type;
        label.textContent = type;
        item.append(time, description, label);
        activityList.prepend(item);
        while (activityList.children.length > 5) activityList.lastElementChild.remove();
        activityCount += 1;
        activityTotal.textContent = activityCount + (activityCount === 1 ? " event" : " events");
      }

      function showToast(message, type = "") {
        toast.textContent = message;
        toast.className = "toast show" + (type ? " " + type : "");
        window.setTimeout(() => { toast.className = "toast" + (type ? " " + type : ""); }, 3000);
      }

      document.querySelectorAll(".quick-invoice").forEach((button) => {
        button.addEventListener("click", () => {
          invoiceInput.value = button.dataset.invoice;
          invoiceInput.focus();
          setStatus(button.textContent.trim() + " mock invoice selected.");
        });
      });

      document.getElementById("toggle-token").addEventListener("click", () => {
        tokenInput.type = tokenInput.type === "password" ? "text" : "password";
      });

      document.getElementById("copy-response").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(output.textContent);
          showToast("Response copied");
        } catch {
          showToast("Copy is unavailable", "error");
        }
      });

      window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
        const seconds = String(elapsed % 60).padStart(2, "0");
        document.getElementById("session-uptime").textContent = "Uptime " + minutes + ":" + seconds;
      }, 1000);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const paymentRequest = invoiceInput.value.trim();
        const token = tokenInput.value.trim();
        if (!paymentRequest || !token) return;

        const idempotencyKey = pendingPayment && pendingPayment.invoice === paymentRequest
          ? pendingPayment.key
          : crypto.randomUUID();
        pendingPayment = { invoice: paymentRequest, key: idempotencyKey };
        payButton.disabled = true;
        setStatus("Validating invoice...");
        setStages(1);

        try {
          const response = await fetch("/request", {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + token,
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey
            },
            body: JSON.stringify({ paymentRequest })
          });
          setStages(2);
          const data = await response.json();
          pendingPayment = null;

          if (!response.ok || data.status !== "ok") {
            const message = data.message || "Payment could not be completed.";
            renderResponse(data, "error");
            setStatus(message, "error");
            setStages(3);
            addActivity(message, "error");
            showToast(message, "error");
            return;
          }

          paymentCount += 1;
          document.getElementById("session-count").textContent = paymentCount + (paymentCount === 1 ? " payment" : " payments");
          renderResponse(data, "success");
          setStatus(data.amountLabel + " settled successfully.", "success");
          setStages(3, true);
          addActivity(data.amountLabel + " settled to " + (data.sentTo || "destination"), "success");
          showToast(data.amountLabel + " settled successfully");
        } catch (error) {
          renderResponse({ status: "error", message: "The server could not be reached." }, "error");
          setStatus("Connection failed. Retry will reuse the same payment key.", "error");
          setStages(3);
          addActivity("Connection to server failed", "error");
          showToast("Connection failed", "error");
        } finally {
          payButton.disabled = false;
        }
      });
    </script>
  </body>
</html>`;
}

module.exports = { renderLandingPage };
