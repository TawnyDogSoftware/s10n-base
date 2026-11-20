# Deployment

How to build the container image, run it, and keep a deployment of it healthy. Nothing here assumes a particular host: anything that runs containers, reaches a Postgres database and sits behind a TLS-terminating proxy will do.

## What you deploy

One image, built from `docker/Dockerfile`, with three commands:

| Command                                                    | What it does                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| (the default) `node apps/server/dist/bin.mjs`              | The server: the API, auth, and the built web app from the same origin |
| `node apps/server/dist/migrate.mjs up` (or `status`)       | Applies migrations, then exits. Run it before each new version        |
| `node apps/server/dist/set-role.mjs <email> <user\|admin>` | Changes a user's role; this is how the first admin is made            |

The image's entry point is `node`, so a command is the script and its arguments, for example `docker run --rm <image> apps/server/dist/migrate.mjs up`.

```bash
bun run docker:build   # builds s10n-base:local, with APP_VERSION set to the commit
bun run docker:smoke   # runs the image in production mode against the local Postgres and checks it
```

To build it yourself: `docker build -f docker/Dockerfile --build-arg APP_VERSION=<version> -t <name> .` from the repository root. `APP_VERSION` is optional; it may use letters, digits, `.`, `_`, `+` and `-`, and becomes the `APP_VERSION` variable that `/config` reports and the image's `org.opencontainers.image.version` label.

The web app is built into the image and served by the server from `APP_URL`, its own origin, so there is no CORS to set up and cookies stay first-party. A web app hosted on another origin needs more: see `VITE_API_BASE_URL` in [setup.md](setup.md#environment-variables).

### The image

- Two bases, pinned by tag and digest: the official bun image, used only to build, and the official Node slim image, which runs the server. Their versions are the ones in `.nvmrc` and `packageManager` ([dependencies.md](dependencies.md#where-each-version-lives)).
- What it holds: the bundled server (`apps/server/dist`), the built web app (`apps/web/dist`) and only the packages the server needs at run time, in `node_modules` (`scripts/container/runtime-dependencies.ts` picks them). No sources, tests, `.env` files, development tools, mobile app or docs, and no package manager.
- It runs as the unprivileged `node` user (uid 1000), with `NODE_ENV=production`, `HOST=0.0.0.0` and `PORT=4210`, and writes nothing to its filesystem, so it runs with a read-only root filesystem. No shell is needed to start it.
- `STOPSIGNAL` is `SIGTERM`, and its `HEALTHCHECK` asks `/health` with Node every 10 seconds.
- Logs are JSON lines on stdout. Nothing is written anywhere else.

## Environment

Every variable each command reads. Each command checks all of them when it starts and refuses to run if any is invalid, printing every problem in one log line and never a value. A secret (`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `BETTER_AUTH_SECRET`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) is never logged. These tables are checked against the code (`apps/server/src/config/environment-table.test.ts`), so they are complete.

### The server

<!-- environment:server -->

| Variable                   | Required | Default       | Rule                                                                                                                | In production                                   |
| -------------------------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `NODE_ENV`                 | no       | `development` | must be development, test or production                                                                             |                                                 |
| `APP_URL`                  | yes      |               | must be a bare http or https origin such as https://app.example.com (no path, query or credentials)                 | must use https                                  |
| `HOST`                     | no       | `0.0.0.0`     | must be a bind address such as 0.0.0.0 or 127.0.0.1                                                                 |                                                 |
| `PORT`                     | no       | `4210`        | must be an integer from 0 to 65535                                                                                  |                                                 |
| `DATABASE_URL`             | yes      |               | must be a postgres:// or postgresql:// URL                                                                          |                                                 |
| `DATABASE_POOL_MAX`        | no       | `10`          | must be an integer from 1 to 100                                                                                    |                                                 |
| `TRUSTED_PROXY_HOPS`       | no       | `0`           | must be an integer from 0 to 10                                                                                     |                                                 |
| `REQUEST_BODY_LIMIT_BYTES` | no       | `1048576`     | must be an integer of at least 1024                                                                                 |                                                 |
| `SHUTDOWN_TIMEOUT_MS`      | no       | `10000`       | must be an integer from 1000 to 60000                                                                               |                                                 |
| `LOG_LEVEL`                | no       | `info`        | must be debug, info, warn or error                                                                                  |                                                 |
| `BETTER_AUTH_SECRET`       | yes      |               | must be at least 32 characters; generate one with `openssl rand -base64 32`                                         | must not be the example value from .env.example |
| `APP_VARIANT`              | no       | `development` | must be development, preview or production                                                                          | is required                                     |
| `EMAIL_FROM`               | yes      |               | must be a plain email address such as no-reply@example.com                                                          |                                                 |
| `SUPPORT_EMAIL`            | yes      |               | must be a plain email address such as support@example.com                                                           |                                                 |
| `SES_REGION`               | yes      |               | must be an AWS region name such as us-east-1                                                                        |                                                 |
| `SES_ENDPOINT`             | no       |               | must be a loopback origin such as http://127.0.0.1:8005 (the local capture server), or unset                        | must not be set                                 |
| `AWS_ACCESS_KEY_ID`        | yes      |               | must be an AWS access key id with no spaces                                                                         | must not be the local placeholder               |
| `AWS_SECRET_ACCESS_KEY`    | yes      |               | must be an AWS secret access key                                                                                    | must not be the local placeholder               |
| `AWS_SESSION_TOKEN`        | no       |               | must be an AWS session token, or unset                                                                              |                                                 |
| `APP_VERSION`              | no       |               | must be 1 to 128 letters, digits, dots, underscores, plus or minus signs, starting with a letter or digit, or unset |                                                 |

<!-- /environment:server -->

The image sets `NODE_ENV`, `HOST`, `PORT` and `APP_VERSION`; the rest come from the deployment. `APP_VARIANT` names the mobile app build whose URL scheme the server trusts ([mobile-dev.md](mobile-dev.md)).

### `migrate`

<!-- environment:migrate -->

| Variable                 | Required | Default       | Rule                                                                                                                         | In production |
| ------------------------ | -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `NODE_ENV`               | no       | `development` | must be development, test or production                                                                                      |               |
| `DATABASE_URL`           | no       |               | must be a postgres:// or postgresql:// URL; required when MIGRATION_DATABASE_URL is unset                                    |               |
| `MIGRATION_DATABASE_URL` | no       |               | must be a postgres:// or postgresql:// URL for the role that owns the schema, or unset to use DATABASE_URL                   |               |
| `LOG_LEVEL`              | no       | `info`        | must be debug, info, warn or error                                                                                           |               |
| `DATABASE_APP_ROLE`      | no       |               | must be a role name of lowercase letters, digits and underscores, not starting with a digit, at most 63 characters, or unset |               |

<!-- /environment:migrate -->

The server never reads `MIGRATION_DATABASE_URL`. With `NODE_ENV=production`, `migrate` refuses `down` and `reset`.

### `set-role`

<!-- environment:set-role -->

| Variable       | Required | Default       | Rule                                       | In production |
| -------------- | -------- | ------------- | ------------------------------------------ | ------------- |
| `NODE_ENV`     | no       | `development` | must be development, test or production    |               |
| `DATABASE_URL` | yes      |               | must be a postgres:// or postgresql:// URL |               |
| `LOG_LEVEL`    | no       | `info`        | must be debug, info, warn or error         |               |

<!-- /environment:set-role -->

## Database

Postgres 18, the version the local database and CI use. Creating it, backing it up and restoring it are the operator's job; the base includes none of that.

### Two roles

The running server should not be able to change the schema, so use two roles: one that owns the schema and runs `migrate`, and one the server connects as. Creating them is a one-off step for whoever administers the database, for example:

```sql
create role app_owner login password '<generated>';
create role app_runtime login password '<generated>';
create database app owner app_owner;
```

From Postgres 15 on, the `public` schema of a new database belongs to the database's owner and nobody else may create objects in it, so `app_runtime` cannot. On an older Postgres, also run `revoke create on schema public from public;` in the new database.

Then:

- `migrate` runs with `MIGRATION_DATABASE_URL` set to `app_owner`'s URL and `DATABASE_APP_ROLE=app_runtime`. After applying migrations, every `up` grants `app_runtime` what the server needs: use of the schema, reading and writing rows in its tables, use of its sequences, and the same on tables later migrations create (through default privileges). The migrator's own tables are read-only to it.
- The server runs with `DATABASE_URL` set to `app_runtime`'s URL. It can read and write rows; it cannot create, alter, drop or truncate a table (`apps/server/src/infra/postgres/app-role.live.test.ts` shows each).

With neither variable set, `migrate` and the server share `DATABASE_URL`'s role, as local development does.

### Migrating

Run `migrate up` from the new image before rolling out a new version, as a one-off task that must succeed first:

```bash
docker run --rm -e NODE_ENV=production -e MIGRATION_DATABASE_URL=... -e DATABASE_APP_ROLE=app_runtime <image> apps/server/dist/migrate.mjs up
```

- It is safe to run more than once, and from more than one place at a time: runs take turns on a Postgres advisory lock, and each migration is applied once. All pending migrations apply in one transaction, so a failure leaves none of them applied.
- `migrate status` lists applied, pending and unknown migrations without changing anything.
- The server never migrates. It checks at startup that every migration in its build has been applied, and refuses to start otherwise, naming what is missing (`MigrationsPendingError`, exit code 1). Migrations the database has and the build does not know are allowed, so the previous version keeps running while a rollout or a rollback is under way.
- The previous version keeps serving while the new one starts, against the migrated schema. Write migrations it can live with: add a column before the code that needs it, and drop one only after no running version reads it.

## Health and lifecycle

- `GET /health` is liveness: 200 while the process is serving. It does not touch the database.
- `GET /ready` is readiness: 200 when the database answers `select 1` within two seconds, 503 while it does not or once shutdown has started. Send traffic only to a ready instance.
- On `SIGTERM` (or `SIGINT`) the server stops accepting connections, lets requests in flight finish for up to `SHUTDOWN_TIMEOUT_MS`, cuts off what is left, then closes the database pool, which may take up to `SHUTDOWN_TIMEOUT_MS` again. Set the platform's termination grace period above twice `SHUTDOWN_TIMEOUT_MS` plus a few seconds: 25 seconds for the default of 10.
- Exit codes. The server: 0 after a clean stop; 1 after a forced stop, a failed stop, or a failed start (invalid configuration, no database, a pending migration). `migrate`: 0, or 1 for any failure. `set-role`: 0, 1 for an unknown user, 2 for bad arguments.

## Behind a proxy

The server speaks plain HTTP on `PORT`. TLS ends at a proxy or load balancer in front of it.

- `APP_URL` is the public `https` origin users see, such as `https://app.example.com`. Production refuses anything else. Email links, CORS, Better Auth's origin checks and the passkey relying party are all derived from it.
- Cookies are `Secure` and responses carry `Strict-Transport-Security` because `APP_URL` is `https`.
- `TRUSTED_PROXY_HOPS` must equal the number of proxies in front of the server that append to `X-Forwarded-For`. The client's address is the entry that many places from the right. Too low, and every user appears to come from the proxy, so one user's failed sign-ins rate-limit everyone. Too high, and a client can choose its own address by sending the header, and escape the rate limits. Request logs show the address the server used (`clientIp`); check it once after deploying. Entries further left were written by the client and are never read.
- The server must be reachable only through those proxies. A hop count cannot prove that the last hop is a proxy: a client that reaches the server directly can write the entries the server trusts.
- The proxy must allow request bodies up to `REQUEST_BODY_LIMIT_BYTES`; the server answers 413 above it.

## More than one instance

Any number of instances can run side by side. Sessions and rate-limit counters are kept in Postgres, and nothing is held in memory between requests or written to local disk, so any instance can answer any request. Each instance opens up to `DATABASE_POOL_MAX` connections: keep instances × pool size below the database's connection limit, leaving room for `migrate`.

What a project must keep true as it adds features: no state in memory that another instance would need (use Postgres), no files on local disk (use object storage), and no background work in the request process (the worker recipe in plan 000 is the way to add it).

## Email

The server sends verification and password-reset emails through Amazon SES v2 with its own small client ([auth.md](auth.md#email)). A deployment needs:

- a verified sender identity for `EMAIL_FROM`, in the region set by `SES_REGION`, and an account out of the sandbox before sending to unverified addresses;
- static access keys (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) whose only permission is to send email;
- no `SES_ENDPOINT`: it points at the local capture server, and production refuses it.

Credentials that come from a role rather than static keys need the SDK put back; [auth.md](auth.md#email) says how.

## The first admin

After the first user has signed up and verified their address, from the image:

```bash
docker run --rm -e NODE_ENV=production -e DATABASE_URL=... <image> apps/server/dist/set-role.mjs you@example.com admin
```

The role applies from the user's next request. After that, an admin can change roles through `POST /api/auth/admin/set-role` ([auth.md](auth.md#creating-the-first-admin)).

## What the base does not include

- Infrastructure code. Projects that need it write Terraform in their own repository ([decision 010](adr/010-no-infrastructure-code.md)).
- An image registry, signing or a bill of materials: push and sign the image wherever the project deploys from.
- A CDN, TLS certificates, a proxy, database backups, a worker, and observability beyond JSON logs on stdout.
