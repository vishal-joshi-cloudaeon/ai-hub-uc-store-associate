# Loyalty Approvals Service

Real backend for the cluster-head approvals flow and the Foundry
Loyalty-Agent's `request_approval` / `send_loyalty_voucher` tools. All data
lives in Unity Catalog (`{CATALOG}.{SCHEMA}.dim_approval`,
`{CATALOG}.{SCHEMA}.dim_voucher_issued`) via `databricks-sql-connector` —
nothing is mocked or hardcoded.

This is a separate service from `server/` (the Node proxy that talks to the
Foundry chat agent). `server/agentProxy.ts` is unchanged and unrelated to this.

**One running instance serves both `dev` and `prod`** — dev and prod are two
entirely separate Databricks workspaces (each with its own OAuth service
principal), and this service picks the right one per-request rather than
being deployed twice.

## Endpoints

### Approvals API — called by the Cluster Head UI (`src/api/approvals.ts`)

```
GET   /api/approvals?status=pending&env=dev|prod
GET   /api/approvals?status=resolved&env=dev|prod
GET   /api/approvals/{approval_id}?env=dev|prod
PATCH /api/approvals/{approval_id}?env=dev|prod
```

`env` defaults to `dev` if omitted.

### Tools API — called by the Foundry Loyalty-Agent (OpenAPI tool, same
routing pattern as the existing `send_loyalty_voucher_v1` tool via APIM)

```
POST /tools/request_approval
POST /tools/send_loyalty_voucher
```

These read which environment to use from an `X-Environment: dev|prod`
header (not the request body) — that's what the Foundry tool registration
needs to send. Defaults to `dev` if absent/invalid. Registering these as
tools on the agent in the Foundry portal is a separate step (out of scope
here) — this service only implements what they call.

## Setup

```bash
cd approvals-service
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env   # fill in DATABRICKS_*_DEV at minimum; _PROD once that workspace exists
python app.py
```

Runs on `http://localhost:8000` by default — matches
`VITE_APPROVALS_API_URL_DEV`/`_PROD`'s existing default in the frontend
`.env`, so no frontend change is needed.

An environment that isn't fully configured (e.g. prod, before its
credentials exist) is skipped at startup rather than blocking the other one
— requests for that env will fail with a clear "not configured" error
instead of a crash, until it's filled in.

### Auth

Azure AD service-principal client-credentials OAuth per environment, not a
static PAT — dev and prod each need their own `DATABRICKS_CLIENT_ID_*`/
`DATABRICKS_CLIENT_SECRET_*` pair, since they're different Databricks
workspaces. At startup, `database.start_token_refresh_thread()` fetches a
token per *configured* environment from `{host}/oidc/v1/token` (fails fast
if credentials are wrong — you'll see it in the startup logs immediately
rather than on the first API call), then a background thread per
environment refreshes it before it expires, using whatever `expires_in`
Databricks actually returns. `_get_access_token()` is a lazy fallback that
refreshes on demand too, so a request never fails just because that
background thread hasn't run yet or died.

## curl examples

List pending approvals (dev):

```bash
curl "http://localhost:8000/api/approvals?status=pending&env=dev"
```

List resolved approvals (prod):

```bash
curl "http://localhost:8000/api/approvals?status=resolved&env=prod"
```

Get one approval:

```bash
curl "http://localhost:8000/api/approvals/APR-0001?env=dev"
```

Approve:

```bash
curl -X PATCH "http://localhost:8000/api/approvals/APR-0001?env=dev" \
  -H "Content-Type: application/json" \
  -d '{"status": "approved", "resolved_by": "Sarah Chen"}'
```

Deny:

```bash
curl -X PATCH "http://localhost:8000/api/approvals/APR-0001?env=dev" \
  -H "Content-Type: application/json" \
  -d '{"status": "denied", "resolved_by": "Sarah Chen", "reason_denied": "Budget exceeded for this period."}'
```

Simulate the agent requesting approval (matches the real registered tool's
schema — `customer_ids`/`voucher_value_gbp` as separate fields, not a
combined JSON blob):

```bash
curl -X POST "http://localhost:8000/tools/request_approval" \
  -H "Content-Type: application/json" -H "X-Environment: dev" \
  -d '{
    "store_id": "S004",
    "store_name": "SAW Leeds Central",
    "requested_by": "James Okafor",
    "action_type": "loyalty_voucher_batch",
    "customer_ids": ["C0001", "C0002"],
    "voucher_value_gbp": 100,
    "total_value_gbp": 200
  }'
```

Simulate the agent issuing vouchers after approval:

```bash
curl -X POST "http://localhost:8000/tools/send_loyalty_voucher" \
  -H "Content-Type: application/json" -H "X-Environment: dev" \
  -d '{
    "store_id": "S004",
    "customer_ids": ["C0001", "C0002"],
    "voucher_value_gbp": 100,
    "approval_id": "APR-0001",
    "approved_by": "Sarah Chen"
  }'
```

## Verified live against the real warehouse

Every endpoint has been run against the real dev `dim_approval` and
`dim_voucher_issued` tables (not just tested for shape): created real
approvals, listed them under `pending`, confirmed `GET
/api/approvals/{id}`, approved/denied via `PATCH`, confirmed rows moved to
`resolved` and `pending` reflected it, confirmed re-resolving an
already-resolved approval correctly 409s, then issued real vouchers via
`send_loyalty_voucher` and confirmed the rows in `dim_voucher_issued`
directly — including finding 6 pre-existing rows from earlier in the
project, which is how an extra `voucher_type`/`redemption_status` column
pair was discovered. The `env=dev`/`env=prod` split and the
not-yet-configured-prod-doesn't-crash-dev behavior are also verified live.

## Remaining assumptions / known gaps

- **Prod Databricks OAuth credentials aren't set yet** — `DATABRICKS_CLIENT_ID_PROD`/
  `DATABRICKS_CLIENT_SECRET_PROD` are empty in `.env`. The prod host/warehouse
  path are filled in, but prod requests will 500 with a clear "not configured"
  message until a prod service-principal exists and is granted access.
- **`send_loyalty_voucher`'s auto-execute path** (total ≤ £50, no approval
  needed): if `approval_id` doesn't match any row, this is treated as an
  auto-execute placeholder and allowed through. If a different sentinel value
  is actually used for that case, adjust the check in `routers/tools.py`.
- **`approval_id` generation** is `MAX(approval_id) + 1`, per-environment
  (dev and prod each have their own independent sequence, since they're
  separate tables in separate workspaces). Not race-safe under concurrent
  inserts (no DB-level uniqueness enforced here) — fine for expected volume.
- **Ordering**: pending approvals are returned newest-first
  (`requested_at DESC`); adjust if oldest-first (FIFO) is preferred.
