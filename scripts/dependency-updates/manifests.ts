export type Manifest = Readonly<Record<string, unknown>>;

export interface ManifestFile {
  readonly path: string;
  readonly json: Manifest;
}

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function catalogOf(manifest: Manifest): Record<string, string> {
  const workspaces = manifest.workspaces;
  return typeof workspaces === "object" && workspaces !== null && "catalog" in workspaces
    ? asStringRecord(workspaces.catalog)
    : {};
}

export function readCatalog(manifest: Manifest): Map<string, string> {
  return new Map(Object.entries(catalogOf(manifest)));
}

function isVersionSpec(spec: string): boolean {
  return !/^(catalog|workspace|file|link|git\+|https?):/.test(spec);
}

/** One place a package's version is written: a catalog, or a dependency section of a manifest. */
export interface Declaration {
  readonly path: string;
  readonly section: "catalog" | (typeof DEPENDENCY_SECTIONS)[number];
  readonly name: string;
  readonly spec: string;
}

/** Every version spec, once for each place it is declared: catalog entries, then direct specs. */
export function collectDeclarations(files: readonly ManifestFile[]): Declaration[] {
  const catalogs = files.flatMap((file) =>
    Object.entries(catalogOf(file.json)).map(([name, spec]): Declaration => {
      return { path: file.path, section: "catalog", name, spec };
    }),
  );
  const direct = files.flatMap((file) =>
    DEPENDENCY_SECTIONS.flatMap((section) =>
      Object.entries(asStringRecord(file.json[section]))
        .filter(([, spec]) => isVersionSpec(spec))
        .map(([name, spec]): Declaration => ({ path: file.path, section, name, spec })),
    ),
  );
  return [...catalogs, ...direct];
}

/** Every version spec by package name; where a package is declared twice, the last one read. */
export function collectSpecs(files: readonly ManifestFile[]): Map<string, string> {
  return new Map(collectDeclarations(files).map(({ name, spec }) => [name, spec]));
}

/**
 * Writes each declaration's spec at its own place, a later one for the same place winning. A
 * place that is not a version spec (`catalog:`, `workspace:`) is left alone. Returns only the
 * files that changed.
 */
export function applyDeclarations(
  files: readonly ManifestFile[],
  declarations: readonly Declaration[],
): ManifestFile[] {
  return files.flatMap((file) => {
    const mine = declarations.filter((declaration) => declaration.path === file.path);
    let changed = false;
    const replace = (section: Declaration["section"], record: Record<string, string>) => {
      const next = { ...record };
      for (const { name, spec } of mine.filter((item) => item.section === section)) {
        const current = next[name];
        if (current !== undefined && isVersionSpec(current) && current !== spec) {
          next[name] = spec;
          changed = true;
        }
      }
      return next;
    };

    let json: Record<string, unknown> = { ...file.json };
    const workspaces = file.json.workspaces;
    if (typeof workspaces === "object" && workspaces !== null && "catalog" in workspaces) {
      json = {
        ...json,
        workspaces: { ...workspaces, catalog: replace("catalog", catalogOf(file.json)) },
      };
    }
    for (const section of DEPENDENCY_SECTIONS) {
      if (section in file.json)
        json[section] = replace(section, asStringRecord(file.json[section]));
    }
    return changed ? [{ path: file.path, json }] : [];
  });
}

export function setRuntimeVersions(
  root: Manifest,
  versions: { readonly bun?: string; readonly node?: string },
): Manifest {
  const engines = { ...asStringRecord(root.engines) };
  const next: Record<string, unknown> = { ...root };
  if (versions.bun !== undefined) {
    next.packageManager = `bun@${versions.bun}`;
    engines.bun = `>=${versions.bun}`;
  }
  if (versions.node !== undefined) {
    engines.node = `>=${versions.node}`;
  }
  if (versions.bun !== undefined || versions.node !== undefined) next.engines = engines;
  return next;
}

export function formatManifest(json: Manifest): string {
  return `${JSON.stringify(json, null, 2)}\n`;
}
