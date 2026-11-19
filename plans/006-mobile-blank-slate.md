# 006: Mobile blank slate

> Status: not started.

Phase 6 of [000](000-hosted-starter-rework.md). Builds on [004](004-auth.md) and [005](005-web-blank-slate.md). Source labels such as `[S7]` are resolved in the private companion's README; nothing from that directory is copied into this repo.

## 1. Goal

`apps/mobile`: an Expo app with the same signed-in blank slate as the web app, sharing `contracts`, `client`, `theme` and `i18n`. A person can sign up, sign in with email and password, see the signed-in home, edit their profile, sign out, and an admin can see the user list.

## 2. What this phase can and cannot prove

This work is done on Linux with no simulator or emulator. Plan 000 says the phase **is not done until someone boots the app on a simulator from a fresh clone on a Mac**, and that stays true. So this plan has two parts:

- **Here:** everything that can be proven without a device: config, types, tests, a Metro bundle for both platforms, a native project generated from the config, and CI for all of it.
- **Owner, on a Mac:** the first boot, following the checklist in section 10. Until that is done and recorded, the status of this plan is "implemented, first boot pending", never "done". Say this plainly in the PR description, the changelog and plan 000.

## 3. Out of scope

| Not in this phase | Owner |
|---|---|
| ESLint, knip, dependency-cruiser, the coverage threshold | Phase 7 |
| Mobile end-to-end tests on a device | Later recipe |
| Over-the-air updates, store submission, push notifications, analytics, an on-device database | Recipes or left out |
| Universal links and app links (they need a real domain and its association files) | Recipe in the docs |
| Passkey sign-in on mobile | Open item: investigate and report (section 8), do not ship |

D7 is fixed: Uniwind with the shared `packages/theme` token file.

## 4. Dependencies

- **Expo SDK 58** and the packages it manages, added **only** with `bunx expo install`, so each lands on the version the SDK expects: `expo`, `react-native`, `expo-router` and the packages it requires, `expo-dev-client`, `expo-secure-store`, `expo-linking`, `expo-constants`, `expo-network`, `expo-web-browser` (the last four are peers of `@better-auth/expo`), `expo-localization`, `expo-splash-screen`, `expo-status-bar`, `expo-system-ui`. Add nothing from this family that the app does not import or that is not a required peer.
- `uniwind` (D7), and `react-native-web` as a dev dependency for the tests.
- Already in the catalog and reused: `react` (19.3.0, the version the SDK pins), `better-auth`, `@better-auth/expo`, `@tanstack/react-query`, `i18next`, `react-i18next`, `tailwindcss`.

**The age gate and Expo can disagree:** `expo install` may ask for a patch published less than 3 days ago. Take the newest version inside the SDK's range that the gate allows; do not lift the gate. Afterwards `bunx expo install --check` must pass, or each drift must be listed with its reason and the date it resolves. Record the final versions in section 11.

The hold list (`dependency-holds.json`) already covers the Expo family. Confirm the daily update script's `expo install --check` step now runs and reports correctly in a dry run.

## 5. Monorepo and Metro

- Start with **bun's default linker**, as plan 000 says. Do not add `linker = "hoisted"` unless Metro cannot be made to resolve the workspace without it; if you must, record exactly what failed.
- `metro.config.cjs`: Expo's default config wrapped with Uniwind's, and test files (`*.test.*`, `src/test/**`) block-listed so they never enter a bundle.
- Workspace packages export TypeScript source. Confirm Metro bundles `@s10n-base/contracts`, `shared`, `client`, `theme` and `i18n` from source, and that there is exactly one copy of `react` in the bundle.
- `ios/` and `android/` are generated, never committed, and ignored by git.

## 6. Config

- `packages/shared/src/app-variants.ts` gains a bundle identifier per variant (neutral placeholders in reverse-domain form under `com.example`). It remains the one table read by the server (trusted origins) and by the Expo config.
- `apps/mobile/app.config.ts` is a thin wrapper over a tested `buildExpoConfig(env)` in `src/config/`:
  - `APP_VARIANT` (`development`, `preview`, `production`; default `development`) selects name, URL scheme, iOS bundle identifier and Android package. Variants install side by side.
  - `EXPO_PUBLIC_API_BASE_URL`: validated as a bare origin; `https` required unless the variant is `development`. Missing in `preview` or `production` is an error at config time, not a crash at run time.
  - `EAS_PROJECT_ID`: optional; a project sets it when it creates its EAS project.
  - Light and dark both supported; the new architecture on; typed routes on.
  - Expo evaluates this file in Node. Check whether it can import the variant table from the workspace package as TypeScript; the web app's Vite config could not (plan 005 section 11). If it cannot, find the smallest arrangement that still leaves one table, and record it.
- `apps/mobile/.env.example`, and the variables added to `docs/setup.md`.
- The auth cookie prefix moves to a shared constant so the server and the mobile auth client cannot disagree.
- `eas.json`: `development` (development client, internal distribution), `development-simulator` (the same for the iOS simulator), `preview` and `production`, each setting `APP_VARIANT`. No update channels, since over-the-air updates are out of scope.
- Placeholder icon and splash images, generated, neutral.

## 7. App

- **Auth client:** Better Auth's React client with `expoClient`: SecureStore for storage, the variant's scheme, the shared cookie prefix, and a storage prefix derived from the API origin, so pointing a build at another server never reuses the other server's session.
- **RPC and session:** `@s10n-base/client` as it is, constructed with the explicit base URL and a `fetch` that attaches the auth client's cookie. No relative URLs, no browser cookie jar.
- **Query lifecycle:** TanStack Query's focus manager wired to `AppState` and its online manager to `expo-network`, so the session is re-read when the app returns to the foreground. Without this a session revoked elsewhere is never noticed.
- **The session gate** from `packages/client` wraps the signed-in part of the app, with the same purge rules as web.
- **Screens** (expo-router, groups `(auth)` and `(app)`):

  | Screen | Notes |
  |---|---|
  | Sign up | Name, email, password; then "check your email". |
  | Sign in | Email and password. An unverified account gets the "check your email" state with a resend. |
  | Forgot password | Always the same answer. |
  | Home | Greeting; links to profile and, for admins, users. |
  | Profile | Edit name; show email; sign out. No passkey section. |
  | Users | Admin only, with "load more"; a non-admin sees "not allowed". |

- **Email links open in the browser.** Verification and reset emails link to the web app (`APP_URL`), where phase 5's pages finish the job; the person then returns to the app and signs in. The "check your email" screen says so. This is deliberate: opening those links in the app needs universal links.
- **Shared logic stays shared:** validation limits come from contracts; error messages from the `errors` namespace; the lost-response handling follows the web adapter (plan 005 section 11). If the same code would be written a second time, move it into `packages/client` instead and have web use it too.
- **Styling:** Uniwind classes backed by `packages/theme`; no colour or radius literal in `apps/mobile/src`. Light and dark follow the system.
- **i18n:** `@s10n-base/i18n/react`, with the locale from `expo-localization` through `resolveLocale`. No hard-coded user-visible string.
- **Accessibility:** labels, roles and states on every control; errors announced; text scales with the system font size.

## 8. Mobile passkeys: investigate, report, do not ship

No project of ours has a verified native passkey flow. Find out, from current documentation and package sources, what a native flow with `@better-auth/passkey` on Expo SDK 58 would need (client library, associated domains and the server's association files, relying-party id, Android's equivalent, simulator support) and whether anything in this base would have to change. Write the findings into `docs/mobile-dev.md` under a clearly marked "not implemented" heading, with sources. Do not install a passkey library.

## 9. Tests and CI

- **Unit and component tests** under Vitest with jsdom and `react-native-web`, as a project in the root config so coverage merges later `[S7]`. Fakes for SecureStore, expo-router navigation, `AppState` and `expo-network`. Written first: `buildExpoConfig` for each variant and each invalid input; the storage prefix; the cookie-attaching fetch; focus and online wiring; each screen's states; the guards between `(auth)` and `(app)`; the purge on user change.
- **A real Metro bundle:** `bunx expo export --platform ios` and `--platform android` succeed from a clean install. This is the main evidence, short of a device, that Metro resolves the workspace under the default linker.
- **A real native project:** `bunx expo prebuild --no-install` for both platforms in a temporary copy succeeds, and the generated projects carry the variant's bundle identifier, scheme and name. `pod install` cannot run on Linux; say so.
- **`bunx expo install --check`** and **`bunx expo-doctor`** results recorded; fix what they report or explain it.
- **CI:** the existing job gains mobile typecheck and tests (through the root scripts), `expo install --check`, and the two exports. If the exports make the job much slower, put them in a second job in the same workflow rather than dropping them.
- Root scripts: `dev:mobile`, `ios:simulator`, `ios:device`, `android`, and `mobile:export`.

## 10. Docs and the Mac checklist

- `docs/mobile-dev.md` `[S7]`, rewritten in neutral terms:
  - Variants, environment, commands.
  - The first simulator build on a Mac from a fresh clone.
  - Moving to a physical phone.
  - Pointing a phone at a server on your own machine: what `APP_URL`, `EXPO_PUBLIC_API_BASE_URL` and the trusted origins must be, plain HTTP in development, and that the local email inbox listens on loopback only.
  - A playbook for testing on a physical phone over a private network, written without naming any vendor.
  - The Linux-to-Mac round trip for a team that develops on Linux.
  - Styling, tests, the rule that native modules are added only with `expo install`, and the passkey findings.
- **`docs/mobile-first-boot.md`: the owner's checklist**, short enough to follow in one sitting, with a place to record each result:
  1. Fresh clone, `bun install`, start the server stack with `bun dev`.
  2. Build and boot the development variant on an iOS simulator. Record Xcode, macOS and CocoaPods versions, and whether the default linker worked or what had to change.
  3. Sign up in the app, read the email in the local inbox, verify in the browser, sign in in the app, edit the name, sign out.
  4. Make the user an admin and open the user list.
  5. The four Uniwind points plan 005 could not check without a device: a colour declared both in `@theme` and in the per-mode blocks; `--color-*: initial`; the theme imported from another package; the font stack. Plus light and dark.
  6. Kill and relaunch: still signed in. Sign out on the web, return to the app: it notices.
  7. Optional: the Android emulator.
- `CHANGELOG.md`: an entry that states the first boot is pending.
- `plans/000-hosted-starter-rework.md`: status line ("phase 6 implemented, first boot on a Mac pending"), and correct anything this phase disproved.

## 11. Verification and definition of done

On the final commit, recorded in section 12 and the PR description:

1. From clean: frozen install, `fmt:check`, `lint`, `typecheck`, `test`, `build`.
2. Database up: `test:live`, `smoke` (the server changed only by the shared constants).
3. `expo install --check`, `expo-doctor`, both exports and both prebuilds, with their output summarised and the bundle sizes.
4. One copy of `react` in the exported bundle (show how you checked).
5. `bun run deps:update --dry-run` shows the Expo check running.
6. `git grep` shows no colour literal and no hard-coded user-visible string in `apps/mobile/src` outside tests.
7. `bun audit`, the packages the lockfile gained, and any override that turned out to be needed with its advisory.
8. CI green on the head commit.
9. The scrub check from plan 000 prints nothing. Bundle identifiers, schemes and names are placeholders; the private-network playbook names no vendor, host or machine.

Implemented when sections 4 to 10 are in and the above passes. **Done only after the owner records the first boot** in `docs/mobile-first-boot.md`.

## 12. How it was built

Filled in by the implementor: versions, what Metro and the linker actually needed, what the Expo config could and could not import, the passkey findings in brief, and every departure with its reason.
