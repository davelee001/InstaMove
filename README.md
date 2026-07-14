# InstaMove

InstaMove is a Node.js backend and landing page for testing Lightning-style invoice flows, local node requests, and Bluetooth-style JSON exchange.

It accepts a request, processes the payload, and returns a JSON response. In local mode, the app recognizes built-in invoice IDs that map to fixed amounts.

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

Regtest keeps the payment flow off real money while still using real Lightning APIs when your regtest LND nodes are connected.

## Local Invoices

The current built-in local invoice IDs are:

- `lnbcrt10000u1instamovefc1a2cb6ab734c15` for 10,000 sats
- `lnbcrt5000u1instamoved8353f1c82f4a3bb` for 5,000 sats
- `lnbcrt10u1instamove7edd898728b93fc5` for 10 sats

These are local identifiers used by InstaMove to simulate invoice handling.

## Run

```bash
npm install
npm start
```

The server runs on port 4000.

Before using protected endpoints, configure separate bearer tokens for payment and administrative access:

```bash
INSTAMOVE_PAYMENT_TOKEN=replace-with-a-long-random-payment-token
INSTAMOVE_ADMIN_TOKEN=replace-with-a-long-random-admin-token
```

The payment token can call `POST /request`. The admin token can call payment endpoints and protected node or Bluetooth endpoints. A payment token cannot activate nodes or operate Bluetooth endpoints.

Payment and invoice-creation requests require an `Idempotency-Key` header containing 8 to 128 safe characters. Reusing the same key and body returns the original response; reusing a key with a different body returns HTTP 409.

Request bodies use strict schemas. Unknown fields, malformed invoices, invalid encrypted payloads, and amounts outside `1..MAX_PAYMENT_SATS` are rejected before payment.

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
