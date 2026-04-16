# Customization Guide

## Recommended Order

1. Rename the scaffold.
2. Replace the example domain contracts.
3. Update the server services and persistence schema.
4. Update the web routes and forms.
5. Decide whether to keep desktop.
6. Add any app-specific auth, billing, or external integrations.

## Rename Checklist

- Change the root package name in `package.json`.
- Rename workspace packages from `@s10n-base/*` if `s10n-base` is not your final scope.
- Update the app name in `apps/server/src/config.ts`.
- Update the Electron window title in `apps/desktop/src/main.ts` if you keep desktop.

## Replacing The Example Domain

The cleanest path is to update the boundary first.

Files to change first:

- `packages/contracts/src/domain.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/events.ts`

Then update the server implementation:

- `apps/server/src/persistence/database.ts`
- `apps/server/src/services/projectService.ts`
- `apps/server/src/http/routes.ts`

Then update the web client:

- `apps/web/src/rpc/queries.ts`
- `apps/web/src/routes/*.tsx`
- `apps/web/src/components/AppShell.tsx`

## Settings Strategy

This scaffold demonstrates two kinds of settings:

- Server settings persisted to the filesystem and exposed through typed RPC
- Client-only UI settings persisted locally with Zustand

Keep that split unless a setting truly belongs on one side only.

## WebSocket Strategy

The activity stream is intentionally simple.

Reuse this pattern when you need:

- live notifications
- optimistic activity feeds
- presence state
- background job progress

If your app grows more event-heavy, split the stream by channel or event family before adding more client complexity.

## Contracts Boundary Rules

- Keep cross-boundary schemas in `packages/contracts` only.
- Do not move runtime helpers or database logic into contracts.
- Keep web and desktop dependent on the server/contracts boundary, not server internals.

## Desktop Decision

Keep `apps/desktop` only if you want a desktop host that launches the local server.

Remove it if:

- your product is web-only
- Electron is not part of your distribution plan
- you do not want local desktop packaging overhead yet

If you remove it, also remove:

- `apps/desktop`
- `dev:desktop` and `start:desktop` scripts from the root package

## Optional Next Steps

1. Add authentication to the `/rpc` and `/ws` boundary.
2. Add more explicit domain errors in `packages/contracts/src/base.ts`.
3. Split `ProjectService` into multiple smaller services if your domain grows.
4. Add API or end-to-end tests once the surface area expands.
