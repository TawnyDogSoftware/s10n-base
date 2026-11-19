# Customization Guide

## Recommended Order

1. Rename the scaffold.
2. Update the web routes.
3. Add any app-specific auth, billing, or external integrations.

## Rename Checklist

- Change the root package name in `package.json`.
- Rename workspace packages from `@s10n-base/*` if `s10n-base` is not your final scope.
- Update the app name in `apps/server/src/config/index.ts` (it is also the passkey relying-party name).
- Change the auth cookie prefix (`AUTH_COOKIE_PREFIX`) and the internal client-IP header (`CLIENT_IP_HEADER`) in `apps/server/src/auth/options.ts`.
- Replace the placeholder URL schemes and display names in `packages/shared/src/app-variants.ts`.

## Contracts Boundary Rules

- Keep cross-boundary schemas in `packages/contracts` only.
- Do not move runtime helpers or database logic into contracts.
- Keep the web app dependent on the server/contracts boundary, not server internals.

## Optional Next Steps

1. Decide which Better Auth routes your app exposes (`apps/server/src/auth/allowed-routes.ts`; see `docs/auth.md`).
2. Add more explicit domain errors in `packages/contracts/src/base.ts`.
3. Add API or end-to-end tests once the surface area expands.
