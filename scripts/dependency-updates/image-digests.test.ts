import { describe, expect, it } from "vitest";

import { repositoryOf, resolveImageDigest, type RegistryIo } from "./image-digests";

const DIGEST = `sha256:${"d".repeat(64)}`;

/** A fake registry: tokens for any repository, and digests for the tags it knows. */
function registry(tags: Record<string, string | undefined>, token: unknown = "t0ken") {
  const requests: Array<{ url: string; headers?: Readonly<Record<string, string>> }> = [];
  const io: RegistryIo = {
    fetchJson: (url) => {
      requests.push({ url });
      return Promise.resolve(token === null ? null : { token });
    },
    fetchHeaders: (url, headers) => {
      requests.push({ url, headers });
      const tag = url.slice(url.indexOf("/v2/") + 4);
      if (!(tag in tags)) return Promise.reject(new Error(`HEAD ${url} answered 404`));
      const digest = tags[tag];
      return Promise.resolve(digest === undefined ? {} : { "docker-content-digest": digest });
    },
  };
  return { io, requests };
}

describe("repositoryOf", () => {
  it("puts official images under library/", () => {
    expect(repositoryOf("node")).toBe("library/node");
    expect(repositoryOf("oven/bun")).toBe("oven/bun");
  });
});

describe("resolveImageDigest", () => {
  it("asks for a pull token, then the tag's manifest digest with it", async () => {
    const { io, requests } = registry({ "library/node/manifests/26.14.0-trixie-slim": DIGEST });

    expect(await resolveImageDigest(io, "node", "26.14.0-trixie-slim")).toBe(DIGEST);
    expect(requests[0]?.url).toBe(
      "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull",
    );
    expect(requests[1]?.url).toBe(
      "https://registry-1.docker.io/v2/library/node/manifests/26.14.0-trixie-slim",
    );
    expect(requests[1]?.headers?.Authorization).toBe("Bearer t0ken");
    expect(requests[1]?.headers?.Accept).toContain("application/vnd.oci.image.index.v1+json");
  });

  it("fails when the tag does not exist", async () => {
    const { io } = registry({});

    await expect(resolveImageDigest(io, "oven/bun", "9.9.9-slim")).rejects.toThrow(
      "HEAD https://registry-1.docker.io/v2/oven/bun/manifests/9.9.9-slim answered 404",
    );
  });

  it.each([[null], [42]])("fails when the registry gives no token (%j)", async (token) => {
    const { io } = registry({}, token);

    await expect(resolveImageDigest(io, "node", "26.14.0")).rejects.toThrow(
      "The registry gave no token for library/node.",
    );
  });

  it.each([[undefined], ["sha256:short"]])("fails without a valid digest (%j)", async (digest) => {
    const { io } = registry({ "library/node/manifests/26.14.0": digest });

    await expect(resolveImageDigest(io, "node", "26.14.0")).rejects.toThrow(
      "The registry gave no digest for node:26.14.0.",
    );
  });
});
