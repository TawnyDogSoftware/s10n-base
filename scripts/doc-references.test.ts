import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { anchors, bunRunScripts, codePaths, headingAnchor, relativeLinks } from "./doc-references";

const root = path.resolve(import.meta.dirname, "..");
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((file) => file !== "" && existsSync(path.join(root, file)));

/**
 * The docs a reader follows, and the changelog. Not the plans: a plan records what was true when
 * it was built.
 */
const DOCS = [
  ...tracked.filter((file) => /^(?:README|AGENTS)\.md$|^docs\/.*\.md$/.test(file)),
  "plans/README.md",
  "CHANGELOG.md",
  ".claude/implement-plan.md",
].toSorted((a, b) => a.localeCompare(b));

/** Docs that tell someone what to run at the root: only root scripts count there. */
const ROOT_ONLY = new Set([
  "README.md",
  "AGENTS.md",
  "docs/new-project.md",
  ".claude/implement-plan.md",
]);

/** Paths a person creates on their own machine, which no checkout has. */
const LOCAL_ONLY = new Set(["apps/mobile/.env.local"]);

function scriptsOf(manifest: string): string[] {
  const { scripts = {} } = JSON.parse(readFileSync(path.join(root, manifest), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return Object.keys(scripts);
}

const rootScripts = new Set(scriptsOf("package.json"));
const anyScripts = new Set([
  ...rootScripts,
  ...tracked
    .filter((file) => /^(?:apps|packages)\/[^/]+\/package\.json$/.test(file))
    .flatMap(scriptsOf),
]);

const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const basenames = new Set(tracked.map((file) => path.basename(file)));

/**
 * Whether a path a doc names exists. A bare name may be any tracked file's name (`index.ts`) or
 * a root entry; a longer path counts as the repository's only when its first part is (so a branch
 * such as `feature/x` or a rule such as `i18next/no-literal-string` is not a path). `NNN` marks a
 * placeholder.
 */
function pathExists(target: string): boolean {
  const clean = target.replace(/\/$/, "");
  if (LOCAL_ONLY.has(clean) || clean.includes("NNN")) return true;
  if (existsSync(path.join(root, clean))) return true;
  const [first = ""] = clean.split("/");
  return clean.includes("/") ? !existsSync(path.join(root, first)) : basenames.has(clean);
}

describe.each(DOCS)("%s", (doc) => {
  const text = read(doc);

  it("runs only scripts that exist", () => {
    const known = ROOT_ONLY.has(doc) ? rootScripts : anyScripts;
    const missing = bunRunScripts(text).filter(({ target }) => !known.has(target));

    expect(missing).toEqual([]);
  });

  it("links only to files and headings that exist", () => {
    const broken = relativeLinks(text).filter(({ target }) => {
      const [file = "", anchor] = target.split("#");
      const resolved = path.join(path.dirname(doc), file);
      if (!existsSync(path.join(root, resolved))) return true;
      return anchor !== undefined && !anchors(read(resolved)).has(anchor);
    });

    expect(broken).toEqual([]);
  });
});

describe.each([...ROOT_ONLY])("%s", (doc) => {
  it("names only paths that exist", () => {
    const missing = codePaths(read(doc)).filter(({ target }) => !pathExists(target));

    expect(missing).toEqual([]);
  });
});

describe("bunRunScripts", () => {
  it("finds every script name after bun run, with its line", () => {
    expect(
      bunRunScripts("Run `bun run agent:check`.\n\nbun run --cwd x y\nbun run db:up && bun dev"),
    ).toEqual([
      { target: "agent:check", line: 1 },
      { target: "db:up", line: 4 },
    ]);
  });
});

describe("relativeLinks", () => {
  it("keeps relative links and drops web, mail and same-page ones", () => {
    const text =
      "[a](setup.md#tests) [b](https://example.com) [c](#here)\n[d](mailto:x@example.com) [e](../plans/README.md)";

    expect(relativeLinks(text)).toEqual([
      { target: "setup.md#tests", line: 1 },
      { target: "../plans/README.md", line: 2 },
    ]);
  });
});

describe("anchors", () => {
  it("gives each heading GitHub's anchor, ignoring fenced code", () => {
    const text = [
      "# Setup",
      "## 3. Rename",
      "### Passkeys on mobile: not implemented",
      "## Pitfalls our projects' reviews found",
      "```bash",
      "# not a heading",
      "```",
      "#not-a-heading",
    ].join("\n");

    expect([...anchors(text)]).toEqual([
      "setup",
      "3-rename",
      "passkeys-on-mobile-not-implemented",
      "pitfalls-our-projects-reviews-found",
    ]);
    expect(headingAnchor("The `bun run` command")).toBe("the-bun-run-command");
  });
});

describe("codePaths", () => {
  it("finds paths and file names in code spans, not commands, packages, URLs or placeholders", () => {
    const text = [
      "`apps/server/src/config/index.ts`, `docs/adr/`, `bunfig.toml`, `index.ts`, `.githooks/`",
      "`bun run x`, `@acme/client`, `http://127.0.0.1:8005/`, `plans/<slug>.md`, `scripts/**/*.main.ts`, `APP_URL`",
    ].join("\n");

    expect(codePaths(text).map(({ target }) => target)).toEqual([
      "apps/server/src/config/index.ts",
      "docs/adr/",
      "bunfig.toml",
      "index.ts",
      ".githooks/",
    ]);
  });
});
