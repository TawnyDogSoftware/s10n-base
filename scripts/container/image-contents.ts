/**
 * What the container image may and must hold, checked over a listing of its files. The listing
 * is made inside the image by {@link LIST_FILES_SCRIPT}, run with the image's own Node, since the
 * image has no shell tools to list with.
 */

/** Files the image must have: the three entry points and the web app. */
export const REQUIRED_FILES = [
  "/app/apps/server/dist/bin.mjs",
  "/app/apps/server/dist/migrate.mjs",
  "/app/apps/server/dist/set-role.mjs",
  "/app/apps/web/dist/index.html",
] as const;

/** Development tools that must not be in the image: the test runner, the linters, the bundlers. */
const DEV_PACKAGES = ["vitest", "eslint", "oxlint", "tsdown", "typescript", "vite"] as const;

/** Package-manager files the runtime stage removes from the Node base. */
const PACKAGE_MANAGERS = [
  "/usr/local/bin/npm",
  "/usr/local/bin/npx",
  "/usr/local/lib/node_modules",
];

interface Rule {
  readonly test: (path: string) => boolean;
  readonly problem: string;
}

const FORBIDDEN: readonly Rule[] = [
  { test: (path) => /\/\.env[^/]*$/.test(path), problem: "an environment file" },
  { test: (path) => /\.(?:test|spec)\.[^/]+$/.test(path), problem: "a test" },
  { test: (path) => path.startsWith("/app/apps/mobile"), problem: "the mobile app" },
  { test: (path) => /^\/app\/(?:plans|docs|e2e)(?:\/|$)/.test(path), problem: "plans or docs" },
  {
    test: (path) => path.startsWith("/app/apps/") && /\.[cm]?tsx?$/.test(path),
    problem: "TypeScript source",
  },
  { test: (path) => path.startsWith("/app/apps/server/src"), problem: "the server's source" },
  { test: (path) => PACKAGE_MANAGERS.includes(path), problem: "a package manager" },
];

/** The store entries in the image's `node_modules/.bun`, such as `pg@8.23.1`. */
export function runtimePackages(paths: readonly string[]): string[] {
  const entries = paths.flatMap((path) => {
    const match = /^\/app\/node_modules\/\.bun\/([^/]+)$/.exec(path);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  return entries.toSorted((left, right) => left.localeCompare(right));
}

function devPackageProblems(paths: readonly string[]): string[] {
  return runtimePackages(paths).flatMap((entry) => {
    const name = DEV_PACKAGES.find((dev) => entry.startsWith(`${dev}@`));
    return name === undefined ? [] : [`${entry}: a development package (${name})`];
  });
}

/** Problems with the image's files; empty when it holds what it must and nothing it must not. */
export function imageContentProblems(paths: readonly string[]): string[] {
  const present = new Set(paths);
  const missing = REQUIRED_FILES.filter((file) => !present.has(file)).map(
    (file) => `${file} is missing`,
  );
  const forbidden = paths.flatMap((path) => {
    const rule = FORBIDDEN.find((candidate) => candidate.test(path));
    return rule === undefined ? [] : [`${path}: ${rule.problem}`];
  });
  return [...missing, ...forbidden, ...devPackageProblems(paths)];
}

/**
 * A Node program that prints, as JSON, every path under `/app` (without following links) and
 * which of the package-manager paths exist.
 */
export const LIST_FILES_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const found = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    found.push(full);
    if (entry.isDirectory()) walk(full);
  }
};
walk("/app");
for (const file of ${JSON.stringify(PACKAGE_MANAGERS)}) if (fs.existsSync(file)) found.push(file);
process.stdout.write(JSON.stringify(found));
`;
