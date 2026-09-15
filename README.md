# SAW Loyalty Agent — UC Store Associate

A retail AI showcase with two standalone pages — a Store Manager chat
interface talking to an Azure AI Foundry agent, and a Cluster Head approval
console for the human-in-the-loop voucher approval flow. Both pages are
environment-aware (`dev`/`prod`) via a URL prefix — see
[Environment routing](#environment-routing) below.

The two pages share no layout or navigation — they are meant to be opened as
separate tabs/devices for the demo (manager on one screen, cluster head on
another).

Everything is **one Node project** that builds to **one Azure Web App**: the
React SPA, the Foundry agent proxy, the approvals API, and the OpenAPI tool
endpoints the Foundry agent calls, all served by a single Express process.

## Tech stack

- **Frontend** — React 18 + TypeScript, React Router v6, Tailwind CSS, Axios, Vite
- **Backend** — Node/Express + TypeScript, Axios, zod
- **Data** — Databricks Unity Catalog, over the SQL Statement Execution REST
  API (no driver, so there are no native modules to build at deploy time)
- **Agent** — Azure AI Foundry Agent Service, reached through APIM (dev) or
  directly with an Entra ID token (prod)

## Project structure

```
src/                             # React SPA (browser)
├── pages/
│   ├── ManagerChat.tsx          # /:env/manager — chat UI
│   └── ClusterHead.tsx          # /:env/cluster-head — approvals UI
├── components/                  # ChatMessage, ToolCallPanel, StateBadge,
│                                # ApprovalCard, DenyModal, EnvBadge, EnvGuard
├── hooks/                       # useAgentChat, useApprovalPolling, useEnv
├── api/
│   ├── agent.ts                 # -> /agent/responses on this app's backend
│   └── approvals.ts             # -> /api/approvals on this app's backend
├── config/environments.ts       # per-env frontend config
├── App.tsx                      # routes: / -> /dev/manager, /:env/manager, /:env/cluster-head
└── main.tsx

server/src/                      # Express backend (Node)
├── index.ts                     # single listener: SPA + all API routes
├── agentProxy.ts                # /agent/*  — Azure AI Foundry proxy
├── azureToken.ts                # DefaultAzureCredential token cache (prod path)
└── approvals/
    ├── databricks.ts            # OAuth per workspace + SQL Statement Execution API
    ├── config.ts                # catalog/schema, dev|prod resolution
    ├── models.ts                # zod request schemas + row -> Approval mapping
    ├── http.ts                  # FastAPI-shaped { detail } errors, async wrapper
    ├── approvalsRouter.ts       # /api/approvals/*  — the cluster-head console
    └── toolsRouter.ts           # /tools/*          — the Foundry agent's tools

dist/                            # build output (git-ignored)
├── public/                      # vite build — the SPA
└── server/                      # tsc build — run with `npm start`
```

## HTTP surface

One process, one port, four route groups:

| Route | Called by | Purpose |
|---|---|---|
| `GET /healthz` | anything | liveness |
| `POST /agent/responses` | the SPA | proxies to Foundry/APIM; holds the Azure identity so no token reaches the browser |
| `GET/PATCH /api/approvals[/:id]` | the SPA | list, read and resolve approvals |
| `POST /tools/request_approval` | the **Foundry agent** | creates a pending approval row |
| `POST /tools/send_loyalty_voucher` | the **Foundry agent** | issues voucher rows once approved |
| everything else | browsers | the SPA, with a deep-link fallback to `index.html` |

`/api/approvals` and `/tools/*` both take the environment per request —
`?env=dev|prod` for the SPA, an `X-Environment` header for the agent — and
pick the matching Databricks workspace server-side.

### Access control

- **`/api/approvals`** is same-origin with the SPA and carries no shared
  secret; a browser can only ship one in its own bundle, so it wouldn't be
  one. Protect it with the Web App's own authentication (App Service
  Authentication / Easy Auth), which protects the SPA at the same time.
- **`/tools/*`** is reachable by anything that can resolve the Web App's URL
  and writes to Databricks. Set **`TOOLS_API_KEY`** and have Foundry/APIM
  send it as an `X-Api-Key` header. It is enforced **only when set**, so an
  existing agent registration keeps working until that header is added.

### Agent connection overrides (settings panel)

The manager chat's gear icon (next to the clear-chat button) opens a small
panel with three optional fields — **Endpoint**, **Agent ID** and
**Subscription key** — so a session can be pointed at a different APIM route,
a different agent or a different subscription key without a redeploy or an
`.env` change. Useful for testing a newly provisioned gateway route.

- Values are kept in `localStorage`, **per environment** (`/dev/manager` and
  `/prod/manager` each have their own set) and per browser.
- Each field is independent: whatever is left blank falls back to that
  environment's configured `FOUNDRY_AGENT_ENDPOINT_*` /
  `FOUNDRY_AGENT_ID_*` / `APIM_SUBSCRIPTION_KEY_*`.
- They travel as an optional `overrides` object on the existing
  `POST /agent/responses` body (`endpoint`, `agent_id`, `subscription_key`);
  the proxy merges them over `ENV_CONFIG` in `server/src/agentProxy.ts`. The
  outbound request shape is unchanged, and a request without `overrides`
  behaves exactly as before.
- **Save** applies the values and starts a fresh conversation (a
  `previous_response_id` from one agent can't be continued on another);
  **Clear** removes them and returns to the server's configuration. A dot on
  the gear icon shows when custom values are in use.
- A failed send says which layer failed and points back at this panel —
  nothing configured, endpoint unreachable, key rejected, route not found, or
  a gateway rejection. An error from the agent *itself* (a Foundry
  `error.code`, e.g. `tool_user_error`) is shown as-is, since the connection
  worked and the panel isn't the fix.
- Note this means a subscription key typed into the panel is held in that
  browser and sent to the app's own proxy on each call. It's a
  testing/demo affordance — the server's own configured keys remain the
  default path and are never exposed to the browser.

## Environment routing

Every page lives under an environment prefix:

```
/                  -> redirects to /dev/manager
/dev/manager        /prod/manager
/dev/cluster-head   /prod/cluster-head
```

An invalid `:env` (anything but `dev`/`prod`) redirects to `/dev/manager`.
There's no UI toggle — the environment comes from the URL only. Switching
stores on the manager page starts a new agent conversation but stays on the
same `:env`.

The backend is a **single instance serving both environments**. `dev` and
`prod` are two entirely separate Databricks workspaces, each with its own
OAuth service principal; a workspace that isn't fully configured is skipped
at startup rather than blocking the other one, and its endpoints then return
a clear error instead of failing at boot.

## Environment variables

Copy `.env.example` to `.env` and fill in real values — `.env` is git-ignored
and never committed. `VITE_*` variables are read at **build** time and baked
into the browser bundle (never put a secret in one); everything else is
server-side only and read at startup.

See `.env.example` for the full annotated list. The essentials:

| Variable | Purpose |
|---|---|
| `FOUNDRY_AGENT_ENDPOINT_DEV` / `_PROD`, `FOUNDRY_AGENT_ID_DEV` / `_PROD` | which Foundry project and agent each environment routes to |
| `APIM_SUBSCRIPTION_KEY_DEV` | auth for the dev path through the APIM gateway |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | only to force an app registration; leave unset to use a managed identity |
| `DATABRICKS_SERVER_HOSTNAME_*`, `DATABRICKS_HTTP_PATH_*`, `DATABRICKS_CLIENT_ID_*`, `DATABRICKS_CLIENT_SECRET_*` | one set per workspace, suffixed `_DEV` / `_PROD` |
| `CATALOG`, `SCHEMA` | Unity Catalog location of `dim_approval` and `dim_voucher_issued` |
| `TOOLS_API_KEY` | optional shared secret on `/tools/*` |
| `VITE_POLL_INTERVAL_MS` | approval/status poll interval |

`VITE_AGENT_API_URL` and `VITE_APPROVALS_API_URL_DEV` / `_PROD` exist as
escape hatches for hosting the frontend separately. Leave them unset: the SPA
then calls its own origin, which is what the combined deployment wants.

## Running locally

```bash
npm install
cp .env.example .env   # then fill in real values
npm run dev
```

`npm run dev` starts both halves: Vite on **:5173** and the Express backend on
**:8787**. Vite proxies `/agent`, `/api`, `/tools` and `/healthz` through to
the backend, so the frontend's API calls are same-origin-relative in dev
exactly as they are in production — there is no dev-only base URL to keep in
sync.

Visit `http://localhost:5173` — it redirects to `/dev/manager`. There is no
demo or mock data anywhere in the app; every message and every approval is a
real call to a real backend from the first interaction onward.

To run the production build locally instead:

```bash
npm run build && npm start   # http://localhost:8787 — SPA and APIs on one port
```

## Deploying to Azure Web App

**Current deployment** (subscription `sub-cde-ms-innov-nonprod-001`):

| | |
|---|---|
| URL | https://dta-euw-prod-app-uc-store-associate.azurewebsites.net |
| Resource group | `dta-euw-prod-rg-ai-01` (West Europe) |
| App Service plan | `dta-euw-prod-asp-ai-01` — B1 Linux, shared with 3 sibling AI apps |
| Runtime / startup | `NODE|22-lts` / `npm start` |

Redeploy after a change:

```bash
git archive --format=zip -o deploy.zip $(git write-tree)
az webapp deploy -g dta-euw-prod-rg-ai-01   -n dta-euw-prod-app-uc-store-associate --src-path deploy.zip --type zip
```

`git archive` off the index keeps `node_modules`, `dist` and `.env` out of the
package automatically. The sync request often returns **504 while the build is
still running** — that's a client timeout, not a failure; poll the deployment
status instead of re-deploying.

The generic steps below are for standing up a *new* app.


Target: **App Service on Linux, Node 20 LTS or newer**. The build runs on the
Web App (Oryx), so nothing but source needs to be uploaded.

**1. Create the Web App** (once):

```bash
az webapp up \
  --name <app-name> \
  --resource-group <resource-group> \
  --runtime "NODE:22-lts" \
  --sku B1
```

**2. Let Oryx build on deploy** — without this, `dist/` is never produced:

```bash
az webapp config appsettings set -g <resource-group> -n <app-name> \
  --settings SCM_DO_BUILD_DURING_DEPLOYMENT=true
```

Oryx runs `npm install` and then `npm run build`, which produces
`dist/public` (the SPA) and `dist/server` (the compiled backend).

**3. Set the startup command:**

```bash
az webapp config set -g <resource-group> -n <app-name> \
  --startup-file "node dist/server/index.js"
```

**4. Set the application settings.** Everything from `.env.example` except
the `VITE_*` build-time variables, which are baked in during step 2 and so
must be present *before* the build if you override their defaults:

```bash
az webapp config appsettings set -g <resource-group> -n <app-name> --settings \
  FOUNDRY_AGENT_ENDPOINT_DEV="..." FOUNDRY_AGENT_ID_DEV="Loyalty-Agent" \
  APIM_SUBSCRIPTION_KEY_DEV="..." \
  FOUNDRY_AGENT_ENDPOINT_PROD="..." FOUNDRY_AGENT_ID_PROD="Loyalty-Agent" \
  FOUNDRY_API_VERSION="2025-05-15-preview" \
  AZURE_TOKEN_SCOPE="https://ai.azure.com/.default" \
  DATABRICKS_SERVER_HOSTNAME_DEV="..." DATABRICKS_HTTP_PATH_DEV="..." \
  DATABRICKS_CLIENT_ID_DEV="..." DATABRICKS_CLIENT_SECRET_DEV="..." \
  CATALOG="dev" SCHEMA="retail" \
  TOOLS_API_KEY="..."
```

Store real credentials as Key Vault references rather than literal values
where you can. `PORT` is injected by App Service — don't set it. Leave
`CORS_ORIGIN` unset: everything is same-origin.

**5. Give the app an identity for the prod Foundry path:**

```bash
az webapp identity assign -g <resource-group> -n <app-name>
```

Then grant that identity an RBAC role (e.g. *Azure AI Developer*) on the
Foundry project. `DefaultAzureCredential` picks the managed identity up with
no configuration, so `AZURE_CLIENT_SECRET` and friends can stay unset. The
dev path uses the APIM subscription key instead and needs no identity.

**6. Deploy:**

```bash
az webapp up -g <resource-group> -n <app-name>
```

**7. Turn on authentication** for the site (Azure portal → the Web App →
Authentication → add an identity provider, require authentication). This is
what protects `/api/approvals` and the console itself — see
[Access control](#access-control). If you do this, exclude `/tools/*` from
it, or the Foundry agent's tool calls will be redirected to a login page;
that path is protected by `TOOLS_API_KEY` instead.

**8. Repoint the Foundry agent's OpenAPI tools** at
`https://<app-name>.azurewebsites.net/tools/request_approval` and
`.../tools/send_loyalty_voucher`, and add the `X-Api-Key` header if you set
`TOOLS_API_KEY`. The request/response shapes are unchanged from the previous
Python service, so the registered tool schemas themselves don't need editing.

Verify with `curl https://<app-name>.azurewebsites.net/healthz` →
`{"ok":true}`, then check the log stream (`az webapp log tail`) for
`Databricks environments configured at startup: dev` and a token-refresh
line.

## Notes on the Foundry Agent integration

`server/src/agentProxy.ts` calls Azure AI Foundry's **Responses API**
(`POST /openai/responses`, not the classic Assistants threads/runs API). The
`prod` path authenticates with this app's own Azure AD identity
(`DefaultAzureCredential`); the `dev` path goes through the APIM "AI Hub"
gateway with a subscription key. Either way the browser never holds a Foundry
token or API key. Multi-turn continuity is a `previous_response_id` pointer
carried forward per `(store, env)` pair in `src/api/agent.ts`, rather than a
server-side "thread" resource.

Message **state** is detected heuristically from the assistant's response
text (see `detectState` in `src/api/agent.ts`):

| Signal in response text | State |
|---|---|
| `blocked`, `data policy`, `pii` | `blocked` |
| a real `APR-XXXX` id **and** one of `awaiting approval`/`cluster head`/`approval request` | `awaiting_approval` |
| `✓` + `approved` | `approved` |
| `✗` + `denied` | `denied` |
| otherwise | `completed` |

A request that fails outright (network error, Foundry 4xx/5xx) surfaces as a
distinct `error` state — not `blocked`, which is reserved for the agent
deliberately refusing on data-policy/PII grounds.

## Notes on the Databricks integration

`server/src/approvals/databricks.ts` replaces what was a Python/FastAPI
service using `databricks-sql-connector`. Statements now go over the **SQL
Statement Execution REST API** (`POST /api/2.0/sql/statements`), which keeps
the dependency tree to plain HTTP — nothing native to compile on the Web App.

- Auth is **Azure AD service-principal client-credentials OAuth** per
  workspace (not a static PAT). A token is fetched for each configured
  environment at startup and refreshed before it expires, with a lazy
  fallback so a request never fails because the timer hasn't run yet.
- `DATABRICKS_HTTP_PATH_*` is still the full
  `/sql/1.0/warehouses/<id>` path; the warehouse id is parsed off the end.
- Values are typed on the way out (`DECIMAL`/`DOUBLE` → number, `TIMESTAMP` →
  a **UTC-marked ISO string**). That last one matters: Databricks renders a
  timestamp as zone-less UTC wall-clock text, which a browser would otherwise
  parse as local time and silently shift by the viewer's UTC offset.
- Bound parameters carry an explicit SQL type (`sql.string` / `sql.double` /
  `sql.int` in `databricks.ts`) rather than being inferred, so a money value
  can't be bound as an integer.
