# S10N Base

S10N Base is a Bun + Turbo monorepo scaffold with a typed server boundary and a web client.

> The scaffold is being reworked into a hosted web and mobile starter; see [plans/000-hosted-starter-rework.md](plans/000-hosted-starter-rework.md).

It was derived from [`t3code`](https://github.com/pingdotgg/t3code), keeping the overall repo shape and developer workflow while removing product-specific coding-agent behavior.

## Current Stack

- Bun workspaces + Turbo
- Strict TypeScript across apps and packages
- `apps/server`: Node HTTP server with a typed RPC endpoint, Better Auth (email and password, passkeys, admin roles), Postgres through Kysely, and Effect layers for startup and shutdown
- `apps/web`: React 19 + Vite + Tailwind CSS v4 + TanStack Router + TanStack Query: sign-up, sign-in (password or passkey), email verification, password reset, a profile page and an admin user list
- `packages/contracts`: shared Effect schemas and RPC contracts
- `packages/client`: the RPC client with an explicit base URL, the session client and session-gated query state, for web and mobile ([docs/client.md](docs/client.md))
- `packages/theme`: the Tailwind 4 design tokens shared by web and mobile
- `packages/i18n`: i18next catalogs with typed keys, for the apps and the server's emails ([docs/i18n.md](docs/i18n.md))
- `packages/shared`: small cross-runtime helpers
- Oxlint + Oxfmt + Vitest

## Monorepo Layout

```text
apps/
  server/
  web/
packages/
  client/
  contracts/
  i18n/
  shared/
  theme/
```

## Requirements

- Bun 1.4.4, the version in `packageManager` in `package.json`
- Node 26.13.1, the version in `.nvmrc` (`nvm use` picks it up)
- Docker with Compose v2, for the local Postgres

[docs/setup.md](docs/setup.md) covers setup, configuration, the database and the tests in full.

Versions follow a 3-day rule enforced by `bunfig.toml`, and a daily workflow keeps them current. See [docs/dependencies.md](docs/dependencies.md).

## Commands

Install dependencies:

```bash
bun install
```

Start Postgres, apply migrations, and run the server, the web app and the local email inbox in development (Ctrl-C stops them):

```bash
bun dev
```

Open [http://localhost:5173](http://localhost:5173) and create an account. Emails are captured, not sent: read the verification link at [http://127.0.0.1:8005/](http://127.0.0.1:8005/), the local inbox. The web app calls the API on its own origin; set `VITE_API_BASE_URL` when the API is elsewhere ([docs/setup.md](docs/setup.md#environment-variables)).

Run individual apps (start the database first with `bun run db:up`):

```bash
bun run dev:server
bun run dev:web
bun run ses:local   # the local SES capture server and inbox
```

Make a user an admin, then open **Users** in the header (`/admin/users`):

```bash
bun run auth:set-role you@example.com admin
```

Database:

```bash
bun run db:up            # start Postgres (docker-compose.local.yml)
bun run db:down          # stop it
bun run db:migrate       # apply migrations
bun run db:status        # list applied and pending migrations
bun run db:reset         # drop and re-migrate (refused in production)
bun run db:generate      # regenerate the database types
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
bun run test:live   # needs the database
```

Start the built server, check `/health`, `/ready` and the web app, and stop it with SIGTERM (run `bun run build` first; needs the database):

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

- Web dev server, the app's origin in development (`APP_URL`): `http://localhost:5173`
- Server: `http://127.0.0.1:4210`
- Postgres: `127.0.0.1:54320`
- Local email inbox (SES capture server): `http://127.0.0.1:8005`

In development, the Vite app proxies `/rpc`, `/api`, `/config`, `/health` and `/ready` to the server.

## Environment Variables

The server needs `APP_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, the email addresses and the SES settings, and validates every variable at startup. `.env.example` lists them all with development values; `bun dev` and the `db:*` scripts use it unless you create a `.env`. The full table is in [docs/setup.md](docs/setup.md#environment-variables).

## Server Surface

The server currently exposes:

- `GET /health` (liveness)
- `GET /ready` (readiness: checks the database)
- `GET /config`
- `POST /rpc`
- `/api/auth/*` (Better Auth, behind a route allow-list)
- `GET /api/app-auth/session`

How auth works is in [docs/auth.md](docs/auth.md).

When `apps/web/dist` exists, the server also serves the built web app.

## Customizing

If you are turning this into a new product, start with `CUSTOMIZATION_GUIDE.md`.
