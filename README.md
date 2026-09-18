# InstaMove

InstaMove is a Node.js payment backend and operations workspace with LND integration, durable SQLite storage, and native Windows Bluetooth Low Energy (BLE) support for provisioned trusted devices.

It accepts a request, processes the payload, and returns a JSON response. In local mode, the app recognizes built-in invoice IDs that map to fixed amounts.

## Current Status

The project is ready for controlled staging evaluation. It is not yet validated for production payments. The latest local validation passed 130 automated tests, and the native Windows helper compiled and successfully advertised on the development computer's Intel Bluetooth adapter.

Before enabling real funds, complete live LND regtest payment and failure-recovery testing, pairing and message exchange with a second physical BLE device, and deployment verification for HTTPS, secrets, persistent storage, backups, and monitoring. Uncertain payments require operator reconciliation; automated reconciliation is not implemented.

## Web Workspace

Open `http://localhost:4000` after starting the server. The responsive operations workspace provides:

- live Lightning mode, active-node, Bluetooth, inventory, and session widgets
- quick mock-invoice selection and authenticated invoice submission
- formatted settlement responses and session activity
- visible security and service-readiness status

The interface uses a muted gray-green palette with dark operational areas for the hero and response console. Payment access tokens entered in the workspace remain in the current browser tab and are not persisted by the page.

By default it runs in mock mode. Mock mode never contacts LND or moves real funds.

To connect it to a Lightning node, explicitly set all variables required by the selected mode:

- `LIGHTNING_MODE=regtest` or `LIGHTNING_MODE=lnd`
- `LND_REST_URL`
- `LND_MACAROON`

The server stops during startup if `regtest` or `lnd` is selected without both LND credentials. Use `LIGHTNING_MODE=mock` explicitly when LND is not available.

Optional:

- `LND_PEER_PUBKEY`
- `LND_CHANNEL_FUNDING_SATS`
- `LIGHTNING_AUTO_SETTLE=false`
- `MAX_PAYMENT_SATS=1000000`
- `LND_REQUEST_TIMEOUT_MS=5000`
- `LND_MAX_RESPONSE_BYTES=1048576`
- `LND_GET_RETRY_ATTEMPTS=3`
- `LND_READINESS_TIMEOUT_MS=2000`
- `INSTAMOVE_DB_PATH=./data/instamove.sqlite`
- `IDEMPOTENCY_RETENTION_MS=86400000`

Regtest keeps the payment flow off real money while still using real Lightning APIs when your regtest LND nodes are connected.

For `regtest` or `lnd`, select `BLUETOOTH_MODE=windows` with the native helper configured, or explicitly select `BLUETOOTH_MODE=disabled` for an HTTP-only deployment. Simulated Bluetooth cannot satisfy readiness in these modes. The LND macaroon must permit `GetInfo` as well as the RPCs needed by your payment flow.

LND requests use bounded timeouts and response sizes. Only idempotent GET requests are retried; invoice creation, channel operations, and payments are never automatically replayed by the transport client.

Runtime state is stored transactionally in SQLite. On first startup, existing node, request, channel, invoice, and idempotency JSON files are imported once. After import, SQLite is authoritative and later edits to those JSON files are ignored. Set `INSTAMOVE_DB_PATH` to place the database outside the repository.

Idempotency reservations are written before payment processing and completed only after the result is durable. A request left pending by a process crash returns `IDEMPOTENCY_RECONCILIATION_REQUIRED`; it is not automatically replayed because the external payment outcome may be unknown.

Real LND settlement requires a valid 32-byte preimage whose SHA-256 hash matches both the returned payment hash and the decoded invoice's hash. Empty, malformed, incomplete, or mismatched payment responses cannot produce a settled result. Preimages are not exposed as public payment IDs.

Timeouts and unusable payment responses return `LND_PAYMENT_UNCONFIRMED` and leave their idempotency reservations pending across restart and retention expiry. Reusing the same key returns HTTP 409 until reconciliation. Do not bypass this protection with a new key. An upgrade migration also preserves historical completed transport errors before retention cleanup; see the [operations guide](docs/OPERATIONS.md).

## Local Invoices

The current built-in local invoice IDs are:

- `lnbcrt10000u1instamovefc1a2cb6ab734c15` for 10,000 sats
- `lnbcrt5000u1instamoved8353f1c82f4a3bb` for 5,000 sats
- `lnbcrt10u1instamove7edd898728b93fc5` for 10 sats

These are local identifiers used by InstaMove to simulate invoice handling.

## Run

InstaMove requires Node.js 22.13 or newer. Use the major version recorded in `.nvmrc`.

```bash
npm ci
npm start
```

The server runs on port 4000.

Without authentication configuration, the workspace can load but protected actions remain unavailable and `/ready` returns HTTP 503. For a usable local mock session in PowerShell, generate temporary credentials and start the server in the same terminal:

```powershell
$env:LIGHTNING_MODE = 'mock'
$env:BLUETOOTH_MODE = 'simulated'
$env:INSTAMOVE_PAYMENT_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$env:INSTAMOVE_ADMIN_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$env:INSTAMOVE_ENCRYPTION_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

Use the payment token from that terminal in the workspace's token field. These credentials last for the terminal session; deployed environments need persistent secret management. The app reads process environment variables and does not automatically load `.env`. If using a local `.env` file, replace every example placeholder and run `node --env-file=.env src/app.js`. Keep secrets out of version control.

Run the same validation used in CI with:

```bash
npm run check
npm run audit:high
```

Before using protected endpoints, configure separate bearer tokens for payment and administrative access:

```bash
INSTAMOVE_PAYMENT_TOKEN=replace-with-a-long-random-payment-token
INSTAMOVE_ADMIN_TOKEN=replace-with-a-long-random-admin-token
INSTAMOVE_ENCRYPTION_KEY=replace-with-64-hex-characters
```

The payment token can call `POST /request`. The admin token can call payment endpoints and protected node or Bluetooth endpoints. A payment token cannot activate nodes or operate Bluetooth endpoints.

Both tokens must be at least 24 characters, must not use the example placeholder values, and must be different from each other. Readiness fails closed when these requirements are not met.

Payment and invoice-creation requests require an `Idempotency-Key` header containing 8 to 128 safe characters. Reusing the same key and body returns the original response; reusing a key with a different body returns HTTP 409.

Request bodies use strict schemas. Unknown fields, malformed invoices, invalid encrypted payloads, and amounts outside `1..MAX_PAYMENT_SATS` are rejected before payment.

Encrypted request payloads use versioned AES-256-GCM envelopes. `INSTAMOVE_ENCRYPTION_KEY` must decode to exactly 32 bytes and is never stored in the repository. Generate a key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Service Probes

- `GET /health` reports process liveness.
- `GET /ready` verifies Lightning configuration, live LND connectivity and synchronization, SQLite access, authentication roles, and the selected Bluetooth backend.

Readiness returns HTTP 503 until every required runtime dependency is correctly configured. Neither probe exposes credentials, invoice data, or upstream LND error bodies.

In real LND modes, readiness calls authenticated `GET /v1/getinfo` and requires chain and graph synchronization. Regtest also requires the reported Bitcoin network to be `regtest`. Probes have a bounded timeout, do not retry, and do not cache successful results. Mock mode skips upstream calls; `/health` remains independent of LND. Readiness does not guarantee liquidity or a route for a particular payment.

## Bluetooth Modes

| Mode | Behavior |
| --- | --- |
| `simulated` | Development default; no radio traffic. Readiness accepts it only with mock Lightning. |
| `windows` | Native Windows GATT peripheral with encrypted requests and session-specific responses. Requires a helper binary, compatible adapter, and separate Bluetooth key. |
| `disabled` | Explicit HTTP-only operation. Bluetooth endpoints are unavailable. |

To build the Windows x64 helper, install the .NET 10 SDK on Windows 10 build 19041 or newer, then run:

```powershell
npm run build:bluetooth:windows
./native/windows-bluetooth/publish/InstaMove.Bluetooth.exe --check
$env:BLUETOOTH_MODE = 'windows'
# Load a separately provisioned 32-byte hexadecimal key shared with authorized clients:
$env:INSTAMOVE_BLUETOOTH_KEY = '<64 hexadecimal characters>'
npm start
```

The helper is self-contained after publishing; generated binaries are ignored by Git and must be built or packaged for deployment. Missing hardware, keys, or helper processes fail readiness without falling back to simulation. Windows mode disables HTTP injection into Bluetooth and uncorrelated response broadcasts.

The implemented `instamove-psk/1` protocol uses authenticated Windows link security and AES-256-GCM with a separately provisioned shared key. It is for trusted devices and does not implement the draft Noise/CBOR protocol, per-client revocation, forward secrecy, or deferred offline settlement. Follow the [Windows setup and client protocol guide](docs/WINDOWS_BLUETOOTH.md) for UUIDs, framing, pairing, and validation requirements.

## Request

Send an authenticated POST request to `/request` with a JSON body containing `paymentRequest`.

```bash
curl -X POST http://localhost:4000/request \
  -H "Authorization: Bearer $INSTAMOVE_PAYMENT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: payment-2026-0001" \
  -d '{"paymentRequest":"lnbcrt5000u1instamoved8353f1c82f4a3bb"}'
```

Example:

```json
{
	"paymentRequest": "lnbcrt5000u1instamoved8353f1c82f4a3bb"
}
```

Creating an invoice no longer opens a Lightning channel or pays that invoice from the same node. Created invoices remain pending until an external payer settles them. Channel management must be performed separately from the request flow.

## Design And Operations

- [Offline payment protocol](docs/OFFLINE_PAYMENT_PROTOCOL.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Operations guide](docs/OPERATIONS.md)
- [Native Windows Bluetooth setup and protocol](docs/WINDOWS_BLUETOOTH.md)
