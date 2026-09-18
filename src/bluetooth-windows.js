const EventEmitter = require("node:events");
const path = require("node:path");
const { spawn } = require("node:child_process");
const encryption = require("./encryption");
const { AppError } = require("./errors");

const MAX_MESSAGE = 16384;
const MAX_FRAGMENTS = 128;

class WindowsBluetoothServer extends EventEmitter {
  constructor({ name = "InstaMove", launch = spawn, platform = process.platform } = {}) {
    super();
    this.name = name;
    this.mode = "windows";
    this.state = "starting";
    this.isAdvertising = false;
    this.sessions = new Map();
    this.stdout = "";
    this.stopped = false;
    this.failed = false;
    this.key = process.env.INSTAMOVE_BLUETOOTH_KEY;
    if (platform !== "win32") { this.state = "unsupported_platform"; return; }
    if (!/^[a-f0-9]{64}$/i.test(this.key || "")) { this.state = "key_missing_or_invalid"; return; }
    if (Number(process.env.IDEMPOTENCY_RETENTION_MS || 86400000) < 120000) {
      this.state = "retention_too_short"; return;
    }
    const executable = process.env.INSTAMOVE_BLUETOOTH_HELPER || path.resolve(
      __dirname, "../native/windows-bluetooth/publish/InstaMove.Bluetooth.exe");
    try {
      this.child = launch(executable, [], {
        windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        // The native process needs no payment, LND, encryption or API credentials.
        env: Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"]
          .filter(key => process.env[key]).map(key => [key, process.env[key]]))
      });
      this.child.stdout.setEncoding("utf8");
      this.child.stdout.on("data", chunk => this.consume(chunk));
      this.child.stderr.resume();
      this.child.stdin.on("error", () => this.fail("helper_unavailable"));
      this.child.on("error", () => this.fail("helper_unavailable"));
      this.child.on("exit", () => this.fail(this.stopped ? "stopped" : "helper_exited"));
      this.timer = setInterval(() => {
        for (const [id, session] of this.sessions) {
          if (!session.busy && Date.now() > session.expiresAt) this.sessions.delete(id);
        }
      }, 1000);
      this.timer.unref();
      this.startupTimer = setTimeout(() => {
        if (this.state === "starting") this.fail("startup_timeout");
      }, 10000);
      this.startupTimer.unref();
    } catch { this.fail("helper_unavailable"); }
  }

  fail(state) {
    if (this.failed) return;
    this.failed = true;
    this.state = state;
    this.isAdvertising = false;
    this.sessions.clear();
    clearInterval(this.timer);
    clearTimeout(this.startupTimer);
    this.child?.kill();
  }

  consume(chunk) {
    this.stdout += chunk;
    if (this.stdout.length > 65536) { this.fail("invalid_helper_output"); return; }
    let end;
    while ((end = this.stdout.indexOf("\n")) !== -1) {
      const line = this.stdout.slice(0, end);
      this.stdout = this.stdout.slice(end + 1);
      try { this.handleEvent(JSON.parse(line)); }
      catch { this.fail("invalid_helper_output"); return; }
    }
  }

  handleEvent(event) {
    if (this.stopped || this.failed) return;
    if (event.type === "status") {
      this.isAdvertising = event.state === "advertising";
      this.state = this.isAdvertising ? "advertising" : "unavailable";
      clearTimeout(this.startupTimer);
      if (!this.isAdvertising) this.sessions.clear();
    } else if (event.type === "frame" && this.isAdvertising) {
      this.acceptFrame(event.session, event.data);
    } else if (event.type === "disconnect") {
      this.sessions.delete(event.session);
    }
  }

  acceptFrame(id, encoded) {
    if (typeof id !== "string" || id.length > 1024 || typeof encoded !== "string" || encoded.length > 700) return;
    const frame = Buffer.from(encoded, "base64");
    if (frame.length < 5 || frame.length > 512) return;
    const index = frame.readUInt16LE(0);
    const total = frame.readUInt16LE(2);
    if (total < 1 || total > MAX_FRAGMENTS || index >= total) return;
    let session = this.sessions.get(id);
    if (session?.busy) return;
    if (index === 0) {
      if (!session && this.sessions.size >= 8) return;
      // Fixed per-peer window bounds authenticated and unauthenticated traffic.
      const now = Date.now();
      const attempts = session && now < session.windowEnd ? session.attempts + 1 : 1;
      const windowEnd = session && now < session.windowEnd ? session.windowEnd : now + 60000;
      if (attempts > 30) return;
      session = { chunks: [], length: 0, next: 0, total, expiresAt: now + 15000, attempts, windowEnd };
      this.sessions.set(id, session);
    }
    if (!session || Date.now() > session.expiresAt || session.total !== total || session.next !== index) return;
    session.length += frame.length - 4;
    if (session.length > MAX_MESSAGE) { this.sessions.delete(id); return; }
    session.chunks.push(frame.subarray(4));
    session.next += 1;
    if (session.next !== total) return;
    const envelope = Buffer.concat(session.chunks).toString("utf8");
    session.chunks = [];
    try {
      const message = encryption.decrypt(envelope, this.key);
      const now = Date.now();
      if (message?.type !== "request" || !Number.isSafeInteger(message.expiresAt) ||
          message.expiresAt <= now || message.expiresAt > now + 60000 ||
          !message.payload || typeof message.payload !== "object" || Array.isArray(message.payload)) return;
      session.busy = true;
      this.emit("request", message.payload, body => {
        // Responses are addressed to the originating session, never broadcast.
        if (!this.stopped && this.sessions.get(id) === session) {
          const data = encryption.encrypt({ type: "response", idempotencyKey: message.payload.idempotencyKey, body }, this.key);
          if (Buffer.byteLength(data) <= MAX_MESSAGE) {
            this.child.stdin.write(JSON.stringify({ type: "response", session: id, data }) + "\n");
          }
          session.busy = false;
          session.expiresAt = session.windowEnd;
        }
      });
    } catch {
      session.busy = false;
      session.expiresAt = session.windowEnd;
    }
  }

  getStatus() {
    return { name: this.name, mode: this.mode, state: this.state, advertising: this.isAdvertising,
      ready: this.isAdvertising && !this.stopped, subscribers: this.sessions.size };
  }
  sendResponse() { throw new AppError(409, "BLUETOOTH_SESSION_REQUIRED", "A response requires an authenticated Bluetooth request"); }
  receiveData() { throw new AppError(409, "BLUETOOTH_SIMULATION_DISABLED", "HTTP Bluetooth injection is available only in simulated mode"); }
  stopAdvertising() {
    this.stopped = true;
    this.fail("stopped");
  }
}

module.exports = { WindowsBluetoothServer };
