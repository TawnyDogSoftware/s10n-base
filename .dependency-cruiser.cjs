// Boundaries between the apps and packages (`bun run boundaries`). Type-only imports count too:
// they couple modules just as much. scripts/quality/boundaries.test.ts proves each rule fires.
//
// What each workspace may import from the others:
//   apps/web, apps/mobile  contracts, shared, client, theme, i18n
//   apps/server            contracts, shared, i18n
//   packages/client        contracts, shared, i18n
//   packages/contracts     nothing
//   packages/shared        nothing
//   packages/theme         nothing
//   packages/i18n          nothing; its tests read the error codes from contracts
// Packages never import apps, and apps never import each other.

/** Test files and test support, which may reach further than the code they test. */
const TESTS = "(\\.test\\.tsx?$|/src/test/|/src/testing/|/src/test-fetch\\.ts$)";

/** A rule that lets code under `from` import only the workspace packages it names. */
function onlyPackages(name, from, allowed, comment) {
  return {
    name,
    severity: "error",
    comment,
    from,
    to: { path: "^packages/", pathNot: `^packages/(${allowed.join("|")})/` },
  };
}

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A cycle makes the modules in it one unit: none can be understood or tested alone.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-build-output",
      severity: "error",
      comment: "Source imports source, never build output, which may be stale or missing.",
      from: {},
      to: { path: "(^|/)(dist|build|coverage|\\.expo)/", pathNot: "(^|/)node_modules/" },
    },
    {
      name: "packages-never-import-apps",
      severity: "error",
      comment: "Packages are shared by the apps, so they cannot depend on one.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-never-import-each-other",
      severity: "error",
      comment: "Apps share code only through packages.",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    onlyPackages(
      "clients-use-client-packages",
      { path: "^apps/(web|mobile)/" },
      ["contracts", "shared", "client", "theme", "i18n"],
      "The web and mobile apps reach the server only through contracts and packages/client.",
    ),
    onlyPackages(
      "server-uses-server-packages",
      { path: "^apps/server/" },
      ["contracts", "shared", "i18n"],
      "The server has no use for the clients' packages.",
    ),
    onlyPackages(
      "client-package-imports",
      { path: "^packages/client/" },
      ["client", "contracts", "shared", "i18n"],
      "packages/client is the clients' shared logic over contracts, shared and i18n.",
    ),
    onlyPackages(
      "leaf-packages-import-no-package",
      { path: "^packages/(contracts|shared|theme)/" },
      ["$1"],
      "contracts, shared and theme are the bottom layer: they import no other workspace package.",
    ),
    onlyPackages(
      "i18n-imports-no-package",
      { path: "^packages/i18n/", pathNot: TESTS },
      ["i18n"],
      "i18n imports no other workspace package.",
    ),
    onlyPackages(
      "i18n-tests-import-contracts-only",
      { path: `^packages/i18n/.*${TESTS}` },
      ["i18n", "contracts"],
      "i18n's tests check that every error code in contracts has a message.",
    ),
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|coverage|\\.expo|ios|android)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
