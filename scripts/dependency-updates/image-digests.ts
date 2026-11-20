/**
 * Looks up the digest of a public base image's tag, through the registry's anonymous pull API:
 * a token for the repository, then a HEAD request for the tag's manifest, whose
 * `Docker-Content-Digest` header is the digest a `FROM` line pins. The digest is the
 * multi-platform index, so the pin holds on every platform the image is built for.
 */

/** What the lookup needs from the outside world (part of the update's `Io`). */
export interface RegistryIo {
  fetchJson(url: string): Promise<unknown>;
  /** The response headers of a HEAD request, names in lowercase; throws on an error status. */
  fetchHeaders(
    url: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<Readonly<Record<string, string>>>;
}

const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Official images live under `library/`. */
export function repositoryOf(image: string): string {
  return image.includes("/") ? image : `library/${image}`;
}

export async function resolveImageDigest(
  io: RegistryIo,
  image: string,
  tag: string,
): Promise<string> {
  const repository = repositoryOf(image);
  const auth = await io.fetchJson(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`,
  );
  const token = (auth as { readonly token?: unknown } | null)?.token;
  if (typeof token !== "string") throw new Error(`The registry gave no token for ${repository}.`);
  const headers = await io.fetchHeaders(
    `https://registry-1.docker.io/v2/${repository}/manifests/${tag}`,
    { Accept: MANIFEST_TYPES, Authorization: `Bearer ${token}` },
  );
  const digest = headers["docker-content-digest"];
  if (digest === undefined || !DIGEST.test(digest)) {
    throw new Error(`The registry gave no digest for ${image}:${tag}.`);
  }
  return digest;
}
