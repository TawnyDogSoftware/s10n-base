# S10N Base

S10N Base is a Bun + Turbo monorepo scaffold for a local-first app with a typed server boundary, web client, and optional desktop host.

It was derived from [`t3code`](https://github.com/pingdotgg/t3code), keeping the overall repo shape and developer workflow while removing product-specific coding-agent behavior.

## Current Stack

- Bun workspaces + Turbo
- Strict TypeScript across apps and packages
- `apps/server`: Node HTTP server with typed RPC, WebSocket activity stream, and SQLite persistence via `better-sqlite3`
- `apps/web`: React 19 + Vite + Tailwind CSS v4 + TanStack Router + TanStack Query
- `apps/desktop`: thin Electron wrapper around the server and web UI
- `packages/contracts`: shared Effect schemas and RPC contracts
- `packages/shared`: small cross-runtime helpers
- Oxlint + Oxfmt + Vitest

## Monorepo Layout

```text
apps/
  desktop/
  server/
  web/
packages/
  contracts/
  shared/
scripts/
```

## Requirements

- Bun `>=1.3.0`
- Node `>=24`

## Commands

Install dependencies:

```bash
bun install
```

Run the server and web app in development:

```bash
bun run dev
```

Run individual apps:

```bash
bun run dev:server
bun run dev:web
bun run dev:desktop
```

Build everything:

```bash
bun run build
```

Start built apps:

```bash
bun run start:server
bun run start:web
bun run start:desktop
```

Run checks:

```bash
bun run fmt
bun run fmt:check
bun run lint
bun run typecheck
bun run test
```

Clean generated output:

```bash
bun run clean
```

## Default URLs And Ports

- Server: `http://127.0.0.1:4210`
- Web dev server: `http://127.0.0.1:5173`

In development, the Vite app proxies `/health`, `/config`, `/rpc`, and `/ws` to the server.

## Environment Variables

- `HOST`: host for the server and Vite dev server. Default: `127.0.0.1`
- `PORT`: fallback server port. Default: `4210`
- `S10N_BASE_PORT`: preferred server port override
- `S10N_BASE_HOME`: runtime directory for server data and logs. Default: `~/.s10n-base`
- `VITE_SERVER_URL`: server URL used by the Vite dev proxy. Default: `http://127.0.0.1:4210`
- `S10N_BASE_SERVER_URL`: server URL the desktop app should connect to. Default: `http://127.0.0.1:4210`
- `VITE_DEV_SERVER_URL`: web dev server URL the desktop app should load in development. Default: `http://127.0.0.1:5173`

## Runtime Files

The server creates and uses this runtime layout under `S10N_BASE_HOME`:

```text
~/.s10n-base/
  data/
    app.db
    settings.json
  logs/
    server.log
```

## Server Surface

The server currently exposes:

- `GET /health`
- `GET /config`
- `POST /rpc`
- `GET /ws` via WebSocket upgrade

When `apps/web/dist` exists, the server also serves the built web app.

## Example Domain

The scaffold currently proves the stack with a small example domain:

- projects
- notes within projects
- server-persisted app settings
- live activity events over WebSocket
- a few client-only UI settings persisted with Zustand

## Customizing

If you are turning this into a new product, start with `CUSTOMIZATION_GUIDE.md`.
