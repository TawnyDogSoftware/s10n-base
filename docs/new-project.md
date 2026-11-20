# Starting a new project from the base

How to turn a copy of s10n-base into your own project, in order. It takes about an hour, most of it waiting on installs and CI. Nothing here needs to be done again later: the base is a template, not an upstream ([decision 009](adr/009-a-template-not-an-upstream.md)). When the base improves, read its `CHANGELOG.md` and port what you want by hand.

This guide is about the base and keeps the base's names; the rename leaves it alone. Delete it once your project is set up.

## 1. Make the repository

On GitHub, open `TawnyDogSoftware/s10n-base`, choose **Use this template**, then **Create a new repository**. The new repository starts with one commit and none of the base's history. (The button appears once the owner has turned on the repository's "Template repository" setting.)

Write down the base commit you started from (the template's `main` at the time). Its changelog entries up to that commit are already in your project; later ones are what you may want to port.

A template copies files, including the workflows, but not secrets, settings, branch protection or labels. Steps 4 and 9 cover what that leaves out.

## 2. Install and check the copy

You need Node (the version in `.nvmrc`), bun (the version in `packageManager` in `package.json`) and Docker with Compose v2 ([setup.md](setup.md#prerequisites)).

```bash
git clone <your new repository> && cd <it>
bun install
bun run agent:check
```

## 3. Rename

Choose your names, then preview the change and run it:

```bash
bun run rename --name "Acme Notes" --scope @acme --slug acme-notes \
  --bundle-id com.acme.notes --scheme acmenotes --dry-run
bun run rename --name "Acme Notes" --scope @acme --slug acme-notes \
  --bundle-id com.acme.notes --scheme acmenotes
```

| Flag              | What it names                                                                                                                                     | Rule                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `--name`          | What people see: the page title, the app's name in the catalog and on the home screen, the passkey relying party, email footers                   | 2 to 40 letters, digits, spaces, dots or hyphens                           |
| `--scope`         | The workspace packages' npm scope (`@acme/server`, `@acme/client`, ...)                                                                           | `@` and lowercase letters, digits and single hyphens                       |
| `--slug`          | The machine name: the root package, the Expo slug and the dev client's scheme, the image, the compose project, the client-IP header, the database | lowercase letters, digits and single hyphens, at most 40 characters        |
| `--bundle-id`     | The iOS bundle identifier and Android application id; preview and development builds add `.preview` and `.dev`                                    | a reverse domain you control, lowercase, no hyphens (Android refuses them) |
| `--scheme`        | The mobile app's URL scheme, which the server also trusts; preview and development builds add `-preview` and `-dev`                               | lowercase letters, digits and single hyphens, not one a platform owns      |
| `--cookie-prefix` | Optional. The auth cookies' names: `<prefix>.session_token`. Defaults to the slug                                                                 | as the slug                                                                |

**Choose the bundle identifier and scheme with care.** A bundle identifier cannot change after the first store build, and a scheme that changes breaks links into the app. They live in `packages/shared/src/app-variants.ts` if you need to adjust one before then.

The rename checks every value before it writes anything, and refuses to run on a working tree with changes (a dry run is allowed) or on a repository already renamed. It then:

- replaces the base's names in every file git tracks: the package scope in every manifest, import, stylesheet import and script, and in the two tool configs that name it (the server's bundler pattern in `tsdown.config.ts`, and `knip.jsonc`); the root package and the lockfile's workspace names; the display name in the server's config, the i18n catalog, the web page title and the mobile variants; the bundle identifiers, URL schemes and names in the variant table, the Expo slug and the dev client's scheme made from it; the cookie prefix; the image tag and title label; the compose project, database, role and password in the compose file, `.env.example`, the scripts, the tests and CI; and every name in the workflows and docs;
- leaves alone the base's history: `plans/`, `CHANGELOG.md`, `docs/adr/`, this guide, the rename script itself, and third-party names, including every package entry in `bun.lock`;
- runs `bun install`, so bun rewrites the lockfile for the new workspace names, and `bun run fmt`, since names of another length re-flow tables and sorted keys;
- fails if any package version moved, or if any spelling of the base's name is left outside the files it keeps, and lists what it found;
- prints the steps below.

Review the diff, run `bun run agent:check`, and commit. CI runs `bun run rename:proof` on the base, which renames a copy with sample names and builds and checks it, so a rename that breaks the repository is caught in the base first.

## 4. Decide what to keep from the base's history

The base's history is not your project's:

- **`plans/`**: the base's plans. Delete them, or keep them in a folder of their own for reference, and empty the index in `plans/README.md`. Your first plan is `plans/001-<slug>.md`.
- **`CHANGELOG.md`**: replace its entries with one line naming the base commit you started from, and record your own changes from there.
- **`docs/adr/`**: the base's decisions. Keep the ones your project inherits as its own starting decisions, and supersede them with new records as you change course.
- **`README.md`**: rewrite it for your project. Keep the credit to the upstream project if you like.
- **This guide**: delete it.

## 5. Turn on the daily dependency update

The workflow (`.github/workflows/dependency-updates.yml`) came with the template, but the secrets it needs did not. Without them it ends each night with a notice and does nothing.

Install the organisation's dependency-update GitHub App on the new repository, or create one, and give the repository the two secrets, `DEPS_UPDATE_APP_CLIENT_ID` and `DEPS_UPDATE_APP_PRIVATE_KEY` (organisation secrets limited to selected repositories work well). [dependencies.md](dependencies.md#setting-up-the-github-app) has the app's permissions and the steps. Then run the workflow once by hand from the Actions tab.

## 6. Mobile builds

- **Bundle identifiers:** confirm them before the first store build (step 3).
- **EAS:** when you need cloud builds, TestFlight or a store build, run `eas init` in `apps/mobile` and set `EAS_PROJECT_ID` in `apps/mobile/.env.local` and in EAS ([mobile-dev.md](mobile-dev.md#environment)).
- **First boot:** follow [mobile-dev.md](mobile-dev.md#the-first-simulator-build-on-a-mac) on a Mac.

## 7. The first admin

Start the app with `bun dev`, sign up, open the verification link from the local inbox (`http://127.0.0.1:8005/`), then:

```bash
bun run auth:set-role you@example.com admin
```

In a deployment the same is `node apps/server/dist/set-role.mjs you@example.com admin` from the image ([deployment.md](deployment.md#the-first-admin)).

## 8. Deploy

Follow [deployment.md](deployment.md): build the image, create the two database roles, run `migrate up`, and start the server behind your proxy with production settings.

## 9. Repository settings

Set what a template does not copy: branch protection on `main` requiring CI's five jobs, who may merge, and whether the repository is public. The daily update creates its own label on its first run.
