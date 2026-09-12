# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

B2B SaaS Agent platform front-end (React 18 + TS + Vite 5, Ant Design 5), paired with the `data-service` backend. Multi-tenant. Three sibling front-ends share one backend (`front`/`admin`/`operator`); this repo is `front`. Node 20 (`.nvmrc`).

## Commands

```bash
npm run dev        # vite dev server on :5173, proxies /data -> VITE_API_TARGET
npm run build      # tsc -b && vite build  (typecheck is part of the build)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint, --max-warnings 0 (CI-strict; warnings fail)
npm run format     # prettier --write src/**
npm run preview    # serve the production build locally
```

No test runner is configured. `npm run dev` already points at the backend gateway via proxy — `.env.development` sets `VITE_API_TARGET=http://localhost:10011`. There is no per-test command because there are no tests.

## Architecture

### Layering
- `src/api/` — transport: axios client, raw-fetch SSE, shared types. **All other code calls features' `api.ts`, never axios/fetch directly.**
- `src/features/<domain>/` — business logic per domain (`auth`, `agent`, `skill`, `connection`, `knowledge`, `chat-admin`, `search`, `rbac`, `dashboard`). Each owns its `api.ts`, `types.ts`, `components/`, `hooks/`, `utils/`. This is where real work happens.
- `src/pages/` — thin route shells that compose feature components.
- `src/layouts/`, `src/router/`, `src/stores/` — chrome, routing, global auth state.
- Path alias `@` → `src` (configured in both `vite.config.ts` and `tsconfig.json`).

### API envelope and the 4001 trap
Backend wraps every response as `{ success, respCode, respMsg, data }`. The axios response interceptor (`src/api/client.ts`) **unwraps `.data` on success** so callers receive the payload directly, and throws `BizError(code, msg)` otherwise.

Critical, non-obvious rule (see the long comment in `client.ts` `isAuthError`): **only HTTP 401/403 means "session expired" → redirect to login.** Business code `4001` (`AUTHENTICATION_FAIL`) is reused by the backend for "no permission on this resource", "needs super-admin", "wrong old password", etc., and those come back as HTTP 200. Never redirect on a bare `respCode 4001` — doing so kicks members to login the moment they read back a resource they don't own. Don't "simplify" this check.

### Auth (`src/stores/authStore.ts` + `client.ts`)
- JWT is sent as the **raw token in `Authorization`, no `Bearer ` prefix** (backend contract). Plus `X-Tenant-Id` header.
- Zustand store persisted to `localStorage` key `jm-agent-auth`.
- **Sliding renewal:** the request interceptor decodes the JWT; when remaining life < 6h it fires a background `POST /admin/auth/refresh` and swaps the token via `renewToken` (which preserves `user`/`tenantId` — do not use `setAuth`, it nulls them). Any activity within the window keeps the session alive; ~6–12h fully idle expires it.

### SSE (streaming chat) — `src/api/sse.ts`
Streaming goes through **raw `fetch` + ReadableStream**, NOT axios, so it bypasses all interceptors. Therefore `sse.ts` manually re-applies the auth headers and reuses the exported `redirectToLogin` from `client.ts` to handle 401/403. If you change auth/logout behavior in `client.ts`, mirror it here.

The chat-admin SSE event protocol (`src/features/chat-admin/api.ts` `streamAnswer`, endpoint `POST /rag/answer`) multiplexes named events:
- `citations` — RAG source chunks
- `claude-delta` — native Claude SSE frames (`content_block_delta` → text)
- `message` — legacy OpenAI-like `{delta}`/`{text}` fallback
- `progress` — `{calls:[{id,name,desc,input,status:"running"}]}`: model is about to call tools
- `tool_result` — `{results:[{id,name,status,output}]}`: tool finished
- `error`

`useSSE` (`src/features/chat-admin/hooks/`) assembles these into **ordered `MessageSegment[]`** (`text` | `tool`) so the UI renders narration → tool call → answer in true interleaved order. Segments are persisted on the message so a page refresh restores the tool-call process (falls back to plain `content` when absent). Text deltas are batched via `requestAnimationFrame`.

### Module-level permissions
`MePermissions` (`GET /admin/me/permissions`) drives access. `ModuleRoute` (`src/router/ModuleRoute.tsx`) gates each console route by module key (`AGENT_MODULE`, `KB_MODULE`, `CHAT_MODULE` — that is the full list; `PLUGIN_MODULE` went away with the plugin subsystem); super-admins bypass. Routes that aren't module-gated (`skills`, `connections`, `traces`) either need only a session or do their own check — `/console/connections` is super-admin-only and gates itself on `perm.superAdmin` rather than a module key. It shares the `['me','permissions']` react-query cache with the sidebar and is **fail-open** (allows on fetch error — backend is the real gate). This is defense-in-depth, not the security boundary.

### The plugin subsystem is gone
`src/features/plugin/`, the plugin pages/routes/nav, `MePermissions.pluginIds`, the global-search `PluginHit` and the agent↔plugin binding were all removed when the backend dropped plugins. Skills replaced them: bind via **`/console/agents/:id` → 技能绑定** (`SkillBindPanel`, backed by `/admin/agent/agents/{id}/skills`). Anything still mentioning plugins is stale — the trace views keep `PLUGIN_TRIGGER` labels **on purpose**, only to render historical trace rows.

### Wire ⇄ model conversion at the API edge
Several backend DTOs send structured fields as **JSON-encoded strings** (e.g. `Connection.allowPaths` is a JSON array *string*, `allowMethods` is comma-separated). Each `features/<domain>/api.ts` converts at the edge so components work with real arrays/objects. Sending objects where the backend expects a string (or vice-versa) makes Jackson throw `HttpMessageNotReadableException`. Keep new fields flowing through these converters.

## Routing map (`src/router/index.tsx`)
`/login` · `/console/{dashboard,agents,agents/new,agents/:id,knowledge,knowledge/:kbId,playground/:agentId?,skills,skill/builder,connections,traces,feedback}` (admin console) · `/chat`, `/chat/agent/:agentId`, `/chat/c/:conversationId` (end-user). All non-login routes wrapped in `ProtectedRoute`; only the module-gated ones (agents / knowledge / chat) are additionally wrapped in `ModuleRoute`. Pages are `lazy()`-loaded.

## Deploy / SSE-sensitive serving
Served from an nginx image. **Two build paths, and CI uses the second one:**
- `Dockerfile` — self-contained multi-stage (npm install + vite build inside the image). For machines with spare memory / deploying elsewhere. **Do not add a `NODE_OPTIONS` heap cap here** — it only papers over one host's shortage and turns otherwise-fine builds into `JavaScript heap out of memory`.
- `Dockerfile.dist` — **what CI actually uses.** Assembly only: copies a `dist/` that the workflow already built natively on the runner host. The prod Mac's Docker VM (7.75G, mostly consumed by `ds-*` containers, ~1.6G available) cannot fit `vite build`'s ≥1.5G peak; there is no heap-cap/`--memory` combination that both succeeds and stays under the VM's headroom. Building on the host sidesteps it — macOS compresses memory instead of OOM-killing, so a build can never take down a prod container. `dist` is deliberately **not** in `.dockerignore` because of this.

Both paths pick an nginx config via `ARG NGINX_CONF`:
- `nginx.deploy.conf` (default) — backend at the **production** gateway `host.docker.internal:20011` (single-host / local Mac; published 20011→container 10011, host 10011 left for the local IDE so the deployed front-end never hits your dev backend)
- `nginx.conf` — backend at `data-service-gateway:8080` (docker-compose network)

**SSE requires `proxy_buffering off` + `X-Accel-Buffering: no` + long `proxy_read_timeout`** in nginx, or streaming stalls. `client_max_body_size 100m` for document uploads. SPA fallback `try_files $uri /index.html`. Push to `main` auto-deploys via self-hosted runner (`.github/workflows/deploy.yml`).

## Conventions
- ESLint is strict (`--max-warnings 0`); `@typescript-eslint/no-explicit-any` is intentionally off. Run `npm run lint` before considering work done.
- Comments in this codebase are in Chinese and frequently explain backend contracts/gotchas — read them before changing interceptors, auth, or the wire⇄model converters.
- `e2e/isolation-check.mjs` mints JWTs itself to switch identity without passwords; it reads the signing key from **`JWT_SECRET`** (must match the backend's `jwt.secret` in Nacos) and refuses to run without it. Never hardcode that key — it can sign a token for any tenant and any user.
