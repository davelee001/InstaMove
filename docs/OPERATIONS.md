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
