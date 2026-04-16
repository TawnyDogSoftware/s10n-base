# Extraction Report

## Goal

Create a reusable monorepo scaffold that preserves the source repo's architectural shape and developer workflow, while removing coding-agent-specific product behavior.

## Architecture Kept

- Bun workspace + Turbo monorepo root
- Strict shared TypeScript config
- `apps/web` as a React + Vite client
- `apps/server` as the application core
- `apps/desktop` as a thin Electron host
- `packages/contracts` as the source of truth for schemas and RPC contracts
- `packages/shared` for small cross-runtime helpers with explicit subpath exports
- Contracts-first boundary between server and clients
- Local-first runtime folders for data, config, and logs
- Separate server modules for config, persistence, HTTP, WebSocket, domain services, and observability

## Subsystems Removed

- Codex / Claude / provider integrations
- Orchestration engine, replay, thread/session internals
- Checkpointing and diff pipelines
- Git, worktree, pull request, and repo automation flows
- Terminal emulator and PTY management
- Pairing / remote access flows
- Product-specific auth and bootstrap flows
- T3 Code branding, assets, and naming
- Any domain logic that only exists for coding-agent workflows

## Replacement Example Domain

The scaffold replaces the removed product logic with a small generic domain:

- Projects
- Notes inside projects
- App settings
- A live activity stream over WebSocket

This proves the scaffold works end-to-end without embedding product-specific behavior.

## Definition Of Done

The scaffold is done when all of the following are true:

- the scaffold is self-contained and imports nothing from outside its own repo root
- the scaffold has its own root workspace and shared configuration
- The contracts package owns cross-boundary types and method/event schemas
- The server exposes `/health`, `/config`, `/rpc`, and `/ws`
- SQLite-backed CRUD for projects and notes works end-to-end
- Settings persist locally on the server filesystem
- The web app has list, detail, and settings screens with a minimal app shell
- The web app consumes typed RPC methods and a live WebSocket stream
- Desktop is retained only if it stays thin and delegates application logic to the server
- Minimal tests exist for contracts, server smoke behavior, and web route rendering
- `bun fmt`, `bun lint`, `bun typecheck`, and `bun test` pass in the scaffold repo
- No leftover T3 Code or coding-agent-specific naming remains in the scaffold

## Source To Scaffold Mapping

- Root workspace/tooling
  - Source reference: root `package.json`, `turbo.json`, `tsconfig.base.json`, `vitest.config.ts`
  - Scaffold result: independent workspace with equivalent workspace/task structure

- Contracts-first boundary
  - Source reference: `packages/contracts/src/*.ts`, especially `rpc.ts` and `server.ts`
  - Scaffold result: reusable contracts for entities, settings, bootstrap config, RPC methods, and stream events

- Shared runtime helpers
  - Source reference: `packages/shared/package.json`, `src/schemaJson.ts`, `src/logging.ts`
  - Scaffold result: minimal shared helpers for ids, JSON/schema decoding, paths, and log file rotation with subpath exports

- Server composition and separation
  - Source reference: `apps/server/src/server.ts`, `config.ts`, `http.ts`, `bootstrap.ts`, persistence modules
  - Scaffold result: simplified server split into `config`, `persistence`, `http`, `ws`, `services`, `observability`, `server.ts`, and `bin.ts`

- Web client structure
  - Source reference: `apps/web/src/router.ts`, `main.tsx`, `routes/__root.tsx`, store/rpc split
  - Scaffold result: simplified React app with TanStack Router, TanStack Query, Zustand, typed RPC client, and clean route/component/store separation

- Desktop wrapper
  - Source reference: `apps/desktop/src/main.ts`, `preload.ts`, `tsdown.config.ts`
  - Scaffold result: minimal Electron shell that launches the server, waits for readiness, and loads the web UI

## Intentional Omissions

- `packages/client-runtime` is omitted because the source package was too product-specific to justify keeping as reusable infrastructure
- `apps/marketing` is omitted because it does not materially help the scaffold architecture or the example domain

## Final Scope Decision

- `apps/desktop` was retained as a thin host that launches or attaches to the server and loads the web UI
- `apps/marketing` was not retained
- `packages/client-runtime` was not retained
