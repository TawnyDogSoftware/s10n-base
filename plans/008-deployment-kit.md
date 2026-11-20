# 008: Deployment kit

> Status: implemented on 2026-11-20, on branch `feature/001-strip-desktop-and-local-first` (the rework's single pull request). Section 9 records how.

Phase 8 of [000](000-hosted-starter-rework.md). Builds on phases 1 to 7. Source labels such as `[S8]` are resolved in the private companion's README; nothing from that directory is copied into this repo.

## 1. Goal

A project made from this base can build one container image and run it anywhere that runs containers: the bundled server serving the web build, with migrations as a separate mode under a separate database role, proven in CI by building the image and running it in production mode. Plus a deployment guide.

D10 is fixed: **no infrastructure code in the base**, and everything here stays hosting-neutral. No vendor, platform, registry or orchestrator is named or assumed. Projects that need infrastructure code use Terraform, in their own repos.

## 2. Out of scope

| Not in this phase | Why |
|---|---|
| Terraform, Kubernetes manifests, Helm, a production compose file | D10 |
| Pushing an image to any registry, signing, SBOM publishing | Per project |
| A worker image or entry | Later recipe (plan 000) |
| Mobile store builds | Per project |
| `AGENTS.md`, README rewrite, rename script | Phase 9 |

No dependency is added to the app. CI may use Docker's own tooling.

## 3. The image

`docker/Dockerfile`, built with the repo root as context (`docker build -f docker/Dockerfile .`). Project C's is the reference `[S8]`; ours is rewritten for this repo's layout and tools.

- **Bases pinned by tag and digest:** the official bun image (for the bun binary) at the version in `packageManager`, and the official Node slim image at the version in `.nvmrc`. A build step asserts `node --version` and `bun --version` match what was asked for.
- **Stages:**
  1. *toolchain:* Node plus the bun binary, with the manifests and lockfile only, so the dependency layers cache.
  2. *production dependencies:* a frozen, production-only install containing just what the server needs at run time. The bundle leaves some packages external (`pg`, `kysely`, `effect`, `i18next`, Better Auth and whatever else `tsdown` does not inline: find the real list from the build output, do not guess). bun's default linker stores packages behind symlinks; make sure what is copied to the final stage actually resolves there, and prove it by running the image.
  3. *build:* full frozen install, then the server and web builds. Assert the three entries exist (`bin.mjs`, `migrate.mjs`, `set-role.mjs`) and the web build has an `index.html`.
  4. *runtime:* the Node slim base with npm, yarn and corepack removed; the production dependencies; `apps/server/dist` and `apps/web/dist` in the same relative layout the server expects (it looks for the web build relative to its own file).
- **Runtime contract:** runs as the unprivileged `node` user; `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=4210`, `EXPOSE 4210`, `STOPSIGNAL SIGTERM`; `ENTRYPOINT ["node"]` and `CMD ["apps/server/dist/bin.mjs"]`. It writes nothing to its filesystem, so it runs with a read-only root filesystem. No shell is needed to start it. A `HEALTHCHECK` that requests `/health` with Node.
- **Other modes are other commands on the same image:** `apps/server/dist/migrate.mjs up` (also `status`) and `apps/server/dist/set-role.mjs <email> <role>`.
- **Version:** a build argument `APP_VERSION`, validated to a safe character set, set as an environment variable and an OCI label. `/config` reports it when set, and the package version otherwise.
- **Nothing extra in the image:** no source, tests, `.env` files, dev dependencies, mobile app, plans or docs.
- `.dockerignore` at the repo root, deny-by-default: everything is excluded, then build inputs are allowed one by one, then secrets and generated files are excluded again explicitly.

## 4. Versions stay single-sourced

Phase 2 made `.nvmrc` and `packageManager` the only places the Node and bun versions live. The Dockerfile cannot read a file in a `FROM` line, so:

- `scripts/version-sources.test.ts` also fails when the Dockerfile's Node or bun tag disagrees with `.nvmrc` or `packageManager`.
- The daily dependency-update script, which already moves Node and bun, also rewrites the Dockerfile's two tags **and their digests** in the same PR, resolving each digest from the registry's public API. Otherwise its PR would fail the test above every time Node or bun moves. Unit-test this with a fake registry; show a real lookup once in a dry run.
- `.github/dependabot.yml` gains the `docker` ecosystem for `docker/`, with the 3-day cooldown, and with version updates of the Node and bun images ignored: Dependabot refreshes digests of the pinned tags (base-image security rebuilds), and the daily workflow owns version moves. Update `docs/dependencies.md` and plan 000's "Not covered" line to say this.

## 5. A separate database role for migrations

Plan 000 asks for `migrate` as a separate mode **and a separate database role**: the running app should not be able to change the schema.

- `migrate` connects with `MIGRATION_DATABASE_URL` when it is set, else `DATABASE_URL`. The server never reads `MIGRATION_DATABASE_URL`.
- Optional `DATABASE_APP_ROLE`: when set, `migrate up` finishes by granting that role what the app needs on the schema (usage; select, insert, update, delete on tables; usage on sequences) and setting default privileges so tables created by later migrations are covered. The role name is validated as an identifier and quoted. Creating the roles themselves is the operator's job and is documented, not automated.
- Live test, with two roles created in the fixture: after `migrate up` as the owner, a server connected as the app role passes the sign-up and sign-in flow and `/ready`; the app role cannot create or drop a table; a migration added later is usable by the app role without re-granting by hand.
- Local development and CI keep working with a single role when neither variable is set.

## 6. CI

A fourth job, "Container image":

1. Build the image with `docker/Dockerfile`.
2. Run `migrate.mjs up` from the image against the job's Postgres service, as an owner role, with `DATABASE_APP_ROLE` set.
3. Start the server from the image as the app role, in **production mode** with production-shaped values: an `https` `APP_URL`, a real-length secret, non-placeholder credentials, no `SES_ENDPOINT`. This is the first time production configuration is exercised end to end; nothing in it may reach a real external service, and starting must not need one.
4. Check: `/health` and `/ready` are 200; `/` serves the web app with the security headers, including `Strict-Transport-Security`; `/config` reports the build's `APP_VERSION`; the process is not root; the container runs with a read-only root filesystem; `SIGTERM` leads to exit code 0 inside the shutdown deadline.
5. Check the image's contents: the three entries exist; none of `.env`, `*.test.*`, `apps/mobile`, `plans`, TypeScript sources of the server, or dev-only packages (pick three, such as the test runner, the linter and the bundler) is present.
6. Print the image size.

The checks live in `scripts/container/` as a tested module with a one-line entry, per the convention phase 7 set, and run locally with `bun run docker:build` and `bun run docker:smoke`. Building is cached sensibly in CI without any external service account.

## 7. Docs

`docs/deployment.md`, hosting-neutral throughout:

- **What you deploy:** one image, three commands; the web build is served by the server from the same origin; what a split web and API origin needs instead (pointer to `docs/setup.md`).
- **Environment matrix:** every variable the server and `migrate` read, with required or optional, the default, and the production rule. Generate the table from the config module or test it against the module, so it cannot go stale.
- **Database:** creating the owner and app roles; running `migrate up` before rolling out a new version; that the advisory lock makes concurrent runs safe; that the API never migrates on start and, with Better Auth's startup schema check, will refuse to start against an unmigrated database; backups are the operator's.
- **Health and lifecycle:** `/health` for liveness, `/ready` for readiness; set the platform's termination grace period above `SHUTDOWN_TIMEOUT_MS`; exit codes.
- **Behind a proxy:** TLS ends at the proxy; `APP_URL` is the public `https` origin; `TRUSTED_PROXY_HOPS` must equal the number of proxies or client addresses and rate limits are wrong; cookies are `Secure` when `APP_URL` is `https`.
- **More than one instance:** safe by design (rate limits and sessions are in Postgres, nothing is held in memory); what a project must keep true as it adds features.
- **Email:** a verified sender, static access keys with permission to send only, the region; role-based credentials need the SDK put back (pointer to `docs/auth.md`).
- **First admin:** `set-role.mjs` from the image.
- **What the base does not include:** infrastructure code (use Terraform, D10), a registry, a CDN, a worker, observability beyond JSON logs on stdout.

Also: `README.md` and `docs/setup.md` gain the two docker commands; `CHANGELOG.md` an entry; `plans/000-hosted-starter-rework.md` its status line and the correction from section 4.

## 8. Verification and definition of done

On the final commit, recorded in section 9 and the PR description:

1. From clean: frozen install, `bun run agent:check` (all gates, 100% coverage including the new scripts).
2. `build`, database up, `test:live` (including the two-role test), `smoke`, `test:e2e`.
3. `bun run docker:build` and `bun run docker:smoke` locally: every check in section 6, with the image size, the list of packages in the runtime `node_modules`, and the build time cold and warm.
4. The image started with a missing or development-only variable fails with the one-line config error and a non-zero exit, and prints no secret.
5. `bun run deps:update --dry-run` shows the Dockerfile tags and digests being resolved.
6. `git grep` over the Dockerfile, the docs and the workflow finds no vendor, platform, registry or orchestrator name.
7. CI green on the head commit: all four jobs.
8. The scrub check from plan 000 prints nothing.

Done when sections 3 to 7 are in, the above passes, nothing in section 2 was touched, and section 9 records the runtime dependency list, how the production install was made to work under bun's linker, and every departure with its reason.

## 9. How it was built

Implemented on 2026-11-19 and 2026-11-20 on Linux, Node 26.12.1 locally (26.13.1 in the image and CI) and bun 1.4.4, with Docker 29.9 for the local Postgres and the image. Registry data was read the same day. No dependency was added; CI uses Docker's own actions.

### The image

| | |
|---|---|
| Bun base | `oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4` (Debian 13), used only for its binary |
| Node base | `node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc` (Debian 13), build and runtime |
| Size | 394 MB on disk, 91 MB compressed; the Node base is 353 MB of it, `/app` 34 MB |
| Build time | cold (`--no-cache`, bases already pulled, empty bun cache): 34 s; warm, nothing changed: 1 s; after a source change, the install layers stay cached |
| Context | 743 kB, through the deny-by-default `.dockerignore` |

The `-trixie-slim` variant is named explicitly so a Debian release change is a visible tag change, not a silent rebuild. The daily update keeps the variant suffix when it moves the version.

**The runtime dependency list.** The bundle's external imports, read from the build output (`scripts/container/bundle-imports.ts`, which also runs in the image build and fails if they differ from the server's declared dependencies): `better-auth`, `@better-auth/expo`, `@better-auth/passkey`, `better-call`, `effect`, `i18next`, `kysely`, `pg`. Plan 003 named `pg`, `kysely` and `effect`, plan 004 Better Auth and its plugins, plan 005 `i18next`; `better-call` was the one no earlier plan named. With what they need at run time, 63 packages are in the image: `@better-auth/core`, `drizzle-adapter`, `expo`, `kysely-adapter`, `memory-adapter`, `mongo-adapter`, `passkey`, `prisma-adapter`, `telemetry` and `utils` (1.7.25, utils 0.5.1), `@better-fetch/fetch` 1.3.3, `@hexagon/base64` 1.1.28, `@levischuck/tiny-cbor` 0.2.11, `@noble/ciphers` and `@noble/hashes` 2.4.0, twelve `@peculiar/*` packages, `@simplewebauthn/browser` 13.3.0 and `server` 13.3.3, `@standard-schema/spec` 1.1.0, `asn1js` 3.1.0, `better-auth` 1.7.25, `better-call` 1.4.5, `defu` 6.1.7, `effect` 4.1.4, `i18next` 27.1.3, `jose` 6.2.17, `kysely` 0.29.9, `nanostores` 1.5.5, `pg` 8.23.1 with `pg-cloudflare`, `pg-connection-string`, `pg-int8`, `pg-pool`, `pg-protocol`, `pg-types`, `pgpass`, `postgres-array`, `postgres-bytea`, `postgres-date`, `postgres-interval` and `split2`, `pvtsutils` 1.3.6, `pvutils` 1.2.0, `reflect-metadata` 0.2.2, `rou3` 0.9.2, `set-cookie-parser` 3.2.3, `tslib` 1.14.1 and 2.9.1, `tsyringe` 4.10.0, `xtend` 4.0.2 and `zod` 4.6.7. `bun run docker:smoke` prints the list from the image itself. Better Auth's database adapters it does not use (Drizzle, Mongo, Prisma, memory) are its own dependencies, so they come along.

**How the production install was made to work under bun's default linker.** Found by running it, not assumed:

- A frozen production install of this workspace (`bun install --production --frozen-lockfile`) under the default isolated linker holds 628 packages and 625 MB: every workspace's production dependencies, Expo and React Native included, and bun links optional peers into each package's directory whenever the workspace installs them (`better-auth` gets React, react-dom and Vitest that way). `--filter @s10n-base/server` does not shrink the store. So copying the install was out.
- bun 1.4.4 accepts a **pruned checkout**: a frozen install with some workspaces' manifests missing works, with a note ("skipped 1 workspace listed in bun.lock but not on disk"), as long as every workspace present has the workspaces it depends on. The image build copies every manifest except the mobile app's.
- `scripts/container/runtime-dependencies.ts` walks from the server's declared dependencies through each package's dependencies and required peers (optional dependencies when installed), using the links bun put next to each package in `node_modules/.bun/<entry>/node_modules`, and copies those store entries with the same relative links into a fresh directory. bun's layout is kept rather than flattened, because the closure has two versions of `tslib`. TypeScript files, declarations, source maps and packages' own tests are left out (73 MB of files became 34 MB with the links). Node resolves through the links unchanged, from any directory: the unit test moves the copy and runs Node from it.
- **What running the image found:** the first image started and died with `ERR_MODULE_NOT_FOUND: Cannot find package 'zod' imported from .../better-call/dist/openapi.mjs`. `better-call` imports `zod` statically but declares it only as an optional peer, so the walk had skipped that link. The rule now keeps an optional peer's link whenever its package is in the image for another reason (it adds links, never packages); following every installed optional peer would have brought React and Vitest. The second finding was `pg-protocol` shipping two `*.test.js` files in `dist`, which the image check refused.
- The workspace's `node_modules/.bun/node_modules` fallback (bun's hoisted links, which let a package find an undeclared dependency) is not copied, so an undeclared dependency fails loudly in the image instead of working by accident.

### Departures from this plan, with reasons

- **The server refuses to start on an unmigrated database.** Section 7 says the API "with Better Auth's startup schema check, will refuse to start against an unmigrated database". It did not: Better Auth 1.7.25 checks the schema on the first request to `/api/auth`, not at startup, so a server started on an empty database came up and `/ready` answered 200, and Better Auth keeps a schema mismatch until the process restarts ("rethrown on every later call ... until a migration invalidates it", meaning its own migrations), so a server that answered an auth request before `migrate up` kept failing after it. The server now reads the migrator's table through its search path at startup and refuses to start, naming what is missing (`MigrationsPendingError`, exit 1), when any migration in its build is pending. Migrations the database has and the build does not are allowed, so an older version keeps running while a release rolls out or back. Unit tests answer the check from the fake pool; `server.live.test.ts` shows the refusal on an unmigrated schema.
- **The app role can read the migrator's two tables** (insert, update and delete are revoked), which the startup check needs. Section 5 said nothing about them; the first version revoked everything.
- **Item 4 is automated:** `docker:smoke` starts the image once without `BETTER_AUTH_SECRET` and once with `SES_ENDPOINT` set, and requires exit 1, exactly one log line saying "Invalid configuration" and naming the variable, and none of the run's secrets in the output.
- **The production run uses a region that does not exist** (`SES_REGION=zz-smoke-1`, which the config's pattern accepts), so even an email sent by mistake could reach nothing real. No check sends one. Better Auth's telemetry is off in the options.
- **Image contents are listed inside the image** with its own Node (`LIST_FILES_SCRIPT` in `image-contents.ts`), since there is nothing else to list with that works without a shell. Dev packages checked for: Vitest, ESLint, oxlint, tsdown, TypeScript and Vite.
- **`docker:smoke` uses Docker's host networking**, so the containers reach the local Postgres on 127.0.0.1 and the check reaches the server. That works on Linux and in CI; on a Mac it needs Docker Desktop's host networking turned on (docs/setup.md says so). It creates its own database and two roles with random names and passwords and removes them, and its containers, even when a check fails.
- **The Dockerfile names each version in a third place,** the build step that checks `node --version` and `bun --version`. `scripts/dockerfile-versions.ts` checks it with the tags, and the daily update rewrites it with them.
- **The daily update resolves digests from the image registry's public pull API** (an anonymous token, then a `HEAD` request for the tag's manifest, which returns the multi-platform index digest). This names the registry's API hosts in `scripts/dependency-updates/image-digests.ts`, as section 4 requires a lookup; the Dockerfile, docs and workflow name none. A runtime whose new tag cannot be resolved does not move that day, and the PR body says why, so the update never breaks the version test.
- **The environment tables are tested, not generated:** `apps/server/src/config/environment-table.test.ts` builds the rows from the config module's variables and compares them cell by cell with `docs/deployment.md`, printing the table to paste when they differ. Each variable now records its default or that it is optional, and a test checks that against how it actually parses. `APP_VARIANT` shows `development` as its default, which is what unset means outside production.
- **`set-role` has its own table:** it reads `DATABASE_URL`, `NODE_ENV` and `LOG_LEVEL` only and connects as the app role, which may update users.
- **CI builds with `docker/build-push-action`** (7.4.0) on `docker/setup-buildx-action` (4.4.1), both pinned by commit, with `type=gha` cache in the workflow's own cache; the image is loaded, never pushed. The job needs no `bun install`: the smoke script imports only Node's modules.
- **`.dockerignore`** re-allows build inputs with patterns such as `!packages/*/src/**`; BuildKit applies them under an excluded parent, so the parents need no entries of their own.

### Claims in plans 000 to 008 that did not hold

- Plan 008 section 7 and plan 007: Better Auth does not check the schema at startup (above).
- Plan 003, "`pg`, `kysely` and `effect` stay external": so do Better Auth, its plugins, `better-call` and `i18next`, as plans 004 and 005 noted.
- Plan 000, "Dependabot handles Docker image digests": it can only refresh the digest of a tag the daily update set, since a version move must also change `.nvmrc` or `packageManager`.

### Not verified here

- Dependabot's digest-only updates: configured as its documentation describes (version updates of `node` and `oven/bun` ignored, so only a rebuilt tag's digest is proposed), but no Dependabot run has happened yet.
- The workflow file was not checked with actionlint (not installed); CI parsed and ran it.

### For phase 9

- **The rename script** must also cover: the image tag `s10n-base:local` in `package.json`'s `docker:build` and in `scripts/container/smoke.ts`, the `org.opencontainers.image.title` label in `docker/Dockerfile`, and the `s10n_base` role and database names, already in the compose file and CI, which `docker:smoke` uses as its admin.
- **`AGENTS.md`** should list `bun run docker:build` and `bun run docker:smoke` (Docker and the database needed) with the other checks outside `agent:check`, and say that a new run-time dependency of the server must be declared in `apps/server/package.json` (the image build fails otherwise).
- **The README** gained the two commands; its rewrite should keep a pointer to `docs/deployment.md`.
- `scripts/container/*.main.ts` follow phase 7's one-line rule; `docker:smoke` runs through `scripts/with-env.main.ts` for `DATABASE_URL`.
- The Vite build prints a warning about its future native config loader (`import "./src/config"` without an extension in `apps/web/vite.config.ts`). It predates this phase and changes nothing today.

### Verification on the final commit (section 8)

Filled in on the final commit; see below and the PR description.
