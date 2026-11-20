# 003: Email and password, the Expo and admin plugins, and passkeys are on by default

- **Status:** Accepted, 2026-11-18.

## Context

A starter should sign people in on day one without each project wiring auth again, but every feature switched on is surface to secure and keep upgraded. Every project built on this base needed email and password with verified addresses, a native app session, and a way to tell administrators from users. Two of the three used passkeys; organizations and social sign-in were product-specific.

## Decision

On by default:

- **Email and password**, with email verification required and sessions revoked on a password reset.
- **The `expo` plugin**, so the mobile app's session works with a native cookie store.
- **The `admin` plugin**, with default role `user` and admin role `admin`. Its stock remove-user endpoint is turned off, because removing a user needs cleanup only the product knows about; a project adds its own guarded version.
- **Passkeys**, on the web. Native passkeys on mobile were investigated and not shipped: they need a real https domain with association files and per-platform signing details, which a template cannot provide.

Documented as recipes, not on: the organization plugin and social sign-in ([docs/auth.md](../auth.md#recipes)).

## Consequences

- A fresh clone has working sign-up, verification, sign-in, password reset, roles and web passkeys, with emails captured locally.
- `@better-auth/passkey` is a third package that must stay on the same version as `better-auth` and `@better-auth/expo`.
- The mobile app signs in with email and password only until a project sets up a domain for native passkeys; [docs/mobile-dev.md](../mobile-dev.md#passkeys-on-mobile-not-implemented) lists what that takes.
- Every route these plugins add has to be decided in the allow-list ([002](002-better-auth-behind-an-allow-list.md)).

## Revisit when

- Most projects built from the base turn passkeys off, or turn organizations or social sign-in on: the default should follow what projects do.
- Better Auth ships a supported native passkey client for Expo.
