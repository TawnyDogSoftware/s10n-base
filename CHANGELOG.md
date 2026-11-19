# Changelog

Scaffold-level changes to S10N Base, newest first. Projects created from an earlier version of the scaffold do not receive these changes automatically; use this file to decide what to port.

## Unreleased

### Removed: the desktop and local-first layer

The scaffold no longer assumes it runs as a local desktop app. Nothing replaces these yet; Postgres, auth and a new example domain come in later changes (see `plans/000-hosted-starter-rework.md`).

- **Desktop app:** `apps/desktop` (Electron), `scripts/wait-for-http.mjs`, the `dev:desktop` and `start:desktop` scripts, and every `dist-electron` entry in `.gitignore`, `.oxlintrc.json`, `turbo.json` and the `clean` script.
- **Local data:** the SQLite database (`better-sqlite3`), the `settings.json` file, the file logger, and the `S10N_BASE_HOME` runtime directory with its `data/` and `logs/` folders. The server no longer writes any file; logs are JSON lines on stdout.
- **WebSocket:** the activity hub, the `/ws` endpoint and its Vite proxy entry, and the `ws` dependency.
- **Demo domain:** the projects, notes, settings and activity contracts, services, RPC methods, web routes and stores, and `zustand`. `rpcContracts` is now an empty registry.
- **Contracts:** `DeleteResult`, `RPC_METHODS`, `EmptyPayload`, and the `websocketUrl` and `desktopHost` fields of `BootstrapConfig`. `defineRpc` is now exported, and a new `RpcRequest` schema describes the `{method, payload}` envelope.
- **Server:** the `bin` entry in `apps/server/package.json`. `POST /rpc` now answers 400 `rpc.invalid_request` for a body that is not a valid envelope (it was a 500 for invalid JSON), and 404 `rpc.method_not_found` for any method.
- **Environment variables:** `S10N_BASE_HOME`, `S10N_BASE_SERVER_URL` and `VITE_DEV_SERVER_URL`.
- **Build info:** the committed `tsconfig.tsbuildinfo` files; `*.tsbuildinfo` is now ignored.
- **Docs:** `EXTRACTION_REPORT.md`, and the desktop, settings, WebSocket, runtime-files and example-domain sections of the README and customization guide.
