import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  describeChange,
  NEXT_STEPS,
  planRename,
  processRenameIo,
  rename,
  type RenameIo,
} from "./rename";
import type { ProjectNames } from "./rules";

const ARGV = [
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
  "--cookie-prefix",
  "acme",
];

const NAMES: ProjectNames = {
  name: "Acme Notes",
  scope: "@acme",
  slug: "acme-notes",
  bundleId: "com.acme.notes",
  scheme: "acmenotes",
  cookiePrefix: "acme",
};

const LOCKFILE = `{
  "workspaces": {
    "": {
      "name": "s10n-base",
    },
  },
  "packages": {
    "@s10n-base/web": ["@s10n-base/web@workspace:apps/web"],

    "kysely": ["kysely@0.29.9", "", {}, "sha512-x"],
  }
}
`;

/** A small repository as the rename sees it, kept in memory. */
function fakeRepository(
  options: {
    status?: string;
    install?: (files: Map<string, string>) => number;
    format?: () => number;
  } = {},
) {
  const files = new Map<string, string>([
    ["package.json", `{ "name": "s10n-base", "workspaces": ["apps/*"] }\n`],
    ["apps/web/package.json", `{ "name": "@s10n-base/web" }\n`],
    ["apps/web/index.html", "<title>S10N Base</title>\n"],
    ["packages/shared/src/auth.ts", `export const AUTH_COOKIE_PREFIX = "s10n-base";\n`],
    ["bun.lock", LOCKFILE],
    ["plans/001-x.md", "The s10n-base plan.\n"],
    ["docs/plain.md", "Nothing to rename.\n"],
  ]);
  const lines: string[] = [];
  let installs = 0;
  let formats = 0;
  const io: RenameIo = {
    root: "/repo",
    git: (args) => (args[0] === "status" ? (options.status ?? "") : ""),
    readFile: (file) => files.get(file) ?? "",
    writeFile: (file, text) => files.set(file, text),
    listTextFiles: () => [...files].map(([file, text]) => ({ file, text })),
    install: () => {
      installs += 1;
      return options.install?.(files) ?? 0;
    },
    format: () => {
      formats += 1;
      return options.format?.() ?? 0;
    },
    print: (line) => lines.push(line),
  };
  return { files, lines, io, installs: () => installs, formats: () => formats };
}

describe("rename", () => {
  it("renames every file outside the kept ones, reinstalls, and says what is left to do", () => {
    const repo = fakeRepository();

    expect(rename(ARGV, repo.io)).toBe(0);
    expect(repo.files.get("package.json")).toBe(
      `{ "name": "acme-notes", "workspaces": ["apps/*"] }\n`,
    );
    expect(repo.files.get("apps/web/package.json")).toBe(`{ "name": "@acme/web" }\n`);
    expect(repo.files.get("apps/web/index.html")).toBe("<title>Acme Notes</title>\n");
    expect(repo.files.get("packages/shared/src/auth.ts")).toContain(`= "acme";`);
    expect(repo.files.get("bun.lock")).toContain(`"@acme/web": ["@acme/web@workspace:apps/web"]`);
    expect(repo.files.get("plans/001-x.md")).toBe("The s10n-base plan.\n");
    expect(repo.installs()).toBe(1);
    expect(repo.formats()).toBe(1);
    expect(repo.lines).toContain("rename: 5 files change:");
    expect(repo.lines).toContain("  apps/web/index.html: display name ×1");
    expect(repo.lines.at(-1)).toBe(`${String(NEXT_STEPS.length)}. ${NEXT_STEPS.at(-1) ?? ""}`);
  });

  it("lists the changes and writes nothing on a dry run", () => {
    const repo = fakeRepository();
    const before = new Map(repo.files);

    expect(rename([...ARGV, "--dry-run"], repo.io)).toBe(0);
    expect(repo.files).toEqual(before);
    expect(repo.installs()).toBe(0);
    expect(repo.lines).toContain("  bun.lock: package scope ×2, slug ×1");
    expect(repo.lines.at(-1)).toBe(
      "rename: dry run, nothing written. bun install would then rewrite bun.lock.",
    );
  });

  it("checks the arguments before anything else", () => {
    const repo = fakeRepository({ status: " M README.md" });

    expect(rename(["--name", "Acme"], repo.io)).toBe(2);
    expect(repo.lines[0]).toBe("rename: --scope is required");
  });

  it("allows a dry run in a working tree with changes, since it writes nothing", () => {
    const repo = fakeRepository({ status: " M README.md\n" });

    expect(rename([...ARGV, "--dry-run"], repo.io)).toBe(0);
    expect(repo.lines[0]).toBe("rename: 5 files change:");
  });

  it("refuses a working tree with changes", () => {
    const repo = fakeRepository({ status: " M README.md\n" });

    expect(rename(ARGV, repo.io)).toBe(1);
    expect(repo.lines).toEqual([
      "rename: refusing to run: the working tree has changes; commit or stash them first, so the rename is one reviewable diff",
    ]);
  });

  it("refuses to run twice", () => {
    const repo = fakeRepository();
    rename(ARGV, repo.io);
    repo.lines.length = 0;

    expect(rename(ARGV, repo.io)).toBe(1);
    expect(repo.lines).toEqual([
      'rename: refusing to run: this repository is already renamed: package.json is named "acme-notes", not s10n-base',
    ]);
  });

  it("fails when bun install fails", () => {
    const repo = fakeRepository({ install: () => 1 });

    expect(rename(ARGV, repo.io)).toBe(1);
    expect(repo.lines.at(-1)).toBe(
      "rename: bun install failed; the files are renamed, the lockfile may not be",
    );
  });

  it("fails when the formatter fails", () => {
    const repo = fakeRepository({ format: () => 1 });

    expect(rename(ARGV, repo.io)).toBe(1);
    expect(repo.lines.at(-1)).toBe("rename: bun run fmt failed; run it, then check the result");
  });

  it("fails when bun install moves a package version", () => {
    const repo = fakeRepository({
      install: (files) => {
        files.set(
          "bun.lock",
          (files.get("bun.lock") ?? "").replace("kysely@0.29.9", "kysely@0.29.10"),
        );
        return 0;
      },
    });

    expect(rename(ARGV, repo.io)).toBe(1);
    expect(repo.lines.slice(-3)).toEqual([
      "rename: bun install changed package versions, which a rename must not:",
      "  - kysely@0.29.9",
      "  + kysely@0.29.10",
    ]);
  });

  it("fails when a spelling of the base's name is left", () => {
    const repo = fakeRepository();
    repo.files.set("docs/old.md", "Set `S10N_BASE_PORT`.\n");

    expect(rename(ARGV, repo.io)).toBe(1);
    expect(repo.lines.slice(-2)).toEqual([
      "rename: the base's name is still in these lines:",
      "  docs/old.md:1: Set `S10N_BASE_PORT`.",
    ]);
  });
});

describe("planRename and describeChange", () => {
  it("plans only files that change, and counts each rule", () => {
    const changes = planRename(
      [
        { file: "a.ts", text: `"@s10n-base/x" "@s10n-base/y" "S10N Base"` },
        { file: "b.ts", text: "unrelated" },
        { file: "CHANGELOG.md", text: "S10N Base" },
      ],
      NAMES,
    );

    expect(changes.map(describeChange)).toEqual(["a.ts: package scope ×2, display name ×1"]);
  });
});

describe("processRenameIo", () => {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  function repository(): string {
    const root = mkdtempSync(path.join(tmpdir(), "rename-io-"));
    made.push(root);
    writeFileSync(path.join(root, "a.txt"), "S10N Base\n");
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "a.txt"], { cwd: root });
    return root;
  }

  it("reads, writes and lists the repository's files, and runs the install", () => {
    const root = repository();
    const io = processRenameIo(root, () => {}, "true");

    io.writeFile("a.txt", "Acme Notes\n");

    expect(io.readFile("a.txt")).toBe("Acme Notes\n");
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("Acme Notes\n");
    expect(io.listTextFiles()).toEqual([{ file: "a.txt", text: "Acme Notes\n" }]);
    expect(io.git(["status", "--porcelain"])).toContain("a.txt");
    expect(io.install()).toBe(0);
    expect(io.format()).toBe(0);
    expect(processRenameIo(root, () => {}, "false").install()).toBe(1);
    expect(processRenameIo(root, () => {}, "false").format()).toBe(1);
    expect(processRenameIo(root, () => {}, path.join(root, "missing")).install()).toBe(1);
    expect(processRenameIo(root, () => {}, path.join(root, "missing")).format()).toBe(1);
  });
});
