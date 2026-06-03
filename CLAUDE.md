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
- `src/features/<domain>/` — business logic per domain (`auth`, `agent`, `plugin`, `knowledge`, `chat-admin`, `dashboard`). Each owns its `api.ts`, `types.ts`, `components/`, `hooks/`, `utils/`. This is where real work happens.
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
`MePermissions` (`GET /admin/me/permissions`) drives access. `ModuleRoute` (`src/router/ModuleRoute.tsx`) gates each console route by module key (`AGENT_MODULE`, `PLUGIN_MODULE`, `KB_MODULE`, `CHAT_MODULE`); super-admins bypass. It shares the `['me','permissions']` react-query cache with the sidebar and is **fail-open** (allows on fetch error — backend is the real gate). This is defense-in-depth, not the security boundary.

### Plugin wire ⇄ model conversion
`src/features/plugin/api.ts` does **bidirectional transformation at the API edge.** Backend `ToolWithMapping` DTO sends `inputSchema`/`headersTemplate`/`queryTemplate` as **JSON-encoded strings**; the front-end works with objects + enums. Sending objects directly makes Jackson throw `HttpMessageNotReadableException`. Keep new plugin fields flowing through these converters.

## Routing map (`src/router/index.tsx`)
`/login` · `/console/{dashboard,agents,agents/:id,plugins,plugins/:id,knowledge,knowledge/:kbId,playground/:agentId?}` (admin console) · `/chat`, `/chat/agent/:agentId`, `/chat/c/:conversationId` (end-user). All non-login routes wrapped in `ProtectedRoute`; console + chat modules also wrapped in `ModuleRoute`. Pages are `lazy()`-loaded.

## Deploy / SSE-sensitive serving
Built into an nginx image (`Dockerfile`). Two nginx configs, selected by `ARG NGINX_CONF`:
- `nginx.deploy.conf` (default) — backend at the **production** gateway `host.docker.internal:20011` (single-host / local Mac; published 20011→container 10011, host 10011 left for the local IDE so the deployed front-end never hits your dev backend)
- `nginx.conf` — backend at `data-service-gateway:8080` (docker-compose network)

**SSE requires `proxy_buffering off` + `X-Accel-Buffering: no` + long `proxy_read_timeout`** in nginx, or streaming stalls. `client_max_body_size 100m` for document uploads. SPA fallback `try_files $uri /index.html`. Push to `main` auto-deploys via self-hosted runner (`.github/workflows/deploy.yml`).

## Conventions
- ESLint is strict (`--max-warnings 0`); `@typescript-eslint/no-explicit-any` is intentionally off. Run `npm run lint` before considering work done.
- Comments in this codebase are in Chinese and frequently explain backend contracts/gotchas — read them before changing interceptors, auth, or plugin conversion.
