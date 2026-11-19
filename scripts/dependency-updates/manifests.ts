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

/** Every version spec by package name: catalog entries, then direct specs in the manifests. */
export function collectSpecs(files: readonly ManifestFile[]): Map<string, string> {
  const specs = new Map<string, string>();
  for (const file of files) {
    for (const [name, spec] of Object.entries(catalogOf(file.json))) specs.set(name, spec);
  }
  for (const file of files) {
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [name, spec] of Object.entries(asStringRecord(file.json[section]))) {
        if (isVersionSpec(spec)) specs.set(name, spec);
      }
    }
  }
  return specs;
}

/** Writes `specs` wherever those packages are declared; returns only the files that changed. */
export function applySpecs(
  files: readonly ManifestFile[],
  specs: ReadonlyMap<string, string>,
): ManifestFile[] {
  return files.flatMap((file) => {
    const changed = new Set<string>();
    const replace = (record: Record<string, string>) => {
      const next = { ...record };
      for (const [name, spec] of Object.entries(record)) {
        const wanted = specs.get(name);
        if (wanted !== undefined && isVersionSpec(spec) && wanted !== spec) {
          next[name] = wanted;
          changed.add(name);
        }
      }
      return next;
    };

    let json: Record<string, unknown> = { ...file.json };
    const workspaces = file.json.workspaces;
    if (typeof workspaces === "object" && workspaces !== null && "catalog" in workspaces) {
      json = { ...json, workspaces: { ...workspaces, catalog: replace(catalogOf(file.json)) } };
    }
    for (const section of DEPENDENCY_SECTIONS) {
      if (section in file.json) json[section] = replace(asStringRecord(file.json[section]));
    }
    return changed.size > 0 ? [{ path: file.path, json }] : [];
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
