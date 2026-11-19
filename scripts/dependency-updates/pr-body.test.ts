import { describe, expect, it } from "vitest";

import { buildPrBody, type PrBodyInput } from "./pr-body";

const empty: PrBodyInput = {
  date: "2026-11-19",
  baseBranch: "main",
  freshStart: false,
  changes: [],
  runtimes: [],
  notApplied: [],
  heldByAge: [],
};

describe("buildPrBody", () => {
  it("groups package changes as major, minor and patch", () => {
    const body = buildPrBody({
      ...empty,
      changes: [
        { name: "vite", from: "8.3.8", to: "9.0.1", kind: "major" },
        { name: "oxlint", from: "1.93.0", to: "1.94.0", kind: "minor" },
        { name: "effect", from: "4.1.4", to: "4.1.5", kind: "patch" },
        { name: "jsdom", from: "31.0.1", to: "32.0.0", kind: "major" },
      ],
    });

    expect(body).toContain(
      "## Major\n\n| Package | From | To |\n| --- | --- | --- |\n| jsdom | 31.0.1 | 32.0.0 |\n| vite | 8.3.8 | 9.0.1 |\n",
    );
    expect(body).toContain(
      "## Minor\n\n| Package | From | To |\n| --- | --- | --- |\n| oxlint | 1.93.0 | 1.94.0 |\n",
    );
    expect(body).toContain(
      "## Patch\n\n| Package | From | To |\n| --- | --- | --- |\n| effect | 4.1.4 | 4.1.5 |\n",
    );
    expect(body.indexOf("## Major")).toBeLessThan(body.indexOf("## Minor"));
  });

  it("says so when no package changed", () => {
    expect(buildPrBody(empty)).toContain("No package versions changed.");
  });

  it("lists bun and Node changes", () => {
    const body = buildPrBody({
      ...empty,
      runtimes: [
        { name: "bun", from: "1.4.4", to: "1.4.5", files: "`packageManager` and `engines.bun`" },
        { name: "Node", from: "26.13.1", to: "26.13.2", files: "`.nvmrc` and `engines.node`" },
      ],
    });

    expect(body).toContain(
      "## bun and Node\n\n- bun 1.4.4 → 1.4.5 (`packageManager` and `engines.bun`)\n- Node 26.13.1 → 26.13.2 (`.nvmrc` and `engines.node`)\n",
    );
  });

  it("lists what was reported but not applied", () => {
    const body = buildPrBody({ ...empty, notApplied: ["Node 28 is a newer LTS line."] });

    expect(body).toContain("## Reported, not applied\n\n- Node 28 is a newer LTS line.\n");
  });

  it("lists releases held back by the 3-day rule with how to take a patch early", () => {
    const body = buildPrBody({
      ...empty,
      heldByAge: [
        {
          name: "turbo",
          current: "2.11.11",
          newest: "2.11.13",
          publishedAt: "2026-11-18T15:28:52.490Z",
        },
        { name: "oxlint", current: "1.93.0" },
      ],
    });

    expect(body).toContain(
      "| Package | Installed | Newest | Published |\n| --- | --- | --- | --- |\n| oxlint | 1.93.0 | (unknown) | (unknown) |\n| turbo | 2.11.11 | 2.11.13 | 2026-11-18 |\n",
    );
    expect(body).toContain("docs/dependencies.md");
  });

  it("says when a merge conflict forced a fresh start", () => {
    expect(buildPrBody({ ...empty, freshStart: true })).toContain(
      "Merging `main` into the previous update branch conflicted, so this update starts again from `main`",
    );
    expect(buildPrBody(empty)).not.toContain("conflicted");
  });
});
