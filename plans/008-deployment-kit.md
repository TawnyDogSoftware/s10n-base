# 008: Deployment kit

> Status: not started.

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

Filled in by the implementor.
