import { describe, expect, it } from "vitest";

import { parseArgs } from "./run";

describe("parseArgs", () => {
  it("defaults to a real run from main", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, from: undefined });
  });

  it("reads --dry-run and --from", () => {
    expect(parseArgs(["--dry-run", "--from", "HEAD"])).toEqual({ dryRun: true, from: "HEAD" });
  });

  it("rejects --from without a ref and unknown arguments", () => {
    expect(() => parseArgs(["--from"])).toThrow("--from needs a git ref");
    expect(() => parseArgs(["--from", "--dry-run"])).toThrow("--from needs a git ref");
    expect(() => parseArgs(["--push"])).toThrow("Unknown argument: --push");
  });
});
