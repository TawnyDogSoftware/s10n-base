/**
 * The Node and bun versions in docker/Dockerfile. A `FROM` line cannot read `.nvmrc` or
 * `packageManager`, so the Dockerfile names both versions itself: in its base images' tags, each
 * pinned by digest, and in the build step that checks them. `version-sources.ts` fails when they
 * disagree with the two sources, and the daily dependency update moves them with the sources.
 */

export const DOCKERFILE = "docker/Dockerfile";

/** The base images whose tags carry the runtime versions, by the runtime they carry. */
export const RUNTIME_IMAGES = { node: "node", bun: "oven/bun" } as const;
export type Runtime = keyof typeof RUNTIME_IMAGES;

/** A `FROM` line that names an image (not an earlier stage). */
export interface BaseImage {
  readonly image: string;
  readonly tag: string | undefined;
  readonly digest: string | undefined;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const VERSION_TAG = /^(\d+\.\d+\.\d+)(-[a-z0-9.-]+)?$/;

interface FromLine {
  /** The image reference as written, such as `node:26.13.1-slim@sha256:...`. */
  readonly reference: string;
  readonly image: BaseImage;
  readonly alias: string | undefined;
}

/** `name[:tag][@digest]`. */
function parseReference(reference: string): BaseImage {
  const [nameAndTag = "", digest] = reference.split("@");
  const colon = nameAndTag.lastIndexOf(":");
  return colon === -1
    ? { image: nameAndTag, tag: undefined, digest }
    : { image: nameAndTag.slice(0, colon), tag: nameAndTag.slice(colon + 1), digest };
}

/** A `FROM` line's reference and stage name, or undefined for any other line. */
function parseFromLine(line: string): FromLine | undefined {
  const words = line.trim().split(/\s+/);
  if (words[0]?.toUpperCase() !== "FROM") return undefined;
  const [reference = "", as, alias] = words.slice(1).filter((word) => !word.startsWith("--"));
  return {
    reference,
    image: parseReference(reference),
    alias: as?.toUpperCase() === "AS" ? alias : undefined,
  };
}

/** The images the Dockerfile builds from, without references to its own stages. */
export function baseImages(text: string): BaseImage[] {
  const stages = new Set<string>();
  const images: BaseImage[] = [];
  for (const line of text.split("\n")) {
    const from = parseFromLine(line);
    if (from === undefined) continue;
    if (!stages.has(from.image.image)) images.push(from.image);
    if (from.alias !== undefined) stages.add(from.alias);
  }
  return images;
}

/** The check the build runs, as the Dockerfile writes it for `version`. */
function versionCheck(runtime: Runtime, version: string): string {
  return runtime === "node"
    ? `test "$(node --version)" = "v${version}"`
    : `test "$(bun --version)" = "${version}"`;
}

function runtimeProblems(text: string, runtime: Runtime, version: string): string[] {
  const image = RUNTIME_IMAGES[runtime];
  const tags = baseImages(text)
    .filter((entry) => entry.image === image)
    .map((entry) => entry.tag ?? "");
  const problems: string[] = [];
  if (tags.length === 0) problems.push(`${DOCKERFILE} must build from the ${image} image`);
  for (const tag of tags) {
    if (VERSION_TAG.exec(tag)?.[1] !== version) {
      problems.push(`${DOCKERFILE} must use ${image}:${version}, to match, found ${image}:${tag}`);
    }
  }
  if (!text.includes(versionCheck(runtime, version))) {
    problems.push(
      `${DOCKERFILE} must check the ${runtime} version with: ${versionCheck(runtime, version)}`,
    );
  }
  return problems;
}

/** Problems with the Dockerfile's versions against Node's and bun's; empty when they agree. */
export function dockerfileProblems(
  text: string,
  versions: { readonly node: string; readonly bun: string },
): string[] {
  const unpinned = baseImages(text)
    .filter((entry) => entry.digest === undefined || !DIGEST.test(entry.digest))
    .map((entry) => `${DOCKERFILE} must pin ${entry.image} by digest (@sha256:...)`);
  return [
    ...unpinned,
    ...runtimeProblems(text, "node", versions.node),
    ...runtimeProblems(text, "bun", versions.bun),
  ];
}

/** The tag an image on a version tag would have at `version`, keeping its variant (`-slim`). */
function movedTag(tag: string, version: string): string {
  return tag.replace(/^\d+\.\d+\.\d+/, version);
}

/** The tags of a runtime's images that are on `version`, as `FROM` lines write them. */
function tagsAt(text: string, runtime: Runtime, version: string): string[] {
  return baseImages(text).flatMap(({ image, tag }) =>
    image === RUNTIME_IMAGES[runtime] && tag !== undefined && VERSION_TAG.exec(tag)?.[1] === version
      ? [tag]
      : [],
  );
}

/**
 * The distinct tags a runtime's images would have when moved from one version to another: one
 * per variant the Dockerfile uses, since stages may build from different variants of one image.
 */
export function tagsFor(
  text: string,
  runtime: Runtime,
  change: { readonly from: string; readonly to: string },
): string[] {
  return [...new Set(tagsAt(text, runtime, change.from).map((tag) => movedTag(tag, change.to)))];
}

export interface ImageChange {
  readonly from: string;
  readonly to: string;
  /** The digest of each new tag, as `tagsFor` lists them. */
  readonly digests: Readonly<Record<string, string>>;
}

/**
 * The Dockerfile with a runtime moved from one version to another: each `FROM` line keeps its own
 * variant and is pinned to that tag's digest, and the build's check names the new version.
 */
export function moveRuntime(text: string, runtime: Runtime, change: ImageChange): string {
  const image = RUNTIME_IMAGES[runtime];
  return text
    .split("\n")
    .map((line) => {
      const from = parseFromLine(line);
      const current = from?.image.image === image ? from.image.tag : undefined;
      if (from === undefined || current === undefined) return line;
      if (VERSION_TAG.exec(current)?.[1] !== change.from) return line;
      const tag = movedTag(current, change.to);
      const digest = change.digests[tag];
      if (digest === undefined) throw new Error(`No digest given for ${image}:${tag}`);
      return line.replace(from.reference, `${image}:${tag}@${digest}`);
    })
    .join("\n")
    .replaceAll(versionCheck(runtime, change.from), versionCheck(runtime, change.to));
}
