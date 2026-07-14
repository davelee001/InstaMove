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

The server runs on port 3000.

## Request

Send a POST request to `/request` with a JSON body containing `paymentRequest`.

Example:

```json
{
	"paymentRequest": "lnbcrt5000u1instamoved8353f1c82f4a3bb"
}
```
