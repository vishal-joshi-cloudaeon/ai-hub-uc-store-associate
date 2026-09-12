# SAW Loyalty Agent — Frontend

React + TypeScript frontend for the SAW Loyalty Agent showcase: a retail AI demo
with two standalone pages — a Store Manager chat interface talking to an Azure
AI Foundry agent, and a Cluster Head approval console for the human-in-the-loop
voucher approval flow. Both pages are environment-aware (`dev`/`prod`) via a
URL prefix — see [Environment routing](#environment-routing) below.

The two pages share no layout or navigation — they are meant to be opened as
separate tabs/devices for the demo (manager on one screen, cluster head on
another).

## Tech stack

- React 18 + TypeScript, React Router v6, Tailwind CSS, Axios, Vite (this repo)
- `server/` — a small Node/Express proxy that holds the Azure identity used to
  call the Foundry Agent Responses API, so no token/secret reaches the browser
- `approvals-service/` — a Python/FastAPI backend for the approvals flow,
  reading/writing real Databricks Unity Catalog tables

## Project structure

```
src/
├── pages/
│   ├── ManagerChat.tsx       # /:env/manager — chat UI
│   └── ClusterHead.tsx       # /:env/cluster-head — approvals UI
├── components/
│   ├── ChatMessage.tsx       # user/agent bubble rendering
│   ├── ToolCallPanel.tsx     # collapsible tool call detail
│   ├── StateBadge.tsx        # message state pill
│   ├── ApprovalCard.tsx      # approval card + approve/deny actions
│   ├── DenyModal.tsx         # deny reason modal
│   ├── EnvBadge.tsx          # DEV/PROD pill shown in both page headers
│   └── EnvGuard.tsx          # redirects to /dev/manager on an invalid :env
├── hooks/
│   ├── useAgentChat.ts       # chat state + sendMessage orchestration
│   ├── useApprovalPolling.ts # single-approval + pending-list polling
│   └── useEnv.ts             # resolves the current :env route param safely
├── api/
│   ├── agent.ts              # calls server/'s proxy (Foundry Responses API)
│   └── approvals.ts          # approvals-service client
├── config/environments.ts    # per-env frontend config (badge style, approvals URL)
├── types/index.ts
├── App.tsx                   # routes: / -> /dev/manager, /:env/manager, /:env/cluster-head
└── main.tsx

server/                       # Node proxy — see server/README or inline comments
approvals-service/            # Python/FastAPI backend — see approvals-service/README.md
```

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

Both `server/` (the agent proxy) and `approvals-service/` (the approvals
backend) are **single running instances that serve both environments** —
each request carries which environment it's for (`env` in the request body/
query string for the frontend's own calls, an `X-Environment` header for the
Foundry agent's tool calls into `approvals-service`), and the backend picks
the matching Foundry project / Databricks workspace server-side. See
`server/.env.example` and `approvals-service/.env.example` for the per-env
config each one needs.

## Environment variables (this repo)

Copy `.env.example` to `.env` and fill in real values — this file is
git-ignored and is never committed:

```
VITE_AGENT_API_URL             # Base URL of server/ (the agent proxy)
VITE_APPROVALS_API_URL_DEV     # Base URL of approvals-service, for /dev/*
VITE_APPROVALS_API_URL_PROD    # Base URL of approvals-service, for /prod/*
VITE_POLL_INTERVAL_MS=5000     # Poll interval for approval status
```

`VITE_APPROVALS_API_URL_DEV`/`_PROD` are normally the **same** value — one
`approvals-service` instance handles both, switching Databricks connections
per-request. Only split them if you actually deploy separate instances.

All variables are injected at build time by Vite (`import.meta.env.*`).
Nothing is hardcoded in source — if a variable is missing, the relevant API
calls will fail with a clear network error surfaced inline in the chat/list
rather than crashing the app.

## Running locally

You need three processes running (in separate terminals):

```bash
# 1. This frontend
npm install
cp .env.example .env   # then fill in real values
npm run dev             # http://localhost:5173

# 2. The agent proxy (talks to Azure AI Foundry)
cd server && npm install && cp .env.example .env && npm run dev   # :8787

# 3. The approvals backend (talks to Databricks)
cd approvals-service && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && cp .env.example .env
python app.py   # :8000
```

Visit `http://localhost:5173` — it redirects to `/dev/manager`. There is no
demo/mock data anywhere in the app; every message and every approval is a
real call to a real backend from the first interaction onward.

## Notes on the Foundry Agent integration

`server/src/agentProxy.ts` calls Azure AI Foundry's **Responses API**
(`POST /openai/responses`, not the classic Assistants threads/runs API) using
its own Azure AD identity (`DefaultAzureCredential`) — the browser never
holds a Foundry token or API key. Multi-turn continuity is a
`previous_response_id` pointer carried forward per `(store, env)` pair in
`src/api/agent.ts`, rather than a server-side "thread" resource.

Message **state** is detected heuristically from the assistant's response
text (see `detectState` in `src/api/agent.ts`):

| Signal in response text | State |
|---|---|
| `blocked`, `data policy`, `pii` | `blocked` |
| a real `APR-XXXX` id **and** one of `awaiting approval`/`cluster head`/`approval request` | `awaiting_approval` |
| `✓` + `approved` | `approved` |
| `✗` + `denied` | `denied` |
| otherwise | `completed` |

A request that fails outright (network error, Foundry 4xx/5xx) surfaces as
a distinct `error` state — not `blocked`, which is reserved for the agent
deliberately refusing on data-policy/PII grounds.
