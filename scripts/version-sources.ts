import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Each tool version lives in one file: Node in `.nvmrc`, bun in `packageManager`.
 * `engines` and `@types/node` follow them, and CI reads the two files directly.
 */
export interface VersionSources {
  readonly nvmrc: string;
  readonly enginesNode: string | undefined;
  readonly packageManager: string | undefined;
  readonly enginesBun: string | undefined;
  readonly typesNode: string | undefined;
}

interface RootManifest {
  readonly packageManager?: string;
  readonly engines?: { readonly node?: string; readonly bun?: string };
  readonly workspaces?: { readonly catalog?: Readonly<Record<string, string>> };
}

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

export function readVersionSources(rootDir: string): VersionSources {
  const manifest = JSON.parse(
    readFileSync(path.join(rootDir, "package.json"), "utf8"),
  ) as RootManifest;
  return {
    nvmrc: readFileSync(path.join(rootDir, ".nvmrc"), "utf8").trim(),
    enginesNode: manifest.engines?.node,
    packageManager: manifest.packageManager,
    enginesBun: manifest.engines?.bun,
    typesNode: manifest.workspaces?.catalog?.["@types/node"],
  };
}

function describeFound(value: string | undefined): string {
  return value === undefined ? "nothing" : `"${value}"`;
}

export function checkVersionSources(sources: VersionSources): string[] {
  const problems: string[] = [];

  if (!EXACT_VERSION.test(sources.nvmrc)) {
    problems.push(
      `.nvmrc must hold an exact Node version such as 26.13.1, found "${sources.nvmrc}"`,
    );
  } else {
    if (sources.enginesNode !== `>=${sources.nvmrc}`) {
      problems.push(
        `engines.node must be ">=${sources.nvmrc}" to match .nvmrc, found ${describeFound(sources.enginesNode)}`,
      );
    }
    const nodeMajor = sources.nvmrc.slice(0, sources.nvmrc.indexOf("."));
    if (sources.typesNode === undefined) {
      problems.push("@types/node must be in the root catalog");
    } else if (/^[\^~]?(\d+)\./.exec(sources.typesNode)?.[1] !== nodeMajor) {
      problems.push(
        `@types/node must be on Node's major version ${nodeMajor}, found "${sources.typesNode}"`,
      );
    }
  }

  const bunVersion = sources.packageManager?.startsWith("bun@")
    ? sources.packageManager.slice("bun@".length)
    : undefined;
  if (bunVersion === undefined || !EXACT_VERSION.test(bunVersion)) {
    problems.push(
      `packageManager must be "bun@<exact version>", found ${describeFound(sources.packageManager)}`,
    );
  } else if (sources.enginesBun !== `>=${bunVersion}`) {
    problems.push(
      `engines.bun must be ">=${bunVersion}" to match packageManager, found ${describeFound(sources.enginesBun)}`,
    );
  }

  return problems;
}
