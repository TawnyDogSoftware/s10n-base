# Mobile first boot: the owner's checklist

The mobile app was written and tested on Linux, where no simulator runs. **It has not been booted on any simulator or device.** Plan 006 is "implemented, first boot pending" until this checklist is filled in on a Mac, from a fresh clone. It should take one sitting. Write each result in the space under its step (a line or two, with versions and anything that had to change), then commit this file.

Background for each step is in [mobile-dev.md](mobile-dev.md).

- Date:
- Commit (`git rev-parse HEAD`):
- Who:

## 1. Fresh clone and the server stack

```bash
git clone <repo> && cd <repo>
bun install
bun dev
```

`bun install` must finish without errors under bun's default linker. `bun dev` prints the inbox URL and keeps running.

Result:

## 2. Build and boot the development variant on an iOS simulator

In a second terminal:

```bash
bun run ios:simulator
```

Expect `apps/mobile/ios` to be generated, `pod install` to run, and **S10N Base (Dev)** to open on the sign-in screen, in the system's light or dark mode.

Record:

- macOS version:
- Xcode version (`xcodebuild -version`):
- CocoaPods version (`pod --version`):
- Simulator and iOS version:
- Did bun's default linker work for `pod install`, the native build and Metro? If anything had to change (for example `linker = "hoisted"` in `bunfig.toml`, a patch, a setting), what exactly failed first and what fixed it:

Two things to watch, from experience with other Expo 58 projects: `pod install` resolving Expo modules from the workspace, and Swift compile errors in `expo-modules-core` under the newest Xcode. The installed `expo-modules-core` 58.1.0 already has the Swift fix; if either fails, record the error text.

Result:

## 3. The account journey

1. In the app, create an account (name, email, a password of at least 8 characters). The app shows "Check your email".
2. Open the inbox (`http://127.0.0.1:8005/`) on the Mac and open the verification link in the browser. The web page says the address is confirmed.
3. Back in the app, go to sign in and sign in. The home screen greets you by name.
4. Open the profile, change the name, save. "Your name is saved." appears, and the home screen shows the new name.
5. Sign out from the profile. The app returns to the sign-in screen.

Result:

## 4. The admin list

```bash
bun run auth:set-role you@example.com admin
```

Sign in again (or bring the app to the foreground after 30 seconds, which re-reads the session). The home screen shows "See all users"; the list shows your account. A second account that is not an admin sees "You do not have access to this page" on the same screen.

Result:

## 5. Uniwind and the shared theme

Plan 005 could not check these without a device. For each, yes or no, and what you saw:

- Colours render (background, text, primary button, borders). Each colour is declared both in `@theme` and in the per-mode blocks of `packages/theme/theme.css`; Uniwind's documentation does not say it accepts both:
- `--color-*: initial` (clearing Tailwind's palette) caused no error or warning in Metro's output:
- The theme imported from another package (`@import "@s10n-base/theme/theme.css"` in `apps/mobile/src/global.css`) took effect. The export on Linux shows the theme's values in the bundle; this is the check that they apply:
- The font stack (`--font-sans` is a CSS fallback list) caused no warning; text uses the system font:
- Switch the simulator between light and dark (Settings → Developer → Dark Appearance, or Features → Toggle Appearance): the app follows, and every text stays readable:
- The splash screen shows the placeholder mark on the theme's background in both modes:

Result:

## 6. Sessions across launches and devices

1. Sign in. Quit the app (swipe it away) and launch it again: still signed in, without a sign-in screen.
2. End the app's session from elsewhere, then bring the app back. Signing out on the web is not enough: it ends the browser's own session, and the app has its own. Use the password reset instead, which signs the account out everywhere: on the web, "Forgot your password?", open the link from the inbox and set a new password. Then send the app to the background and bring it back after at least 30 seconds (the session is re-read when it is more than 30 seconds old). The app notices and shows the sign-in screen, and the new password signs in.

Result:

## 7. Optional: the Android emulator

With the Android SDK and an emulator running: `bun run android`. The emulator reaches the Mac's server at `http://10.0.2.2:4210`, not `localhost`, so start Metro with `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4210`. Repeat steps 3 and 6.

Result:

## When it is done

Fill in the header, commit this file, and change plan 006's status to "done" and plan 000's status line accordingly. If any step failed, open an issue or a plan with the error text instead, and leave the status as it is.
