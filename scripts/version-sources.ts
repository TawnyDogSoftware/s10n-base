import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DOCKERFILE, dockerfileProblems } from "./dockerfile-versions";

/**
 * Each tool version lives in one file: Node in `.nvmrc`, bun in `packageManager`.
 * `engines` and `@types/node` follow them, and CI reads the two files directly. The Dockerfile
 * cannot read a file in a `FROM` line, so it names both, and must agree.
 */
export interface VersionSources {
  readonly nvmrc: string;
  readonly enginesNode: string | undefined;
  readonly packageManager: string | undefined;
  readonly enginesBun: string | undefined;
  readonly typesNode: string | undefined;
  /** docker/Dockerfile's text, when the project has one. */
  readonly dockerfile: string | undefined;
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
    dockerfile: existsSync(path.join(rootDir, DOCKERFILE))
      ? readFileSync(path.join(rootDir, DOCKERFILE), "utf8")
      : undefined,
  };
}

function describeFound(value: string | undefined): string {
  return value === undefined ? "nothing" : `"${value}"`;
}

function nodeProblems(sources: VersionSources): string[] {
  if (!EXACT_VERSION.test(sources.nvmrc)) {
    return [`.nvmrc must hold an exact Node version such as 26.13.1, found "${sources.nvmrc}"`];
  }
  const problems: string[] = [];
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
  return problems;
}

function bunVersionOf(sources: VersionSources): string | undefined {
  return sources.packageManager?.startsWith("bun@")
    ? sources.packageManager.slice("bun@".length)
    : undefined;
}

function bunProblems(sources: VersionSources): string[] {
  const bunVersion = bunVersionOf(sources);
  if (bunVersion === undefined || !EXACT_VERSION.test(bunVersion)) {
    return [
      `packageManager must be "bun@<exact version>", found ${describeFound(sources.packageManager)}`,
    ];
  }
  if (sources.enginesBun !== `>=${bunVersion}`) {
    return [
      `engines.bun must be ">=${bunVersion}" to match packageManager, found ${describeFound(sources.enginesBun)}`,
    ];
  }
  return [];
}

/** The Dockerfile against the two sources, once both sources are themselves valid. */
function dockerProblems(sources: VersionSources, valid: boolean): string[] {
  const bun = bunVersionOf(sources);
  if (sources.dockerfile === undefined || !valid || bun === undefined) return [];
  return dockerfileProblems(sources.dockerfile, { node: sources.nvmrc, bun });
}

export function checkVersionSources(sources: VersionSources): string[] {
  const problems = [...nodeProblems(sources), ...bunProblems(sources)];
  return [...problems, ...dockerProblems(sources, problems.length === 0)];
}
