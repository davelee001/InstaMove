const EventEmitter = require("events");
const logger = require("./logger");

/**
 * Simulated Bluetooth service for development/testing
 * Real Bluetooth support requires platform-specific libraries (bleno on Linux/macOS)
 */

class SimulatedCharacteristic {
  constructor(uuid, properties = []) {
    this.uuid = uuid;
    this.properties = properties;
    this.value = Buffer.from("{}");
    this.subscribers = [];
  }

  write(data) {
    this.value = Buffer.isBuffer(data) ? data : Buffer.from(data);
  }

  read() {
    return this.value;
  }

  subscribe(callback) {
    if (!this.subscribers.includes(callback)) {
      this.subscribers.push(callback);
    }
  }

  unsubscribe(callback) {
    this.subscribers = this.subscribers.filter((cb) => cb !== callback);
  }

  notify(data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.subscribers.forEach((callback) => {
      try {
        callback(buffer);
      } catch (error) {
        logger.warn("bluetooth_notify_failed", { errorName: error.name });
      }
    });
  }
}

class BluetoothServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = options.name || "InstaMove";
    this.mode = options.mode || "simulated";
    this.isAdvertising = false;

    // Initialize characteristics
    this.writeChar = new SimulatedCharacteristic("write", ["write"]);
    this.readChar = new SimulatedCharacteristic("read", ["read"]);
    this.notifyChar = new SimulatedCharacteristic("notify", ["notify"]);

    // Setup write event handling
    this.setupWriteHandler();
    this.setupAdvertising();
  }

  setupWriteHandler() {
    // Override write characteristic to emit request events
    const originalWrite = this.writeChar.write.bind(this.writeChar);
    this.writeChar.write = (data) => {
      originalWrite(data);
      try {
        const payload = JSON.parse(data.toString("utf8"));
        this.emit("request", payload);
      } catch (error) {
        logger.warn("bluetooth_payload_invalid", { errorName: error.name });
      }
    };
  }

  setupAdvertising() {
    // Simulate advertising with immediate "ready" event
    setImmediate(() => {
      this.isAdvertising = true;
      logger.info("bluetooth_ready", { mode: this.mode, service: this.name });
      this.emit("ready");
    });
  }

  startAdvertising() {
    if (this.isAdvertising) return;
    this.isAdvertising = true;
    logger.info("bluetooth_advertising_started", { mode: this.mode });
  }

  stopAdvertising() {
    if (!this.isAdvertising) return;
    this.isAdvertising = false;
    logger.info("bluetooth_advertising_stopped", { mode: this.mode });
  }

  sendResponse(data) {
    try {
      const buffer =
        typeof data === "string"
          ? Buffer.from(data)
          : Buffer.from(JSON.stringify(data));
      this.readChar.write(buffer);
      this.notifyChar.notify(buffer);
    } catch (error) {
      logger.warn("bluetooth_send_failed", { errorName: error.name });
    }
  }

  getStatus() {
    return {
      name: this.name,
      mode: this.mode,
      advertising: this.isAdvertising,
      subscribers: this.notifyChar.subscribers.length
    };
  }

  // Receive data from Bluetooth client (for testing)
  receiveData(data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
    this.writeChar.write(buffer);
  }
}

let bluetoothServer = null;

function initBluetooth(options = {}) {
  if (!bluetoothServer) {
    const mode = process.env.BLUETOOTH_MODE || options.mode || "simulated";
    bluetoothServer = new BluetoothServer({
      name: options.name || "InstaMove",
      mode
    });
  }
  return bluetoothServer;
}

function getBluetooth() {
  return bluetoothServer;
}

module.exports = {
  initBluetooth,
  getBluetooth,
  BluetoothServer,
  SimulatedCharacteristic
};

