# S10N Base

S10N Base is a Bun + Turbo monorepo scaffold with a typed server boundary and a web client.

> The scaffold is being reworked into a hosted web and mobile starter; see [plans/000-hosted-starter-rework.md](plans/000-hosted-starter-rework.md).

It was derived from [`t3code`](https://github.com/pingdotgg/t3code), keeping the overall repo shape and developer workflow while removing product-specific coding-agent behavior.

## Current Stack

- Bun workspaces + Turbo
- Strict TypeScript across apps and packages
- `apps/server`: Node HTTP server with a typed RPC endpoint
- `apps/web`: React 19 + Vite + Tailwind CSS v4 + TanStack Router + TanStack Query
- `packages/contracts`: shared Effect schemas and RPC contracts
- `packages/shared`: small cross-runtime helpers
- Oxlint + Oxfmt + Vitest

## Monorepo Layout

```text
apps/
  server/
  web/
packages/
  contracts/
  shared/
```

## Requirements

- Bun 1.4.4, the version in `packageManager` in `package.json`
- Node 26.13.1, the version in `.nvmrc` (`nvm use` picks it up)

Versions follow a 3-day rule enforced by `bunfig.toml`, and a daily workflow keeps them current. See [docs/dependencies.md](docs/dependencies.md).

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
```

Build everything:

```bash
bun run build
```

Start built apps:

```bash
bun run start:server
bun run start:web
```

Run checks:

```bash
bun run fmt
bun run fmt:check
bun run lint
bun run typecheck
bun run test
```

Start the built server and check that `/health` answers (run `bun run build` first):

```bash
bun run smoke
```

CI (`.github/workflows/ci.yml`) runs all of these on every pull request.

Preview the daily dependency update without pushing anything:

```bash
bun run deps:update --dry-run
```

Clean generated output:

```bash
bun run clean
```

## Default URLs And Ports

- Server: `http://127.0.0.1:4210`
- Web dev server: `http://127.0.0.1:5173`

In development, the Vite app proxies `/health`, `/config` and `/rpc` to the server.

## Environment Variables

- `HOST`: host for the server and Vite dev server. Default: `127.0.0.1`
- `PORT`: fallback server port. Default: `4210`
- `S10N_BASE_PORT`: preferred server port override
- `VITE_SERVER_URL`: server URL used by the Vite dev proxy. Default: `http://127.0.0.1:4210`

## Server Surface

The server currently exposes:

- `GET /health`
- `GET /config`
- `POST /rpc`

When `apps/web/dist` exists, the server also serves the built web app.

## Customizing

If you are turning this into a new product, start with `CUSTOMIZATION_GUIDE.md`.
