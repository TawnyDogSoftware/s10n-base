import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectRuntimeClosure,
  exportRuntimeDependencies,
  isRuntimeFile,
  runtimeDependenciesCommand,
  runtimeStarts,
} from "./runtime-dependencies";

let root: string;
let out: string;

async function write(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}

/** A package in bun's store: `node_modules/.bun/<entry>/node_modules/<name>`. */
async function storePackage(
  entry: string,
  manifest: Record<string, unknown> & { name: string },
  files: Record<string, string> = {},
): Promise<void> {
  const dir = `node_modules/.bun/${entry}/node_modules/${manifest.name}`;
  await write(`${dir}/package.json`, JSON.stringify({ version: "1.0.0", ...manifest }));
  for (const [file, text] of Object.entries(files)) await write(`${dir}/${file}`, text);
}

/** A link at `from/name` to a store entry, relative, as bun makes it. */
async function link(from: string, name: string, entry: string): Promise<void> {
  const linkPath = path.join(root, from, name);
  const target = path.join(root, "node_modules/.bun", entry, "node_modules", name);
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(path.relative(path.dirname(linkPath), target), linkPath);
}

const esm = (body: string) => ({ "index.js": body });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "runtime-deps-root-"));
  out = await mkdtemp(path.join(tmpdir(), "runtime-deps-out-"));
  await write(
    "apps/server/package.json",
    JSON.stringify({
      dependencies: { alpha: "^1.0.0", "@scope/beta": "1.0.0", "@ws/shared": "workspace:*" },
      devDependencies: { tooling: "^1.0.0" },
    }),
  );
  await storePackage(
    "alpha@1.0.0",
    {
      name: "alpha",
      type: "module",
      exports: "./index.js",
      dependencies: { gamma: "^1.0.0" },
      optionalDependencies: { "not-on-this-platform": "^1.0.0" },
      peerDependencies: { delta: "^1.0.0", gamma: "^1.0.0", react: "^19.0.0", vue: "^3.0.0" },
      peerDependenciesMeta: { react: { optional: true }, vue: { optional: true } },
    },
    esm('import { gamma } from "gamma";\nexport const alpha = `alpha+${gamma}`;\n'),
  );
  await storePackage(
    "@scope+beta@1.0.0",
    {
      name: "@scope/beta",
      type: "module",
      exports: "./index.js",
      peerDependencies: { gamma: "1", react: "^19.0.0" },
      peerDependenciesMeta: { gamma: { optional: true }, react: { optional: true } },
    },
    esm('export { gamma as beta } from "gamma";\n'),
  );
  await storePackage(
    "gamma@1.0.0",
    { name: "gamma", type: "module", exports: "./index.js" },
    {
      ...esm('export const gamma = "gamma";\n'),
      "index.d.ts": "export declare const gamma: string;\n",
      "index.d.mts": "export declare const gamma: string;\n",
      "index.js.map": "{}",
      "src/gamma.ts": 'export const gamma = "gamma";\n',
      "node_modules/stray/index.js": "",
    },
  );
  await storePackage("delta@2.0.0", { name: "delta", version: "2.0.0" }, esm(""));
  await storePackage("react@19.0.0", { name: "react", version: "19.0.0" }, esm(""));
  await storePackage("tooling@1.0.0", { name: "tooling" }, esm(""));
  await link("node_modules/.bun/alpha@1.0.0/node_modules", "gamma", "gamma@1.0.0");
  await link("node_modules/.bun/alpha@1.0.0/node_modules", "delta", "delta@2.0.0");
  await link("node_modules/.bun/alpha@1.0.0/node_modules", "react", "react@19.0.0");
  await link("node_modules/.bun/@scope+beta@1.0.0/node_modules", "gamma", "gamma@1.0.0");
  await link("node_modules/.bun/@scope+beta@1.0.0/node_modules", "react", "react@19.0.0");
  await link("apps/server/node_modules", "alpha", "alpha@1.0.0");
  await link("apps/server/node_modules", "@scope/beta", "@scope+beta@1.0.0");
  await link("apps/server/node_modules", "tooling", "tooling@1.0.0");
  await write("packages/shared/package.json", JSON.stringify({ name: "@ws/shared" }));
  await mkdir(path.join(root, "apps/server/node_modules/@ws"), { recursive: true });
  await symlink(
    "../../../../packages/shared",
    path.join(root, "apps/server/node_modules/@ws/shared"),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

/** Every file and link under `dir`, without following links. */
async function listFiles(dir: string, base: string = dir): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(full, base)));
    else found.push(path.relative(base, full));
  }
  return found.toSorted();
}

describe("runtimeStarts", () => {
  it("is the declared dependencies, without workspace packages or dev dependencies", () => {
    expect(
      runtimeStarts({
        dependencies: { b: "^1", a: "1.0.0", "@ws/x": "workspace:*" },
        devDependencies: { c: "1" },
      } as never),
    ).toEqual(["a", "b"]);
    expect(runtimeStarts({})).toEqual([]);
  });
});

describe("collectRuntimeClosure", () => {
  it("follows dependencies and required peers, not optional peers or dev dependencies", async () => {
    const closure = await collectRuntimeClosure(root, "apps/server");

    expect(closure.packages).toEqual([
      { name: "@scope/beta", version: "1.0.0", entry: "@scope+beta@1.0.0" },
      { name: "alpha", version: "1.0.0", entry: "alpha@1.0.0" },
      { name: "delta", version: "2.0.0", entry: "delta@2.0.0" },
      { name: "gamma", version: "1.0.0", entry: "gamma@1.0.0" },
    ]);
  });

  it("refuses a required dependency that is not linked next to the package", async () => {
    await rm(path.join(root, "node_modules/.bun/alpha@1.0.0/node_modules/delta"));

    await expect(collectRuntimeClosure(root, "apps/server")).rejects.toThrow(
      "delta is needed by node_modules/.bun/alpha@1.0.0/node_modules but is not installed there.",
    );
  });

  it("refuses a dependency that resolves outside bun's store", async () => {
    await rm(path.join(root, "apps/server/node_modules/alpha"));
    await write("apps/server/node_modules/alpha/package.json", "{}");

    await expect(collectRuntimeClosure(root, "apps/server")).rejects.toThrow(
      /^alpha resolves to \.\.\/\.\.\/apps\/server\/node_modules\/alpha, outside bun's store/,
    );
  });

  it("names the store entry when a link points at another package's directory", async () => {
    await rm(path.join(root, "apps/server/node_modules/alpha"));
    await symlink(
      "../../../node_modules/.bun/gamma@1.0.0/node_modules/gamma",
      path.join(root, "apps/server/node_modules/alpha"),
    );

    await expect(collectRuntimeClosure(root, "apps/server")).rejects.toThrow(
      /^alpha resolves to gamma@1\.0\.0\/node_modules\/gamma, outside bun's store/,
    );
  });
});

describe("optional peers", () => {
  it("keeps the link to one whose package is in the closure anyway, since a package may import it", async () => {
    const closure = await collectRuntimeClosure(root, "apps/server");

    expect(closure.links).toContainEqual({
      from: "node_modules/.bun/@scope+beta@1.0.0/node_modules",
      name: "gamma",
      entry: "gamma@1.0.0",
    });
    expect(closure.links.map((link) => link.name)).not.toContain("react");
  });
});

describe("isRuntimeFile", () => {
  it.each([
    ["index.js", true],
    ["dist/index.mjs", true],
    ["package.json", true],
    ["LICENSE", true],
    ["index.d.ts", false],
    ["index.d.mts", false],
    ["index.d.cts", false],
    ["src/module.ts", false],
    ["dist/index.js.map", false],
    ["node_modules", false],
    ["dist/inbound-parser.test.js", false],
    ["lib/thing.spec.mjs", false],
    ["dist/latest.js", true],
    ["testing.js", true],
  ])("%s: %s", (file, kept) => {
    expect(isRuntimeFile(file)).toBe(kept);
  });
});

describe("exportRuntimeDependencies", () => {
  it("copies the closure in bun's layout, with its links, and nothing else", async () => {
    await exportRuntimeDependencies({ root, workspace: "apps/server", out });

    expect(await listFiles(out)).toEqual([
      "apps/server/node_modules/@scope/beta",
      "apps/server/node_modules/alpha",
      "node_modules/.bun/@scope+beta@1.0.0/node_modules/@scope/beta/index.js",
      "node_modules/.bun/@scope+beta@1.0.0/node_modules/@scope/beta/package.json",
      "node_modules/.bun/@scope+beta@1.0.0/node_modules/gamma",
      "node_modules/.bun/alpha@1.0.0/node_modules/alpha/index.js",
      "node_modules/.bun/alpha@1.0.0/node_modules/alpha/package.json",
      "node_modules/.bun/alpha@1.0.0/node_modules/delta",
      "node_modules/.bun/alpha@1.0.0/node_modules/gamma",
      "node_modules/.bun/delta@2.0.0/node_modules/delta/index.js",
      "node_modules/.bun/delta@2.0.0/node_modules/delta/package.json",
      "node_modules/.bun/gamma@1.0.0/node_modules/gamma/index.js",
      "node_modules/.bun/gamma@1.0.0/node_modules/gamma/package.json",
    ]);
    expect(await realpath(path.join(out, "apps/server/node_modules/alpha"))).toBe(
      path.join(await realpath(out), "node_modules/.bun/alpha@1.0.0/node_modules/alpha"),
    );
  });

  it("runs from the copy, wherever it is, once the original is gone", async () => {
    await exportRuntimeDependencies({ root, workspace: "apps/server", out });
    await rm(root, { recursive: true, force: true });
    const moved = `${out}-moved`;
    await rm(moved, { recursive: true, force: true });
    execFileSync("mv", [out, moved]);
    out = moved;
    await writeFile(
      path.join(out, "apps/server/main.mjs"),
      'import { alpha } from "alpha";\nimport { beta } from "@scope/beta";\nconsole.log(alpha, beta);\n',
    );

    const printed = execFileSync("node", [path.join(out, "apps/server/main.mjs")]);

    expect(printed.toString()).toBe("alpha+gamma gamma\n");
  });
});

describe("runtimeDependenciesCommand", () => {
  function capture() {
    const lines: string[] = [];
    const errors: string[] = [];
    return {
      io: { log: (line: string) => lines.push(line), error: (line: string) => errors.push(line) },
      lines,
      errors,
    };
  }

  it("prints each package and the count, exit 0", async () => {
    const { io, lines, errors } = capture();

    expect(await runtimeDependenciesCommand([root, "apps/server", out], io)).toBe(0);
    expect(lines).toEqual([
      "@scope/beta@1.0.0",
      "alpha@1.0.0",
      "delta@2.0.0",
      "gamma@1.0.0",
      "4 runtime packages",
    ]);
    expect(errors).toEqual([]);
  });

  it.each([[[]], [["a", "b"]], [["a", "b", "c", "d"]]])(
    "prints the usage for %j, exit 2",
    async (argv) => {
      const { io, errors } = capture();

      expect(await runtimeDependenciesCommand(argv, io)).toBe(2);
      expect(errors).toEqual(["Usage: runtime-dependencies <root> <workspace> <out>"]);
    },
  );

  it("prints why it failed, exit 1", async () => {
    const { io, errors } = capture();

    expect(await runtimeDependenciesCommand([root, "apps/missing", out], io)).toBe(1);
    expect(errors[0]).toMatch(/ENOENT/);
  });
});
