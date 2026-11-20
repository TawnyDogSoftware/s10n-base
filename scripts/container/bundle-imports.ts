/**
 * Checks that the server bundle imports, at run time, exactly the packages the server declares as
 * dependencies, so the container image's packages (runtime-dependencies.ts, which starts from
 * those declarations) are the ones the bundle needs: `bun scripts/container/bundle-imports.main.ts
 * <dist> <package.json>`. tsdown leaves declared dependencies external and bundles workspace
 * packages; a package the bundle imports but the server does not declare would be missing from
 * the image, and one it declares but never imports would be dead weight.
 */
import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";

import { runtimeStarts } from "./runtime-dependencies";

/** `import … from "x"`, `import "x"` and `export … from "x"`, as a bundler writes them. */
const STATIC_IMPORT = /^(?:import|export)\b[^"'\n]*?["']([^"'\n]+)["'];?$/gm;
/** `import("x")` with a literal specifier. */
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"'\n]+)["']\s*\)/g;

const BUILTINS = new Set(builtinModules);

/** The package a bare specifier names, or undefined for a relative path or a Node builtin. */
export function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return undefined;
  }
  const name = specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
  return BUILTINS.has(name) ? undefined : name;
}

/** The packages a module's source imports. */
export function importedPackages(source: string): string[] {
  const specifiers = [...source.matchAll(STATIC_IMPORT), ...source.matchAll(DYNAMIC_IMPORT)].map(
    ([, specifier = ""]) => specifier,
  );
  return specifiers.flatMap((specifier) => {
    const name = packageOf(specifier);
    return name === undefined ? [] : [name];
  });
}

/** Problems with the bundle's imports against the declared runtime packages; empty when equal. */
export function compareImports(
  imported: ReadonlySet<string>,
  declared: ReadonlySet<string>,
): string[] {
  const missing = [...imported].filter((name) => !declared.has(name)).toSorted();
  const unused = [...declared].filter((name) => !imported.has(name)).toSorted();
  return [
    ...missing.map(
      (name) =>
        `The bundle imports ${name}, which the server does not declare as a dependency, so the image would not have it.`,
    ),
    ...unused.map(
      (name) =>
        `The server declares ${name}, which the bundle never imports: remove it from dependencies, or bundle it.`,
    ),
  ];
}

export interface CommandIo {
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

/** `bundle-imports <dist> <package.json>`. */
export async function bundleImportsCommand(
  argv: ReadonlyArray<string>,
  io: CommandIo,
): Promise<number> {
  const [dist, manifestPath] = argv;
  if (dist === undefined || manifestPath === undefined || argv.length > 2) {
    io.error("Usage: bundle-imports <dist> <package.json>");
    return 2;
  }
  try {
    const files = (await readdir(dist)).filter((file) => file.endsWith(".mjs"));
    if (files.length === 0) throw new Error(`${dist} holds no .mjs file: build the server first.`);
    const sources = await Promise.all(files.map((file) => readFile(path.join(dist, file), "utf8")));
    const imported = new Set(sources.flatMap(importedPackages));
    const declared = new Set(
      runtimeStarts(JSON.parse(await readFile(manifestPath, "utf8")) as object),
    );
    const problems = compareImports(imported, declared);
    for (const problem of problems) io.error(problem);
    if (problems.length > 0) return 1;
    io.log(`The bundle imports exactly its ${String(declared.size)} declared packages.`);
    return 0;
  } catch (error) {
    io.error((error as Error).message);
    return 1;
  }
}
