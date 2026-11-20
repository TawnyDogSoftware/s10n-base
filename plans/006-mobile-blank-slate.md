# 006: Mobile blank slate

> Status: implemented on 2026-11-19, first boot on a Mac pending (`docs/mobile-first-boot.md`). On branch `feature/001-strip-desktop-and-local-first` (PR #1, which carries the whole rework).

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

Implemented on 2026-11-19 on Linux, Node 26.13.1 and bun 1.4.4, with Docker for the local Postgres. Registry data was read the same day. **The app was not booted on any simulator or device**; everything below was proven on Linux, and the first boot waits for the owner (section 2).

### Versions

Every Expo-managed package went in through `EXPO_OFFLINE=1 bunx expo install` in `apps/mobile`, except `expo` itself, which `expo install` needs installed first: it went in with `bun add expo@~58.0.25`, the SDK patch the age gate allows.

| Package | Version | Why |
| --- | --- | --- |
| `expo` | `~58.0.25` | the SDK; 58.0.26 (2026-11-17) is too young |
| `react-native` | `0.88.1` | |
| `expo-router` | `~58.0.31` | 58.0.32 (2026-11-17) is too young |
| `expo-dev-client` | `~58.0.20` | 58.0.21 (2026-11-17) is too young |
| `expo-secure-store` | `~58.0.3` | the session cookie |
| `expo-linking`, `expo-constants`, `expo-network`, `expo-web-browser` | `~58.0.17`, `~58.0.16`, `~58.0.5`, `~58.0.8` | peers of `@better-auth/expo`; `expo-linking` and `expo-constants` are also expo-router's; `expo-web-browser` 58.1.0 (2026-11-17) is too young |
| `expo-localization`, `expo-splash-screen`, `expo-status-bar`, `expo-system-ui` | `~58.0.5`, `~58.0.14`, `~58.0.5`, `~58.0.7` | locale, splash, status bar, light and dark on Android |
| `react-native-screens`, `react-native-safe-area-context`, `@expo/metro-runtime` | `~4.30.1`, `~5.11.1`, `~58.0.17` | required peers of expo-router |
| `react-native-web` (dev) | `~0.21.4` | the tests |
| `uniwind` | `^1.13.2` (catalog) | D7; 1.14.0 (2026-11-17) is too young |

Reused from the catalog: `react` 19.3.0, `better-auth` and `@better-auth/expo` 1.7.25, `@tanstack/react-query`, `i18next`, `react-i18next`, `tailwindcss`, `effect`, and the test stack. The lockfile went from 375 to 956 packages.

**The age gate and `expo install` disagreed, as expected, and not where expected.** `expo install` does not read the installed SDK's `bundledNativeModules.json` by default: it asks Expo's servers for the newest version map of the SDK line, which on 2026-11-19 already named the 2026-11-17 patches, so its `bun add` failed with `blocked by minimum-release-age` for `expo-router`, `expo-dev-client` and `expo-web-browser`. With `EXPO_OFFLINE=1` it uses the installed `expo` package's own map, which the gate had allowed. The gate was not lifted. `EXPO_OFFLINE=1 bunx expo install --check` passes; the online check reports `expo` 58.0.26, `expo-dev-client` 58.0.21, `expo-router` 58.0.32 and `expo-web-browser` 58.1.0, all published 2026-11-17 and allowed from 2026-11-20, when the daily update brings them. CI runs the offline check, which depends only on the lockfile; the daily update runs the online one and reports the drift (dry run below).

**`bun audit`** reported one advisory after the install: GHSA-g3hv-75wg-m249 (moderate, `minimatch` before 11.0.1), reached only through `expo` → `@expo/fingerprint` 0.21.10, which asks for `^10.2.6`. A root override `minimatch` `^11.0.8` clears it; `@expo/fingerprint`'s hash of `apps/mobile` is the same before and after (`c8e50df…`, 48 sources). Afterwards: no vulnerabilities (768 packages).

### What Metro and bun's linker needed

Nothing beyond Expo's defaults. With bun's default (isolated) linker, `expo export` bundles both platforms from a fresh clone, Metro follows the workspace symlinks and bundles `@s10n-base/client`, `contracts`, `i18n` and `shared` from their TypeScript source, and the bundle has one copy of `react`, `react-native`, `expo`, `expo-modules-core` and every other package (checked from the source maps by `scripts/mobile-bundle/check.ts`). `linker = "hoisted"` was not tried, because nothing failed without it. `metro.config.cjs` is Expo's config with the test files and `src/test/` block-listed, wrapped by Uniwind's.

Two things the isolated linker does that look like problems and are not, as far as Linux can tell:

- An incremental `bun add` left a second, unreferenced store entry of `react-native` and `expo`; a clean install has one. Clean installs are what CI and a fresh clone get.
- `expo-doctor` reports `expo-linking` and `expo-status-bar` installed twice: the same version, stored under two peer-dependency hashes with identical links. The bundle has one copy of each, and `expo-modules-autolinking resolve` lists each of the 27 native modules once. Whether `pod install` agrees is a first-boot check. `expo-doctor` (1.21.8) passed 18 of 20 checks; the other failure is the online version drift above.

### What the Expo config could and could not import

Expo SDK 58 loads `app.config.ts` with Node: it strips the types and loads the file as CommonJS through `@expo/require-utils`. It **can** import relative files with an explicit `.ts` extension (hence `allowImportingTsExtensions` in the app's tsconfig), workspace files that import nothing themselves (`@s10n-base/shared/app-variants`, and the theme's token reader exported as `@s10n-base/theme/tokens`), and Node built-ins; `import.meta.url` works, so `createRequire(import.meta.url).resolve("@s10n-base/theme/theme.css")` finds the theme file. It **cannot** import a relative file without its extension (`Cannot find module './src/config/spike'`), or any workspace module whose own imports are extensionless (`@s10n-base/client/rpc` fails with `ERR_MODULE_NOT_FOUND` on `transport`), the same cause as plan 005's Vite config. So the variant table stays one table in `packages/shared`, with no change: the smallest arrangement was the existing one, plus the rule that its files import nothing.

### The mobile passkey findings, in brief

Not shippable without a real https domain. Better Auth's passkey client needs the browser's WebAuthn API; a native flow needs a native module (`expo-better-auth-passkey`, a community drop-in, or `react-native-passkeys`), associated domains on iOS with an `apple-app-site-association` file the server would serve, `assetlinks.json` on Android, and the passkey plugin's `origin` extended with an `android:apk-key-hash:` origin per signing certificate. The relying party id is `APP_URL`'s host, so `localhost` and plain http cannot work on a phone. Details and sources are in `docs/mobile-dev.md`. No passkey library was installed.

### Departures from this plan, with reasons

- **Screens live in `src/screens/`, and `src/app/` route files only re-export them**, because expo-router bundles every file under `src/app/`; tests sit next to the screens.
- **Shared logic moved into `packages/client`** (section 7's rule): `runAuthAction` and `trackNetworkFailures` (the lost-response handling of the web adapter), the field validation, `errorMessageKey`, `checkFields`, `usePending`, and the web tests' fake server (with a new cookie mode). `packages/client` now imports `packages/i18n` (for the message keys) and `packages/shared` (the cookie prefix, for the fake server); plan 005 allowed only `contracts` and `shared`. Moving them found a bug: `checkFields` reported success when an invalid field's ref was not mounted.
- **The cookie prefix moved to `packages/shared/src/auth.ts`**, which imports nothing, rather than to `contracts`; the server re-exports it from its options module.
- **The splash and Android icon colours come from `packages/theme/theme.css`**, read when the config loads, so no colour is written in `apps/mobile` (section 7). The native config needs literal colours; the theme file stays the only source.
- **The development variant allows plain http on iOS** (`NSAllowsArbitraryLoads` in development only), so a phone can reach a server on the local network without rebuilding when the address changes. Preview and production keep App Transport Security's defaults and require https at config time.
- **Only the development variant registers the dev client's scheme** (`expo-dev-client`'s `addGeneratedScheme`), found in the generated projects: the scheme comes from the slug every variant shares, so three installed variants would all claim it.
- **The development default API origin is `http://localhost:4210`**, the API server itself, not the Vite dev server.
- **`typecheck` in `apps/mobile` first runs `expo customize tsconfig.json`**, which writes expo-router's typed-route declarations without a dev server (about a second, offline); a link to a missing route then fails `typecheck`. It leaves the committed tsconfig unchanged.
- **`src/uniwind-types.d.ts` is committed and excluded from the formatter**: Uniwind regenerates it on every Metro or test run in its own format.
- **CI**: the offline `expo install --check` in the existing job; a second job runs `bun run mobile:export` (both bundles and the bundle check) and `expo prebuild --no-install`, then `scripts/mobile-bundle/check-prebuild.ts` checks the generated identifiers. The second job takes about 90 seconds.
- **`eas.json` uses `appVersionSource: "local"`**, so nothing reads versions from EAS's servers.
- **Admin list on mobile** shows each user as a card with role, verification, status and join date, since a phone has no room for the web's table.
- **Sign-out on mobile cannot be left "unknown"**: the Expo client clears the stored cookie before sending, so the session read afterwards is always signed out. The screen still runs it through `gate.settle` like the web.
- **New i18n keys:** `auth.checkEmail.inBrowser`, `auth.checkEmail.toSignIn`, `auth.forgotPassword.inBrowser`, `profile.session.introApp`, `common.startError.*`, and `admin.detail` (a label and its value, so the separator is translatable).

### Review rounds

Codex reviewed the PR's head after each push. Each finding was reproduced with a failing test before the fix.

- **Round 1 (f2a7908), two findings, both fixed:**
  - **The session cookie was never renewed.** `GET /api/app-auth/session` read the session through Better Auth's server API and dropped the `Set-Cookie` it produces once a session is a day old, so an active user, on the web or on mobile, was signed out seven days after signing in, although the database session had been extended. I had noted it as found and not fixed; Codex flagged it too. The route now passes the cookies on (`AppAuth.readSession`), a live test ages a session and checks the renewed cookie and expiry, and the mobile app stores a renewal from any response in SecureStore through the Expo client's own storage adapter (`withAuthCookie`), with a test in which the old token stops working.
  - **A connection lost while an auth answer's body was read** was not counted as a lost answer: `fetch` had already resolved, so `runAuthAction` passed on a raw error instead of a `NetworkError`, and a password reset that had changed the password could be reported as a failure. The tracker now reads the body inside its count.

### Claims in plans 000 to 006 that did not hold

- Plan 000: expo-router 58.0.32 is too young for the 3-day rule on 2026-11-19 (58.0.31), and so are `expo` 58.0.26, `expo-dev-client` 58.0.21 and `expo-web-browser` 58.1.0 (the research noted the last two).
- Plan 000 and the research expected `linker = "hoisted"` might be needed for Metro: it was not, for bundling and autolinking. The native build is still unverified.
- Section 4: `expo install` alone does not land on "the newest version inside the SDK's range that the gate allows": it fails until run with `EXPO_OFFLINE=1`.
- Section 10, step 6 ("sign out on the web, return to the app: it notices"): a web sign-out ends only the browser's session; the app has its own. The checklist uses a password reset, which ends every session.
- Section 9's "bunx expo-doctor" reports two failures that are not defects of this app (above).
- Plan 005 section 11 listed four Uniwind questions for a device. The export shows the theme imported from another package resolves under Metro and its light and dark values reach the bundle, and that `--color-*: initial` and the font stack cause no build error. Whether they render correctly is still a device check.

### Found, not fixed (for later phases)

- **Phase 7 (ESLint, knip, dependency-cruiser, coverage, audit):** ignore `apps/mobile/.expo/`, `expo-env.d.ts`, `src/uniwind-types.d.ts` and `dist/` (the generated router types start with `/* eslint-disable */`). knip should know that `expo-dev-client`, `expo-splash-screen`, `expo-system-ui`, `expo-web-browser`, `expo-network`'s peer role, `react-native-screens`, `react-native-safe-area-context` and `@expo/metro-runtime` are used natively or as peers, not imported; and that `@s10n-base/client/testing/fake-backend` and `scripts/mobile-bundle/*` are test or CI entry points. dependency-cruiser: `apps/mobile` imports `client`, `contracts`, `i18n`, `shared` and `theme` (CSS and `tokens` in the config), and `packages/client` now imports `i18n` and `shared`. The i18n rule should find nothing in `apps/mobile/src` outside tests; the variant display names are in `packages/shared`, not the catalog, because the Expo config cannot load i18next. Coverage of `apps/mobile` was not measured. Keep the `minimatch` override until Expo's tooling moves to 11; the research's `glob` override was not needed (no advisory today).
- **Phase 9 (rename script):** the identity to rename is in `packages/shared/src/app-variants.ts` (schemes, bundle identifiers, display names), `packages/shared/src/auth.ts` (cookie prefix), `apps/mobile/src/config/expo-config.ts` (`slug: "s10n-base"`, which also names the dev client's scheme `exp+s10n-base`), `apps/mobile/package.json` (`@s10n-base/mobile`), and the generated iOS project name, which follows the display name. The SecureStore key prefix (`auth_<hex of the API origin>`) has no project name in it.
- **The scrub check** must run without build output: Metro's exported source maps in `apps/mobile/dist` contain third-party code with common words on the denylist. `dist/` is ignored by git, so it never reaches the repo; delete it before the check.

### Verification on the final commit (section 11)

Recorded in the pull request description (PR #1, section "Phase 6", "Tests and verification (plan 006 section 11)"), not in this file. (Corrected by phase 9: this line used to say "see below", and nothing followed.)
