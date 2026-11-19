import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function postgresImages(file: string): string[] {
  const text = readFileSync(path.join(root, file), "utf8");
  return [...text.matchAll(/^\s*image:\s*(postgres:\S+)\s*$/gm)].map((match) => match[1] ?? "");
}

describe("Postgres image", () => {
  it("is the same pinned 18.x tag locally and in CI", () => {
    const local = postgresImages("docker-compose.local.yml");
    const ci = postgresImages(".github/workflows/ci.yml");

    expect(local).toHaveLength(1);
    expect(local[0]).toMatch(/^postgres:18\.\d+$/);
    expect(ci).toEqual(local);
  });
});
