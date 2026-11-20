import { describe, expect, it } from "vitest";

import { namesProblems, parseRenameArguments } from "./arguments";
import type { ProjectNames } from "./rules";

const GOOD = [
  "--name",
  "Acme Notes",
  "--scope",
  "@acme",
  "--slug",
  "acme-notes",
  "--bundle-id",
  "com.acme.notes",
  "--scheme",
  "acmenotes",
];

const NAMES: ProjectNames = {
  name: "Acme Notes",
  scope: "@acme",
  slug: "acme-notes",
  bundleId: "com.acme.notes",
  scheme: "acmenotes",
  cookiePrefix: "acme-notes",
};

describe("parseRenameArguments", () => {
  it("reads every name, deriving the cookie prefix from the slug", () => {
    expect(parseRenameArguments(GOOD)).toEqual({ ok: true, args: { names: NAMES, dryRun: false } });
  });

  it("takes a cookie prefix of its own, and --dry-run", () => {
    expect(parseRenameArguments(["--dry-run", ...GOOD, "--cookie-prefix", "acme"])).toEqual({
      ok: true,
      args: { names: { ...NAMES, cookiePrefix: "acme" }, dryRun: true },
    });
  });

  it("reports every missing, unknown and empty argument at once", () => {
    expect(parseRenameArguments(["--slug", "--name", "Acme", "--colour", "red"])).toEqual({
      ok: false,
      problems: [
        "--slug needs a value",
        "unknown argument: --colour",
        "unknown argument: red",
        "--scope is required",
        "--slug is required",
        "--bundle-id is required",
        "--scheme is required",
      ],
    });
    expect(parseRenameArguments([...GOOD, "--cookie-prefix"])).toMatchObject({
      ok: false,
      problems: ["--cookie-prefix needs a value"],
    });
  });

  it("reports every invalid value at once, before anything is written", () => {
    const argv = GOOD.map((value) => (value === "acme-notes" ? "Acme_Notes" : value));

    expect(parseRenameArguments([...argv, "--scheme", "http"])).toEqual({
      ok: false,
      problems: [
        '--slug must be lowercase letters, digits and single hyphens, starting with a letter, at most 40 characters; got "Acme_Notes"',
        '--scheme must be lowercase letters, digits and single hyphens, starting with a letter, at most 40 characters, and not one a platform owns (http, exp, ...); got "http"',
        '--cookie-prefix must be lowercase letters, digits and single hyphens, starting with a letter, at most 40 characters; got "Acme_Notes"',
      ],
    });
  });
});

function problemsFor(change: Partial<ProjectNames>): string[] {
  return namesProblems({ ...NAMES, ...change });
}

describe("namesProblems", () => {
  it("accepts good names", () => {
    expect(namesProblems(NAMES)).toEqual([]);
    expect(
      problemsFor({ name: "A1", scope: "@a", bundleId: "io.a1.b2c", scheme: "x-y-2" }),
    ).toEqual([]);
  });

  it.each([
    { name: "A" },
    { name: " Acme" },
    { name: "Acme <Notes>" },
    { name: "Acme Notes!" },
    { name: "A".repeat(41) },
    { scope: "acme" },
    { scope: "@Acme" },
    { scope: "@acme/x" },
    { scope: `@${"a".repeat(41)}` },
    { slug: "acme--notes" },
    { slug: "acme-" },
    { slug: "1acme" },
    { slug: "a".repeat(41) },
    { bundleId: "acme" },
    { bundleId: "com.acme-notes.app" },
    { bundleId: "com.Acme.notes" },
    { bundleId: "com.1acme.notes" },
    { bundleId: "com.acme.new" },
    { bundleId: `com.${"a".repeat(100)}` },
    { scheme: "exp" },
    { scheme: "acme_notes" },
    { scheme: "a".repeat(41) },
    { cookiePrefix: "acme.notes" },
    { cookiePrefix: "a".repeat(41) },
  ])("refuses %o", (change) => {
    expect(problemsFor(change)).toHaveLength(1);
  });

  it("refuses a value that still names the base", () => {
    expect(problemsFor({ slug: "my-s10n-base", name: "App Scaffold" })).toEqual([
      '--slug must not contain the base\'s own name; got "my-s10n-base"',
    ]);
    expect(problemsFor({ scheme: "s10nbase" })).toEqual([
      '--scheme must not contain the base\'s own name; got "s10nbase"',
    ]);
  });
});
