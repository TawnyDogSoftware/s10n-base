# S10N Base

S10N Base is a standalone Bun + Turbo monorepo scaffold extracted from the source repository's architecture, but stripped of coding-agent-specific product behavior.

The repo identity is `s10n-base`. The local directory is still `starter/` for now because it has not been renamed on disk.

## What It Includes

- Bun workspace + Turbo monorepo
- Strict TypeScript
- `apps/server` as the application core
- `apps/web` as a React + Vite client
- `apps/desktop` as a thin Electron host
- `packages/contracts` for shared schemas and typed RPC contracts
- `packages/shared` for small reusable helpers with subpath exports
- SQLite persistence
- HTTP routes for `/health`, `/config`, and `/rpc`
- WebSocket activity stream at `/ws`
- Example domain: projects + notes + settings

## What It Intentionally Does Not Include

- Provider integrations
- Agent sessions or orchestration pipelines
- Git or worktree flows
- Terminal emulation
- Product-specific auth or pairing flows
- Marketing app
- `packages/client-runtime`

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

## Commands

Install dependencies:

```bash
bun install
```

Run server + web in development:

```bash
bun run dev
```

Run only the server:

```bash
bun run dev:server
```

Run only the web app:

```bash
bun run dev:web
```

Run desktop against the dev server and dev web app:

```bash
bun run dev:desktop
```

Build everything:

```bash
bun run build
```

Run checks:

```bash
bun run fmt
bun run lint
bun run typecheck
bun run test
```

## Default Ports

- Server: `4210`
- Web dev server: `5173`

Override the server URL for web dev with `VITE_SERVER_URL`.

## Runtime Files

The server stores runtime state under `S10N_BASE_HOME`.

Default location:

```text
~/.s10n-base/
```

Contents:

- `data/app.db` for SQLite data
- `data/settings.json` for persisted server settings
- `logs/server.log` for basic server logs

## Example Domain

The scaffold proves the stack with a small generic domain:

- Create, update, list, and delete projects
- Open a project detail screen
- Create, update, and delete notes inside a project
- Update persisted server settings
- Receive live activity events over WebSocket
- Persist a few client-only preferences with Zustand

## Turning This Into Its Own Repo

1. Rename the current `starter/` directory to `s10n-base/` when you want the folder name to match the repo name.
2. Run `bun install`.
3. Rename workspace packages from `@s10n-base/*` if you want a different scope.
4. Replace the example domain in `packages/contracts`, `apps/server/src/services`, and `apps/web/src/routes`.
5. Update `README.md`, `CUSTOMIZATION_GUIDE.md`, and package metadata.

See `CUSTOMIZATION_GUIDE.md` for the recommended order.
