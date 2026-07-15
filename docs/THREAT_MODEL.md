# InstaMove Threat Model

Status: Draft  
Applies to: HTTP API, BLE transport, local persistence, and LND integration

## Security Objectives

- Never report a payment as settled without LND confirmation.
- Prevent unauthorized payment, node, and Bluetooth operations.
- Prevent replayed or modified requests from creating a second payment.
- Keep access tokens, macaroons, encryption keys, preimages, and invoice data out of logs.
- Preserve a durable audit trail without storing unnecessary secrets.

## Assets

- LND macaroon and REST endpoint.
- Payment and administrative bearer tokens.
- `INSTAMOVE_ENCRYPTION_KEY` and future BLE identity keys.
- Invoice, payment hash, preimage, amount, destination, and settlement state.
- Idempotency records and deferred authorizations.
- Node inventory and network addresses.

## Trust Boundaries

1. Browser to InstaMove HTTP server.
2. BLE peer to merchant peripheral.
3. InstaMove process to local JSON or future database storage.
4. InstaMove process to LND REST.
5. Runtime environment to deployment secret store.

## Threats And Controls

### Spoofed API Clients

**Threat:** an attacker submits payments or changes the active node.  
**Controls:** distinct bearer roles, constant-time token comparison, minimum token quality, per-IP rate limits, strict schemas, and TLS at the deployment boundary.

### Token Role Collision

**Threat:** the same token is configured for payment and admin roles.  
**Controls:** readiness and authorization fail closed when role tokens match or use placeholder values.

### Payment Replay

**Threat:** retries or duplicated BLE frames trigger multiple payments.  
**Controls:** required idempotency keys, request fingerprints, persistent results, BLE sequence numbers, replay cache, and no automatic POST retries.

### Message Tampering

**Threat:** stored or transmitted request data is modified.  
**Controls:** AES-256-GCM envelopes at rest, Noise authenticated transport for BLE, strict envelope versions, and canonical serialization.

### False Settlement

**Threat:** local delivery or authorization is presented as Lightning settlement.  
**Controls:** explicit state machine, LND as source of truth, failed LND responses remain failed, and deferred flows use `authorized_offline`.

### Secret Disclosure

**Threat:** logs or API errors expose credentials or upstream response bodies.  
**Controls:** structured redaction, sanitized public errors, bounded LND responses, CSP, no-referrer policy, and environment-backed secrets.

### Denial Of Service

**Threat:** oversized JSON, BLE fragments, slow LND responses, or repeated requests exhaust resources.  
**Controls:** body and message size limits, response bounds, timeouts, rate limiting, fragment caps, and bounded retry counts.

### Malicious LND Endpoint

**Threat:** a configured endpoint stalls, returns oversized data, or provides malformed JSON.  
**Controls:** HTTPS certificate verification by default, request timeout, maximum response size, JSON validation, sanitized errors, and GET-only retries.

### Local File Compromise

**Threat:** an attacker reads or modifies JSON persistence.  
**Controls:** authenticated encryption for sensitive payloads, atomic writes, least-privilege filesystem permissions, and migration to transactional storage before production.

### Compromised BLE Peer

**Threat:** a nearby device impersonates a merchant or payer.  
**Controls:** Noise XX, out-of-band fingerprint confirmation, rotating discovery identifiers, session expiry, sequence enforcement, and no trust in BLE link encryption alone.

## Residual Risks

- JSON files do not provide cross-process transactions or durable payment reconciliation.
- Simulated Bluetooth does not validate real adapter, operating-system, or radio behavior.
- Bearer tokens require TLS and secure operator handling in deployed environments.
- Deferred settlement introduces liquidity, expiry, and double-spend business risk that cryptography alone does not solve.
- A compromised host process can access runtime secrets and plaintext during legitimate processing.

## Production Security Gates

- External review of the BLE protocol and implementation.
- Transactional database with encrypted backups and reconciliation jobs.
- TLS termination, secret manager integration, and token rotation procedure.
- Least-privilege LND macaroon dedicated to required RPC methods.
- Alerting on repeated authentication failures, payment conflicts, and readiness failures.
- Incident response and recovery testing.
