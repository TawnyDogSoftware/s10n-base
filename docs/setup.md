# Setup

How to run the app locally, configure it, change the database and run the tests.

## Prerequisites

- **Node** 26.13.1, the version in `.nvmrc` (`nvm use` picks it up).
- **bun** 1.4.4, the version in `packageManager` in `package.json`.
- **Docker** with Compose v2, for the local Postgres. `docker compose version` must work.

Then install dependencies:

```bash
bun install
```

## Run it

```bash
bun dev
```

`bun dev` (`scripts/dev.ts`):

1. starts Postgres from `docker-compose.local.yml` and waits until it is healthy,
2. applies migrations (`db:migrate`),
3. runs the local SES capture server (when `SES_ENDPOINT` is set, as in `.env.example`), the API server in watch mode and the Vite dev server,
4. stops them all when you press Ctrl-C, or when any of them exits.

Open `APP_URL` (`http://localhost:5173` by default). Emails the server sends (verification, password reset) are captured, not delivered: read them in the local inbox at `http://127.0.0.1:8005/`, which `bun dev` prints when it starts. [docs/auth.md](auth.md) explains how auth works. The browser talks only to Vite, which proxies `/rpc`, `/api`, `/config`, `/health` and `/ready` to the API server on `PORT`. The database keeps running after `bun dev` stops; `bun run db:down` stops it.

To run the parts on their own: `bun run dev:server`, `bun run dev:web` and `bun run ses:local` (start the database first with `bun run db:up`).

## Environment variables

The server reads these once at startup and refuses to start if any is invalid, listing every problem in one log line. The value of a secret (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) is never printed.

| Variable                   | Rule                                                                                                                                       | Default       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `NODE_ENV`                 | `development`, `test` or `production`                                                                                                      | `development` |
| `APP_URL`                  | The single public origin users see: scheme, host and optional port, with no path, query or credentials. `https` is required in production. | required      |
| `HOST`                     | Bind address                                                                                                                               | `0.0.0.0`     |
| `PORT`                     | Integer 0 to 65535                                                                                                                         | `4210`        |
| `DATABASE_URL`             | A `postgres://` or `postgresql://` URL. A secret.                                                                                          | required      |
| `DATABASE_POOL_MAX`        | Integer 1 to 100: connections in the pool                                                                                                  | `10`          |
| `TRUSTED_PROXY_HOPS`       | Integer 0 to 10: how many reverse proxies sit in front of the server                                                                       | `0`           |
| `REQUEST_BODY_LIMIT_BYTES` | Integer, at least 1024                                                                                                                     | `1048576`     |
| `SHUTDOWN_TIMEOUT_MS`      | Integer 1000 to 60000: how long a shutdown waits for requests in flight                                                                    | `10000`       |
| `LOG_LEVEL`                | `debug`, `info`, `warn` or `error`                                                                                                         | `info`        |
| `BETTER_AUTH_SECRET`       | At least 32 characters. A secret. Production refuses the value in `.env.example`.                                                          | required      |
| `APP_VARIANT`              | `development`, `preview` or `production`: the mobile app build this server serves. Must be set in production.                              | `development` |
| `EMAIL_FROM`               | A plain email address, the sender of every email                                                                                           | required      |
| `SUPPORT_EMAIL`            | A plain email address, shown in email footers and used as the reply-to                                                                     | required      |
| `SES_REGION`               | An AWS region name such as `us-east-1`                                                                                                     | required      |
| `SES_ENDPOINT`             | A loopback origin that replaces the AWS endpoint (the local capture server). Refused in production.                                        | unset         |
| `AWS_ACCESS_KEY_ID`        | The SES sender's access key. Production refuses the placeholder `local`.                                                                   | required      |
| `AWS_SECRET_ACCESS_KEY`    | Its secret. A secret. Production refuses the placeholder `local`.                                                                          | required      |
| `AWS_SESSION_TOKEN`        | For temporary credentials. A secret.                                                                                                       | unset         |

The live tests also read `TEST_DATABASE_URL` (below).

`.env.example` lists all of them with values that work with the compose file. `bun dev` and the `db:*`, `test:live` and `smoke` scripts read `.env` if it exists and `.env.example` otherwise; a variable set in your shell wins over both. To change a value, copy `.env.example` to `.env` and edit it. `.env` is ignored by git.

Notes:

- **`APP_URL`** is also what `GET /config` returns as `apiBaseUrl`, and the only origin allowed by CORS. In development it is the Vite dev server's origin, and Vite listens on its host and port.
- **`TRUSTED_PROXY_HOPS`** decides which `X-Forwarded-For` entry is the client's address: with one proxy, the last entry; with two, the one before it. With `0` the header is ignored and the socket's address is used. Set it to exactly the number of proxies you run, or clients can choose their own address.
- **`SHUTDOWN_TIMEOUT_MS`:** on SIGTERM or SIGINT the server stops accepting connections, answers `/ready` with 503, waits up to this long for requests in flight, then closes what is left and the database pool. It exits 0 after a clean stop and 1 when it had to force anything.
- **`SES_ENDPOINT`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`:** `.env.example` points the server at the local capture server with the placeholder keys `local`/`local`, so email works on a fresh clone with no AWS account. In production, leave `SES_ENDPOINT` unset and give real keys for an IAM user allowed to call `ses:SendEmail`; `EMAIL_FROM` must be a verified SES identity.
- `S10N_BASE_PORT` no longer exists; use `PORT`.

## The local inbox

`bun run ses:local` (started by `bun dev`) captures the emails the server sends. Open `http://127.0.0.1:8005/` to read them, newest first, with their links clickable. `GET /store` returns them as JSON and `POST /clear-store` empties the store. It keeps the last 200 emails in memory and listens on loopback only. Details are in [docs/auth.md](auth.md#the-local-inbox).

## The first admin

Sign up, follow the link in the inbox, then run `bun run auth:set-role you@example.com admin`.

## Health checks

- `GET /health` is liveness: 200 whenever the process is serving. It never touches the database.
- `GET /ready` is readiness: 200 when `select 1` answers within two seconds, otherwise 503. It also answers 503 once shutdown has started.

## The database

Postgres 18 runs in Docker on `127.0.0.1:54320` (not 5432, so it does not clash with another local Postgres). The compose file creates two databases: `s10n_base` for the app and `s10n_base_test` for the live tests. Its data lives in a named volume.

| Command                     | What it does                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `bun run db:up`             | Starts Postgres and waits until it is healthy                                                                         |
| `bun run db:down`           | Stops it (the data volume stays; `docker compose -f docker-compose.local.yml down -v` deletes it)                     |
| `bun run db:migrate`        | Applies pending migrations                                                                                            |
| `bun run db:status`         | Lists applied, pending and unknown migrations; changes nothing                                                        |
| `bun run db:reset`          | Drops the `public` schema with everything in it, then migrates again. Refuses to run when `NODE_ENV` is `production`. |
| `bun run db:generate`       | Regenerates `apps/server/src/infra/postgres/generated/db.ts` from the migrated database                               |
| `bun run db:generate:check` | Fails if that file differs from what the database produces; CI runs it                                                |

The built `migrate` entry point (`node apps/server/dist/migrate.mjs [up|status|down|reset]`) is what a deployment runs before starting new server instances. The server never migrates on startup. `down` reverts the latest migration; `down` and `reset` refuse to run in production. The first connection is retried for up to 30 seconds, so it can start next to a database that is still booting. Two migrate processes started together take turns on a Postgres advisory lock.

### Adding a migration

1. Create `apps/server/src/infra/postgres/migrations/NNN_short_name.ts`, numbered after the last one, exporting a Kysely `Migration`:

   ```ts
   import { type Kysely, sql } from "kysely";
   import type { Migration } from "kysely/migration";

   export const createProfiles: Migration = {
     async up(db: Kysely<unknown>) {
       await db.schema
         .createTable("profiles")
         .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
         .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
         .execute();
     },
     async down(db: Kysely<unknown>) {
       await db.schema.dropTable("profiles").execute();
     },
   };
   ```

2. Add it to the map in `migrations/index.ts`: `"001_create_profiles": createProfiles`. The map is explicit so the bundled `migrate.mjs` contains every migration.
3. Run `bun run db:migrate`, then `bun run db:generate`, and commit the migration with the regenerated `generated/db.ts`.

Migrations are append-only: once merged, a migration file is never edited or removed. A change is always a new migration. All pending migrations run in one transaction, so if one fails, none of that run is applied.

## Tests

```bash
bun run test        # unit tests; no database needed
bun run test:live   # tests against Postgres
```

The live tests are files named `*.live.test.ts` under `apps/server/src`, run by `apps/server/vitest.live.config.ts`. They are not part of `bun run test`.

- The auth tests start the server on a free port with the capture server in the same process, and read emails from it. Nothing else needs to be running except Postgres.
- They need `TEST_DATABASE_URL`, which never falls back to `DATABASE_URL`. Before any change to the database, the fixture checks that the URL names a database ending in `_test` and that the open connection reports that same database.
- Each suite works in its own throwaway schema (`fixture_<time>_<random>`), passed to the pool as its `searchPath`, and drops it afterwards.
- A run that is killed can leave a schema behind. `bun run db:test:sweep` drops fixture schemas more than ten minutes old.

To write a live suite, call `createFixtureSchema()` from `apps/server/src/test/live-database.ts` in `beforeEach`, create the pool with `searchPath: fixture.schema`, and call `fixture.drop()` in `afterEach`.

## Checking a build

```bash
bun run build
bun run smoke
```

`smoke` starts the built server with Node, checks `/health`, `/ready` and that `/` serves the web app, then sends SIGTERM and checks that the server exits with code 0. It needs the database running.
