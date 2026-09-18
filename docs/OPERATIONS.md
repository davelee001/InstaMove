# InstaMove Operations

## Service Probes

- `GET /health` is a liveness probe. It confirms that the Node.js process can serve requests.
- `GET /ready` is a readiness probe. It verifies Lightning configuration, storage access, distinct authentication roles, and Bluetooth initialization.

Neither endpoint returns tokens, macaroons, node addresses, invoice data, or upstream error bodies.

## Logs

Logs are newline-delimited JSON written to stdout and stderr. Each HTTP completion event includes the request ID, method, route path, status code, duration, and authorization role. Sensitive fields are recursively redacted.

Production log collectors should index:

- `event`
- `requestId`
- `statusCode`
- `durationMs`
- `errorCode`
- `lightningMode`

Do not enable raw HTTP body logging at the proxy or container layer.

## Required Runtime Configuration

- `LIGHTNING_MODE`
- `INSTAMOVE_PAYMENT_TOKEN`
- `INSTAMOVE_ADMIN_TOKEN`
- `INSTAMOVE_ENCRYPTION_KEY` when encrypted payloads are accepted
- `LND_REST_URL` and `LND_MACAROON` for `regtest` or `lnd`

Payment and admin tokens must be at least 24 characters, must not use example placeholders, and must be different.

## LND Transport Controls

- `LND_REQUEST_TIMEOUT_MS` bounds each upstream attempt.
- `LND_MAX_RESPONSE_BYTES` prevents unbounded buffering.
- `LND_GET_RETRY_ATTEMPTS` applies only to safe GET requests.
- `LND_RETRY_DELAY_MS` controls linear retry backoff.
- `LND_ALLOW_INSECURE=true` disables certificate validation and must only be used in isolated regtest environments.

## Shutdown And Recovery

Stop accepting traffic before terminating the process. After restart, query LND for any payment whose local result is uncertain before submitting another payment. Never infer settlement from an interrupted HTTP response.

## Persistence And Migration

Runtime state is stored in SQLite at `INSTAMOVE_DB_PATH`, or `instamove.sqlite` under `INSTAMOVE_DATA_DIR` when no explicit path is configured. The database uses WAL journaling, full synchronous commits, foreign-key enforcement, and a five-second lock wait.

The first database initialization imports the legacy JSON collections and records a migration marker in the same transaction. JSON files are not read again after that marker is committed. Keep the legacy files until the migrated data has been verified, but do not edit them expecting runtime changes.

For a simple consistent backup, stop InstaMove cleanly and copy the SQLite database after shutdown has completed. For online backups, use a SQLite-aware backup tool rather than copying only the main file while WAL mode is active. Restore the database and its filesystem permissions before starting a single InstaMove instance for verification.

Completed idempotency records are retained for 24 hours by default; change this with `IDEMPOTENCY_RETENTION_MS`. Pending records are never expired automatically. They indicate that the process stopped after reserving a request but before durably recording its outcome. Reconcile the payment with LND before modifying such a record; automatic retry could duplicate a successful payment.

## Payment Confirmation

For the synchronous LND payment endpoint, InstaMove reports settlement only after
validating 32-byte base64 payment hash and preimage fields and checking that
SHA-256(preimage) matches both the returned hash and the decoded invoice's hash.
The preimage is never used as the public payment ID. Explicit upstream failures
remain failures; empty, malformed, contradictory, or incomplete confirmation
responses cannot produce a settled response.

An unusable payment response or a transport failure after dispatch returns
HTTP 502 with code `LND_PAYMENT_UNCONFIRMED`. This means the outcome is unknown,
not that no funds moved. The idempotency reservation stays pending, survives
restart, and does not expire with completed-record retention. Reusing its key
returns `IDEMPOTENCY_RECONCILIATION_REQUIRED` without dispatching another payment.
Do not submit the payment under a new key. Reconcile it with LND before manually
resolving its reservation. Automated reconciliation is not implemented.

This validation trusts the configured LND node to decode the requested invoice
correctly. It does not replace TLS verification or protect against a compromised
LND node. Existing stored results are not retroactively revalidated.

On upgrade, before idempotency retention cleanup runs, a transactional migration
preserves historical completed LND transport errors as pending records. This also
covers records imported from legacy JSON. Original error results, request
fingerprints, and creation times remain available as reconciliation evidence.
Because old records lack payment dispatch metadata, the migration conservatively
includes transport errors that may have occurred before dispatch. It runs once;
verified successes and explicit payment failures are unchanged. Stop older server
versions before upgrading so they cannot continue writing unsafe completed errors.
Records already deleted by an older version cannot be recovered by this migration.
New unconfirmed payment responses emit `operation_reconciliation_required` in the
structured log. A timeout is not evidence of failure: reconcile the original


Reference: [LND SendPaymentSync](https://api.lightning.community/api/lnd/lightning/send-payment-sync/index.html).
