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

const FROM_LINE =
  /^FROM[ \t]+(?:--platform=\S+[ \t]+)?([^\s:@]+)(?::([^\s@]+))?(?:@(\S+))?(?:[ \t]+AS[ \t]+(\S+))?[ \t]*$/gim;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const VERSION_TAG = /^(\d+\.\d+\.\d+)(-[a-z0-9.-]+)?$/;

/** The images the Dockerfile builds from, without references to its own stages. */
export function baseImages(text: string): BaseImage[] {
  const stages = new Set<string>();
  const images: BaseImage[] = [];
  for (const [, image = "", tag, digest, alias] of text.matchAll(FROM_LINE)) {
    if (!stages.has(image)) images.push({ image, tag, digest });
    if (alias !== undefined) stages.add(alias);
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

/** The tag a runtime's image would have at `version`: the same variant, such as `-slim`. */
export function tagFor(text: string, runtime: Runtime, version: string): string {
  const current = baseImages(text).find((entry) => entry.image === RUNTIME_IMAGES[runtime]);
  const variant = VERSION_TAG.exec(current?.tag ?? "")?.[2] ?? "";
  return `${version}${variant}`;
}

export interface ImageChange {
  readonly from: string;
  readonly to: string;
  /** The digest of the new tag. */
  readonly digest: string;
}

/** The Dockerfile with a runtime moved from one version to another, its digest included. */
export function moveRuntime(text: string, runtime: Runtime, change: ImageChange): string {
  const image = RUNTIME_IMAGES[runtime];
  const tag = tagFor(text, runtime, change.to);
  const moved = (line: string, name: string, oldTag = "", oldDigest = ""): string =>
    name === image && VERSION_TAG.exec(oldTag)?.[1] === change.from
      ? line.replace(
          `${name}:${oldTag}${oldDigest === "" ? "" : `@${oldDigest}`}`,
          `${image}:${tag}@${change.digest}`,
        )
      : line;
  return text
    .replaceAll(FROM_LINE, moved)
    .replaceAll(versionCheck(runtime, change.from), versionCheck(runtime, change.to));
}
