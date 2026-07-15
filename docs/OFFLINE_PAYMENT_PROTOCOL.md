# InstaMove Offline Payment Protocol

Status: Draft for implementation review  
Protocol identifier: `instamove/1`

## Scope

InstaMove uses Bluetooth Low Energy (BLE) as a local transport between a payer device and a merchant-side bridge. BLE removes the requirement for the payer device to reach the internet directly. It does not remove the Lightning Network's requirement for a connected node to verify and settle a payment.

Two operating models are supported:

1. **Connected bridge:** the merchant bridge has access to LND and can return a verified settlement receipt during the BLE session.
2. **Deferred settlement:** neither side can reach LND, so the bridge records an authorization for later forwarding. The UI must label this state `authorized_offline`, never `settled`.

## Roles

- **Payer:** scans or receives an invoice, approves an amount, and sends an authorization over BLE.
- **Merchant peripheral:** advertises the InstaMove service and exchanges framed protocol messages.
- **Bridge:** authenticates messages, enforces idempotency and limits, and forwards eligible requests to LND.
- **LND:** remains the source of truth for invoice decoding, payment state, and settlement.

## Session Establishment

Implement the session with a maintained Noise Protocol Framework library using the `Noise_XX` pattern. Do not implement custom key agreement.

1. The merchant advertises the InstaMove service UUID and a rotating, non-identifying discovery identifier.
2. The payer connects and both devices complete a Noise XX handshake using ephemeral X25519 keys.
3. The merchant identity fingerprint is confirmed out of band, such as a QR code displayed at the point of sale.
4. The derived session keys are held only for the session and erased after expiry or disconnect.
5. Application messages are encrypted and authenticated inside the Noise transport even when BLE link encryption is active.

## Message Envelope

Every logical message uses a canonical CBOR envelope before transport encryption:

```text
version:       unsigned integer, currently 1
type:          protocol message type
sessionId:     128-bit random value
messageId:     128-bit random value
sequence:      monotonically increasing unsigned integer
createdAt:     UTC epoch milliseconds
expiresAt:     UTC epoch milliseconds
senderKeyId:   rotating identity-key reference
payload:       type-specific canonical CBOR map
```

The authenticated envelope fields are associated data. A receiver rejects messages with an unsupported version, expired timestamp, repeated `messageId`, stale sequence number, wrong session, or invalid authentication tag.

## Message Types

- `session.ready`: confirms negotiated protocol and transport limits.
- `invoice.request`: requests an invoice for a bounded amount and optional memo.
- `invoice.present`: returns the BOLT11 invoice and expiry.
- `payment.authorize`: records payer approval for a specific invoice hash and amount.
- `payment.forwarded`: confirms that the bridge submitted the request to LND.
- `payment.settled`: includes the verified payment hash, amount, fee, and settlement time.
- `payment.deferred`: confirms durable local storage but explicitly does not claim settlement.
- `payment.status`: asks for the state of an existing `messageId`.
- `protocol.error`: returns a stable error code without internal details.

## BLE Framing

Logical messages may exceed the negotiated BLE MTU. Each encrypted message is split into frames containing:

```text
messageId | fragmentIndex | fragmentCount | payloadLength | payload | crc32
```

- `fragmentCount` is capped at 128.
- Reassembled messages are capped at 32 KiB.
- Frames received out of order may be buffered for at most 15 seconds.
- CRC32 detects transport corruption; the authenticated protocol envelope provides security.
- The receiver sends an ACK bitmap for missing fragments and discards incomplete messages on timeout.

## Payment State Machine

```text
discovered -> paired -> invoice_presented -> authorized
authorized -> forwarded -> settled -> receipt_delivered
authorized -> authorized_offline -> forwarded -> settled
any nonterminal state -> expired | failed
```

Only an LND-confirmed result may enter `settled`. Disconnects, local persistence, BLE delivery, and payer authorization are not settlement evidence.

## Idempotency And Replay Protection

- The BLE `messageId` becomes the HTTP `Idempotency-Key` when the bridge forwards a request.
- A repeated key with the same canonical payload returns the stored result.
- A repeated key with a different payload is a protocol conflict and terminates the session.
- Completed message IDs remain in the replay cache for at least the invoice expiry plus 24 hours.
- A payment retry queries LND payment status before any new submission.

## Failure Recovery

- After reconnect, the payer opens a new encrypted session and sends `payment.status` with the original message ID.
- The bridge returns only durable state. In-memory progress is never reported as final.
- Deferred authorizations are encrypted at rest and require an explicit forwarding policy.
- Expired invoices are never reissued or paid automatically; a new invoice requires new user approval.

## Implementation Gates

Real BLE support must not be enabled for value-bearing flows until the following exist:

- Noise XX integration using a maintained library.
- Hardware tests on every supported operating system.
- Durable replay and deferred-payment storage.
- LND status reconciliation after process restart.
- Protocol conformance fixtures for every message type.
- An independent security review of pairing and key management.
