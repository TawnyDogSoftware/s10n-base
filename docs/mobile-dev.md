# Mobile development

The mobile app is `apps/mobile`: Expo SDK 58, React Native 0.88 with the new architecture, expo-router, and Uniwind (Tailwind 4) on the shared theme. It has the same signed-in blank slate as the web app (sign up, sign in, forgot password, home, profile, the admin user list) and talks to the server through `packages/client`, like the web app.

It runs in a **development build** (a dev client), not in Expo Go, so the app's own URL scheme, bundle identifier and native modules are the ones the server and the stores see.

> **Status:** written and tested on Linux. **The first boot on a simulator from a fresh clone on a Mac is pending**; the checklist is [mobile-first-boot.md](mobile-first-boot.md). Until it is recorded, treat the Mac steps below as the plan, not as verified.

## Variants

`APP_VARIANT` picks one of three apps. Each installs side by side with the others and keeps its own data. The values come from `packages/shared/src/app-variants.ts`, which the server also reads for the origin it trusts (the URL scheme of its own `APP_VARIANT`). They are placeholders, which `bun run rename` replaces with your own ([new-project.md](new-project.md#3-rename)): do that before your first store build, because a bundle identifier cannot change after that.

| Variant       | Name                | URL scheme         | Bundle identifier / application id |
| ------------- | ------------------- | ------------------ | ---------------------------------- |
| `development` | S10N Base (Dev)     | `s10nbase-dev`     | `com.example.s10nbase.dev`         |
| `preview`     | S10N Base (Preview) | `s10nbase-preview` | `com.example.s10nbase.preview`     |
| `production`  | S10N Base           | `s10nbase`         | `com.example.s10nbase`             |

Only the development variant registers the dev client's own scheme (`exp+s10n-base`), since all variants share the slug it is made from.

## Environment

Expo reads these when Metro starts and when it builds, from your shell or `apps/mobile/.env.local` (copy `apps/mobile/.env.example`; `.env*` files are ignored by git). `app.config.ts` validates them through `buildExpoConfig` (`src/config/expo-config.ts`), so a bad value fails the build, not the app.

| Variable                   | Rule                                                                                                                     | Default                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `APP_VARIANT`              | `development`, `preview` or `production`; anything else fails the build                                                  | `development`                              |
| `EXPO_PUBLIC_API_BASE_URL` | The API's origin, with no path, query or credentials. `https` is required for preview and production, which must set it. | `http://localhost:4210` (development only) |
| `EAS_PROJECT_ID`           | Your EAS project's id, once you create one (`eas init`). Optional.                                                       | unset                                      |

The development default is the server `bun dev` starts, as an iOS simulator on the same Mac reaches it. The app calls the API server directly (port 4210), not the Vite dev server. The build's values reach the running app through `Constants.expoConfig.extra`, which `src/config/runtime.ts` reads and checks.

The splash screen's and Android icon's background colours are read from `packages/theme/theme.css` when the config loads, so the theme stays the only place a colour is written.

## Commands

From the repository root:

| Command                 | What it does                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `bun run dev:mobile`    | Metro for the dev client (`expo start --dev-client`). Press `i` for the iOS simulator, `a` for an Android emulator. |
| `bun run ios:simulator` | macOS: generates `apps/mobile/ios`, installs pods, builds the dev client and opens it in the iOS simulator.         |
| `bun run ios:device`    | macOS: the same on a connected iPhone.                                                                              |
| `bun run android`       | Builds the dev client and opens it on an Android emulator or device (needs the Android SDK).                        |
| `bun run mobile:export` | Bundles both platforms with Metro into `apps/mobile/dist` and checks the bundle (below).                            |

In `apps/mobile`: `bun run typegen` writes expo-router's typed-route declarations (`.expo/types`, ignored by git); `bun run typecheck` runs it first, so a link to a route that does not exist fails `typecheck`.

`apps/mobile/ios` and `apps/mobile/android` are generated (`expo prebuild` or `expo run:*`) and never committed. After changing a native module, `app.config.ts`, or anything in `packages/shared/src/app-variants.ts`, rebuild the dev client; a JavaScript change needs only Metro.

### EAS profiles

`eas.json` has `development` (the dev client, internal distribution), `development-simulator` (the same, built for the iOS simulator), `preview` (internal distribution) and `production` (the stores). Each sets `APP_VARIANT`. Preview and production also need `EXPO_PUBLIC_API_BASE_URL` set where the build runs (an EAS environment variable, or your shell for `--local`), or the build stops at the config. There are no update channels: over-the-air updates are not set up. Nothing in the repo creates an EAS project or runs an EAS build; that is yours to do when you need TestFlight, a store build or a team build.

## The first simulator build on a Mac

From a fresh clone. [mobile-first-boot.md](mobile-first-boot.md) is the same as a checklist with places to record the results.

1. Install Xcode, open it once to finish its components, and install an iOS simulator runtime (Xcode → Settings → Components; or `xcodebuild -runFirstLaunch` then `xcodebuild -downloadPlatform iOS`).
2. Install CocoaPods. Check `xcodebuild -version`, `pod --version`, `xcrun simctl list devices available`.
3. Install Node (the version in `.nvmrc`) and bun (the version in `packageManager`), then `bun install` at the repository root.
4. `bun dev` in one terminal: Postgres, migrations, the API on port 4210, the web app and the local inbox.
5. `bun run ios:simulator` in another. Expo generates `apps/mobile/ios`, runs `pod install`, builds **S10N Base (Dev)**, starts Metro and opens the app. No Apple developer membership, signing or EAS project is needed for a simulator build.
6. Later runs: `bun run dev:mobile` and press `i`. If the dev client shows its launcher, pick the running development server.

## Moving to a physical phone

**iPhone:** connect it to the Mac, trust the Mac, turn on Developer Mode (Settings → Privacy & Security), and add your Apple account in Xcode → Settings → Accounts. A free personal team can sign a development build for a few days at a time; a paid membership is needed for TestFlight and longer-lived builds. Run `bun run ios:device`.

**Android:** turn on developer options and USB debugging, connect the phone, and run `bun run android`.

The phone runs the app, loads its JavaScript from Metro on your computer, and calls the API. It cannot reach `localhost` on your computer, so point it at the server as below.

## Pointing a phone at a server on your own machine

The server listens on every interface by default (`HOST=0.0.0.0`), so a phone on the same network reaches it at your computer's address.

- **`EXPO_PUBLIC_API_BASE_URL`:** `http://<your-computer's-address>:4210`, for example `http://192.168.1.20:4210`. Restart Metro after changing it; the dev client does not need a rebuild.
- **Plain http** is fine in development: the development variant allows it on iOS (App Transport Security's arbitrary loads, development only), and Android debug builds allow cleartext traffic. Preview and production refuse anything but https at config time.
- **Trusted origins:** nothing to add. The app identifies itself with its URL scheme, which the server trusts for its own `APP_VARIANT` (keep both on `development`). `/rpc` and the session route accept requests without an `Origin` header, which is what the app sends.
- **`APP_URL`** is the web app's origin. It decides where the links in emails go. The links open the web app in a browser, which finishes the verification or the password reset; the person then returns to the app and signs in (the app's screens say so). To open those links on the phone, `APP_URL` must be an address the phone can reach, such as `http://192.168.1.20:5173`; the Vite dev server then listens on that address. Otherwise open the links on the computer: verifying in one browser verifies the account everywhere.
- **The local inbox listens on loopback only** (`http://127.0.0.1:8005/`), on purpose. Read the emails on the computer running `bun dev`.

Opening email links in the app instead of the browser needs universal links (iOS) and app links (Android): a real https domain serving association files. That is not set up; see "Later" below.

## Testing on a physical phone over a private network

When the phone and your computer are not on the same local network, or you want https end to end, use a private network: a mesh VPN or similar that gives each device a stable private name and can serve a local port over https with a certificate for that name. The steps, without naming any product:

1. Put the computer running the server and the phone on the private network, and turn on its https certificates if it needs that.
2. Serve the API port privately over https, for example `https://<computer-name>:8443` forwarding to `http://127.0.0.1:4210`. Keep the server bound where the forwarder can reach it; the private network is the only way in from outside.
3. In `apps/mobile/.env.local`: `EXPO_PUBLIC_API_BASE_URL=https://<computer-name>:8443`. This works with any variant, since it is https.
4. Metro: the phone also loads JavaScript from Metro (port 8081). Serve that port privately over https too (`https://<computer-name>:8447` forwarding to `http://127.0.0.1:8081`), and set `EXPO_PACKAGER_PROXY_URL` to that origin **in the shell that starts Metro** (`EXPO_PACKAGER_PROXY_URL=https://<computer-name>:8447 bun run dev:mobile`). Expo reads this variable before it loads `.env` files, so putting it only in `.env.local` does not work. Then pick that server in the dev client's launcher.
5. Check from the phone's browser: `https://<computer-name>:8443/health` answers `{"ok":true,…}` and `https://<computer-name>:8447/status` answers `packager-status:running`.
6. Emails: read them in the inbox on the computer, as above. To open the links on the phone, also serve the web dev server privately and set `APP_URL` to that origin; Vite answers only the host names it knows, so the forwarder must pass the name Vite listens on.

Metro can run on any machine on the private network that has the checkout, including a Linux machine: once the dev client is installed, the phone needs the Mac only to rebuild native code.

## The Linux-to-Mac round trip

For a team that writes code on Linux:

1. On Linux: change code, run the checks (`bun run agent:check`, and `bun run mobile:export` for a mobile change), commit and push. Everything except native builds and the simulator runs on Linux, and CI checks the same.
2. On the Mac: pull, `bun install`, then `bun run ios:simulator` (or `ios:device`) when native code, a native module or the config changed, or just `bun run dev:mobile` otherwise.
3. Try the change on the simulator or the phone. Record what native checks you ran with the commit they ran on; a Linux pass is not a native pass.

## Styling

Uniwind compiles Tailwind classes at build time. The tokens are `packages/theme/theme.css`, imported by `src/global.css`; screens use only token names (`bg-background`, `text-muted`, `border-border`, `rounded-md`), never a colour or radius of their own. Light and dark follow the system. `src/uniwind-types.d.ts` is generated by Metro and by the test run; it is committed so `typecheck` works on a fresh clone, and the formatter leaves it alone. Text scales with the system font size (React Native's default; the components do not cap it).

## Tests

`bun run test` runs the mobile project with the others: Vitest with jsdom, where Uniwind's Vite plugin points `react-native` at react-native-web, so screens render with their class names. Native modules are replaced at their import boundary in `src/test/setup.ts` (fakes in `src/test/native.ts`: SecureStore, expo-router navigation, expo-network, expo-localization, expo-linking, expo-constants). Screens are tested through the real auth client against the in-memory server from `@s10n-base/client/testing/fake-backend` in cookie mode, so the session cookie goes through SecureStore and every request as it does on a phone.

Route files in `src/app/` only re-export screens from `src/screens/`, because expo-router bundles every file in `src/app/`. Metro's `blockList` keeps every `*.test.*` file and `src/test/` out of the bundle.

`bun run mobile:export` also runs `scripts/mobile-bundle/check.main.ts` on the exported source maps. It fails on a second copy of React or another package that must be single, on test code in the bundle, or on a workspace package not bundled from its TypeScript source. CI runs it, and also generates the native projects (`expo prebuild --no-install`) and checks they carry the development variant's bundle identifier, scheme and name (`scripts/mobile-bundle/check-prebuild.main.ts`). `pod install` and Gradle need macOS and the Android SDK, so CI does not build native code.

## Native modules and versions

Expo owns the versions of `react`, `react-native` and every native module: add one only with `bunx expo install <package>` (in `apps/mobile`), never a bare `bun add`, so it lands on the version the SDK expects. The daily dependency update leaves them alone (`dependency-holds.json`) and reports drift from `bunx expo install --check`.

The 3-day rule (`bunfig.toml`) and `expo install` can disagree: by default `expo install` asks Expo's servers for the newest SDK patch versions, which may be younger than 3 days, and bun then refuses them. Run it as `EXPO_OFFLINE=1 bunx expo install <package>`: it then uses the version map of the `expo` package you have installed, which the gate already allowed. CI's check (`EXPO_OFFLINE=1 bunx expo install --check`) works the same way, so it depends only on the lockfile; the daily update runs the online check and lists the newer patches as drift until they are old enough.

bun's default (isolated) linker works for Metro and autolinking; nothing needs `linker = "hoisted"`. `expo-doctor` reports duplicate copies of a few Expo packages under that linker (the same version, stored twice because of how bun keys peer dependencies); the bundle check shows one copy in the bundle, and Expo's autolinking resolves each native module once.

## Passkeys on mobile: not implemented

**Mobile passkey sign-in is not implemented.** The web app has passkeys; the mobile app signs in with email and password. What a native flow would need, found on 2026-11-19 from current documentation and the installed packages' source (nothing was installed or run):

- **The client.** `@better-auth/passkey/client` calls the browser's WebAuthn API through `@simplewebauthn/browser`, which React Native does not have. A native flow needs a module that calls the platform's own passkey APIs: `ASAuthorizationPlatformPublicKeyCredentialProvider` on iOS 15+ and Credential Manager on Android 9+ with Google Play services. Candidates: `expo-better-auth-passkey` (a community drop-in for Better Auth's passkey client, Expo SDK 55+, 1.7.0 as of 2026-11-05) and `react-native-passkeys` (a general Expo module, wired to Better Auth's endpoints by hand). `expo-passkey` is a different mechanism (device keys behind biometrics, with its own server endpoints), not standard passkeys. Neither candidate is maintained by Better Auth.
- **The relying party id** is `APP_URL`'s host (`apps/server/src/auth/options.ts`). A passkey belongs to that domain, so a native app can use passkeys only for a real https domain it is associated with. `localhost` and plain http do not work on a phone; development needs an https name the phone resolves, such as the private network's name above.
- **iOS:** the app needs the Associated Domains entitlement with `webcredentials:<rp-id>` (`ios.associatedDomains` in the Expo config), which needs a paid Apple developer team, and the domain must serve `/.well-known/apple-app-site-association` listing `<team id>.<bundle identifier>` under `webcredentials`. The server would have to serve that file, per variant bundle identifier. The origin in an iOS assertion is `https://<rp-id>`, which the server already expects.
- **Android:** the domain must serve `/.well-known/assetlinks.json` naming each variant's application id and signing certificate fingerprints, and the assertion's origin is `android:apk-key-hash:<base64url SHA-256 of the signing certificate>`, not an https origin. The server's passkey `origin` would become a list: `APP_URL` plus one such origin per signing certificate (debug, release, store signing).
- **Simulators** (from the libraries' documentation, not tried here): passkeys need the association to resolve, so the domain must be reachable over https from the simulator or emulator; Apple's `?mode=developer` suffix on an associated domain fetches the file directly from the server during development. Android emulators need a Google Play system image signed in to a Google account.
- **What would change in this base:** a native passkey module (an `expo install`, so a dev client rebuild), `ios.associatedDomains` in `buildExpoConfig`, two well-known routes on the server built from the variant table, the passkey plugin's `origin` as a list including the Android key hashes, and a domain with https for development. None of it is in place.

Sources: Better Auth's [Expo integration](https://better-auth.com/docs/integrations/expo) and [passkey plugin](https://better-auth.com/docs/plugins/passkey) docs; the [`expo-better-auth-passkey` README](https://github.com/kevcube/expo-better-auth-passkey); the [`react-native-passkeys` README](https://www.npmjs.com/package/react-native-passkeys); Android's [Credential Manager prerequisites](https://developer.android.com/identity/credential-manager/prerequisites); and the installed `@better-auth/passkey` 1.7.25 (`dist/client.mjs` imports `@simplewebauthn/browser`; `dist/index.mjs` verifies against `origin`, which accepts a list, and `rpID`).

## Later

Not in the base, and each a documented recipe when a project needs it: universal links and app links (a real domain and its association files, then email links can open the app), over-the-air updates (EAS Update and channels in `eas.json`), store submission, push notifications, analytics, an on-device database, and end-to-end tests on a device.
