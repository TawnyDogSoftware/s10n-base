import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { baseImages, dockerfileProblems, moveRuntime, tagsFor } from "./dockerfile-versions";

const NODE_DIGEST = `sha256:${"a".repeat(64)}`;
const BUN_DIGEST = `sha256:${"b".repeat(64)}`;
const NEW_DIGEST = `sha256:${"c".repeat(64)}`;

const dockerfile = [
  `FROM oven/bun:1.4.4-slim@${BUN_DIGEST} AS bun`,
  `FROM node:26.13.1-trixie-slim@${NODE_DIGEST} AS toolchain`,
  "COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun",
  'RUN test "$(node --version)" = "v26.13.1" && test "$(bun --version)" = "1.4.4"',
  "FROM toolchain AS build",
  "FROM build",
  `from --platform=linux/amd64 node:26.13.1-trixie-slim@${NODE_DIGEST} as runtime`,
  "",
].join("\n");

const versions = { node: "26.13.1", bun: "1.4.4" };

describe("baseImages", () => {
  it("lists each image built from, with tag and digest, but not the file's own stages", () => {
    expect(baseImages(dockerfile)).toEqual([
      { image: "oven/bun", tag: "1.4.4-slim", digest: BUN_DIGEST },
      { image: "node", tag: "26.13.1-trixie-slim", digest: NODE_DIGEST },
      { image: "node", tag: "26.13.1-trixie-slim", digest: NODE_DIGEST },
    ]);
  });

  it("reads an image with no tag or digest", () => {
    expect(baseImages("FROM scratch\n")).toEqual([
      { image: "scratch", tag: undefined, digest: undefined },
    ]);
  });
});

describe("dockerfileProblems", () => {
  it("accepts a Dockerfile that agrees with the versions", () => {
    expect(dockerfileProblems(dockerfile, versions)).toEqual([]);
  });

  it("names a Node or bun tag that disagrees, and the check that does", () => {
    expect(dockerfileProblems(dockerfile, { node: "26.14.0", bun: "1.4.5" })).toEqual([
      "docker/Dockerfile must use node:26.14.0, to match, found node:26.13.1-trixie-slim",
      "docker/Dockerfile must use node:26.14.0, to match, found node:26.13.1-trixie-slim",
      'docker/Dockerfile must check the node version with: test "$(node --version)" = "v26.14.0"',
      "docker/Dockerfile must use oven/bun:1.4.5, to match, found oven/bun:1.4.4-slim",
      'docker/Dockerfile must check the bun version with: test "$(bun --version)" = "1.4.5"',
    ]);
  });

  it("requires every base image to be pinned by digest", () => {
    const text = dockerfile
      .replace(`@${BUN_DIGEST}`, "")
      .replace(`@${NODE_DIGEST}`, "@sha256:short");

    expect(dockerfileProblems(text, versions)).toEqual([
      "docker/Dockerfile must pin oven/bun by digest (@sha256:...)",
      "docker/Dockerfile must pin node by digest (@sha256:...)",
    ]);
  });

  it("requires the Node and bun images, and a tag on each", () => {
    expect(dockerfileProblems(`FROM node@${NODE_DIGEST}\n`, versions)).toEqual([
      "docker/Dockerfile must use node:26.13.1, to match, found node:",
      'docker/Dockerfile must check the node version with: test "$(node --version)" = "v26.13.1"',
      "docker/Dockerfile must build from the oven/bun image",
      'docker/Dockerfile must check the bun version with: test "$(bun --version)" = "1.4.4"',
    ]);
  });
});

describe("tagsFor", () => {
  it("keeps each image's own variant, once per variant", () => {
    const move = { from: "26.13.1", to: "26.14.0" };
    expect(tagsFor(dockerfile, "node", move)).toEqual(["26.14.0-trixie-slim"]);
    expect(tagsFor(dockerfile, "bun", { from: "1.4.4", to: "1.4.5" })).toEqual(["1.4.5-slim"]);
    expect(
      tagsFor(
        `FROM node:26.13.1-slim@${NODE_DIGEST}\nFROM node:lts\nFROM node\nFROM node:26.13.1-alpine\n`,
        "node",
        move,
      ),
    ).toEqual(["26.14.0-slim", "26.14.0-alpine"]);
  });

  it("is the bare version for a tag without a variant, and nothing without such an image", () => {
    const move = { from: "26.13.1", to: "26.14.0" };
    expect(tagsFor(`FROM node:26.13.1@${NODE_DIGEST}\n`, "node", move)).toEqual(["26.14.0"]);
    expect(tagsFor("FROM scratch\n", "bun", { from: "1.4.4", to: "1.4.5" })).toEqual([]);
  });
});

/** The new digest, for one tag. */
function digests(tag: string): Record<string, string> {
  return { [tag]: NEW_DIGEST };
}

describe("moveRuntime", () => {
  it("moves every image of the runtime to the new tag and digest, and the build's check", () => {
    const moved = moveRuntime(dockerfile, "node", {
      from: "26.13.1",
      to: "26.14.0",
      digests: digests("26.14.0-trixie-slim"),
    });

    expect(moved).toBe(
      dockerfile
        .replaceAll(
          `node:26.13.1-trixie-slim@${NODE_DIGEST}`,
          `node:26.14.0-trixie-slim@${NEW_DIGEST}`,
        )
        .replace('= "v26.13.1"', '= "v26.14.0"'),
    );
    expect(dockerfileProblems(moved, { node: "26.14.0", bun: "1.4.4" })).toEqual([]);
  });

  it("moves each variant to its own tag and digest", () => {
    const text = `FROM node:26.13.1-slim@${NODE_DIGEST}\nFROM node:26.13.1-alpine@${NODE_DIGEST}\n`;
    const alpine = `sha256:${"d".repeat(64)}`;

    expect(
      moveRuntime(text, "node", {
        from: "26.13.1",
        to: "26.14.0",
        digests: { "26.14.0-slim": NEW_DIGEST, "26.14.0-alpine": alpine },
      }),
    ).toBe(`FROM node:26.14.0-slim@${NEW_DIGEST}\nFROM node:26.14.0-alpine@${alpine}\n`);
  });

  it("refuses to move an image whose new tag has no digest", () => {
    expect(() =>
      moveRuntime(dockerfile, "node", { from: "26.13.1", to: "26.14.0", digests: {} }),
    ).toThrow("No digest given for node:26.14.0-trixie-slim");
  });

  it("moves bun and leaves Node alone", () => {
    const moved = moveRuntime(dockerfile, "bun", {
      from: "1.4.4",
      to: "1.4.5",
      digests: digests("1.4.5-slim"),
    });

    expect(dockerfileProblems(moved, { node: "26.13.1", bun: "1.4.5" })).toEqual([]);
    expect(baseImages(moved)[0]).toEqual({
      image: "oven/bun",
      tag: "1.4.5-slim",
      digest: NEW_DIGEST,
    });
  });

  it("leaves an untagged image of the runtime alone", () => {
    const text = `FROM node@${NODE_DIGEST}\n`;

    expect(moveRuntime(text, "node", { from: "26.13.1", to: "26.14.0", digests: {} })).toBe(text);
  });

  it("pins an image that had no digest, and leaves other versions alone", () => {
    const text = `FROM node:26.13.1-slim\nFROM node:24.1.0-slim@${NODE_DIGEST}\nFROM node:lts\n`;

    expect(
      moveRuntime(text, "node", {
        from: "26.13.1",
        to: "26.14.0",
        digests: digests("26.14.0-slim"),
      }),
    ).toBe(
      `FROM node:26.14.0-slim@${NEW_DIGEST}\nFROM node:24.1.0-slim@${NODE_DIGEST}\nFROM node:lts\n`,
    );
  });
});

describe("the repository's Dockerfile", () => {
  it("parses into the bun image and two Node images", () => {
    const text = readFileSync(path.resolve(import.meta.dirname, "../docker/Dockerfile"), "utf8");

    expect(baseImages(text).map((entry) => entry.image)).toEqual(["oven/bun", "node", "node"]);
  });
});
