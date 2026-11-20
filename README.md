# S10N Base

A starter for hosted, multi-user web and mobile apps. It gives a new project a working server, web app and mobile app on day one: people can sign up, confirm their email, sign in, manage their profile, and an admin can list users. Behind that are the parts every project would otherwise build again: Postgres with migrations, auth, email, typed contracts between server and clients, strict quality gates, CI and a container image. It is meant for small teams, and for coding agents working under their review, who want to start on product work instead of scaffolding. A project starts from it as a template and renames it in one command.

## What is built in

- **Server** (`apps/server`): Node `node:http` with validated configuration, an ordered startup and graceful shutdown on Effect's core, health and readiness checks, and an RPC endpoint where every method declares who may call it.
- **Web** (`apps/web`): React 19, Vite, TanStack Router and Query, Tailwind 4: sign-up, sign-in with a password or a passkey, email confirmation, password reset, a profile page and an admin user list.
- **Mobile** (`apps/mobile`): Expo SDK 58 with expo-router and Uniwind: the same screens except passkeys. Written and tested on Linux; the first boot on a Mac is pending ([docs/mobile-first-boot.md](docs/mobile-first-boot.md)).
- **Auth**: Better Auth with email and password, passkeys on the web, roles, and the native app's session, behind a route allow-list.
- **Email**: a small Amazon SES client of our own, and a local capture server with an inbox, so every email flow works on a fresh clone with no account.
- **Database**: Postgres 18 with Kysely, numbered migrations run by their own command, generated types, and a live-database test lane.
- **Shared packages**: contracts, an API client with per-user query state, a theme both apps style with, and typed translations.
- **Gates**: one command runs commit-attribution, lint with no suppressions, type-checked ESLint, format, typecheck, layering, dead-code, 100% coverage and audit checks; browser journeys with an accessibility check run separately.
- **CI**: five jobs on every pull request, and a daily pull request with every dependency update at least three days old.
- **Image**: one hosting-neutral container image with the server, the web build and a separate migrate command.

## Quick start

You need Node (the version in `.nvmrc`), bun (the version in `packageManager` in `package.json`) and Docker with Compose v2.

```bash
bun install
bun dev
```

`bun dev` starts Postgres, applies the migrations, and runs the server, the web app and the local email inbox until you press Ctrl-C.

- Open the app at [http://localhost:5173](http://localhost:5173) and create an account.
- Emails are captured, not sent: open the confirmation link from the inbox at [http://127.0.0.1:8005/](http://127.0.0.1:8005/).
- Make yourself an admin, then open **Users** in the header:

  ```bash
  bun run auth:set-role you@example.com admin
  ```

The mobile app runs against the same server: `bun run dev:mobile`, and on a Mac `bun run ios:simulator` for the first build ([docs/mobile-dev.md](docs/mobile-dev.md)).

## Layout

```text
apps/
  server/      the API, auth and migrations; serves the web build in production
  web/         the web app
  mobile/      the Expo app
packages/
  contracts/   schemas shared by server and clients: RPC methods, sessions, error codes
  client/      the API client, session state and screen logic both apps share
  shared/      small helpers that import nothing
  theme/       the design tokens both apps style with
  i18n/        translations for both apps and the server's emails
scripts/       development, quality gates, dependency updates, rename, checks
e2e/           browser journeys
docker/        the Dockerfile and the local database's init script
docs/          how-to guides and decision records
plans/         numbered plans: how the base was built and why
```

## Commands

| Command                                          | What it does                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `bun dev`                                        | Database, migrations, server, web app and inbox, in development            |
| `bun run agent:check`                            | Every gate that needs no database or browser; run it before every push     |
| `bun run test:live`                              | The server's tests against Postgres (`bun run db:up` first)                |
| `bun run test:e2e`                               | Builds, then the browser journeys in Chromium                              |
| `bun run build`, `bun run smoke`                 | Builds everything, then starts the built server, checks it and stops it    |
| `bun run mobile:export`                          | Bundles the mobile app for both platforms and checks the bundle            |
| `bun run docker:build`, `bun run docker:smoke`   | Builds the image and runs it in production mode against the local database |
| `bun run db:migrate`, `db:status`, `db:generate` | Applies migrations, lists them, regenerates the database types             |
| `bun run auth:set-role <email> <role>`           | Changes a user's role                                                      |
| `bun run rename`, `bun run rename:proof`         | Gives a new project its names; proves a renamed copy still passes          |
| `bun run deps:update --dry-run`                  | Previews the daily dependency update                                       |
| `bun run fmt`, `bun run clean`                   | Formats; removes installed packages and build output                       |

[docs/setup.md](docs/setup.md) has every command, the environment variables and the database; [docs/quality.md](docs/quality.md) has each gate.

## Starting a new project

Use the repository as a template, run `bun run rename` with your names, and follow [docs/new-project.md](docs/new-project.md) for what to keep, the secrets to add and the first deployment.

## Docs

[docs/README.md](docs/README.md) lists every guide. The main ones: [setup](docs/setup.md), [quality gates](docs/quality.md), [auth](docs/auth.md), [the client package](docs/client.md), [translations](docs/i18n.md), [mobile development](docs/mobile-dev.md), [dependencies](docs/dependencies.md), [deployment](docs/deployment.md), and the [decision records](docs/adr/README.md).

## Conventions

- Run `bun run agent:check` before every push; fix the code, never the gate.
- Every RPC method declares its auth level; migrations are numbered and append-only; clients never import the server.
- A new dependency needs a reason; packages stay at least three days old; Expo's packages move only with `expo install`.
- Changes start as numbered plans in `plans/`, and every scaffold-level change gets a `CHANGELOG.md` entry.
- Commit messages say what changed and why, with no tool attribution.

The full rules are in [AGENTS.md](AGENTS.md).

## Credit

Derived from [T3 Code](https://github.com/pingdotgg/t3code), keeping its repository shape and developer workflow while removing its product-specific behaviour.
