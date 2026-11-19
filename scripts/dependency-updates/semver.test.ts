import { describe, expect, it } from "vitest";

import { classifyChange, compareVersions, satisfies, specBaseVersion } from "./semver";

describe("compareVersions", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0);
  });
});

describe("specBaseVersion", () => {
  it("reads the version out of exact, caret, tilde and >= specs", () => {
    expect(specBaseVersion("4.1.4")).toBe("4.1.4");
    expect(specBaseVersion("^8.3.8")).toBe("8.3.8");
    expect(specBaseVersion("~6.0.3")).toBe("6.0.3");
    expect(specBaseVersion(">=26.13.1")).toBe("26.13.1");
  });

  it("returns undefined for specs without a version", () => {
    expect(specBaseVersion("catalog:")).toBeUndefined();
    expect(specBaseVersion("workspace:*")).toBeUndefined();
  });
});

describe("satisfies", () => {
  it.each([
    ["6.0.3", "<6.1.0", true],
    ["6.1.0", "<6.1.0", false],
    ["0.29.9", "0.29.x", true],
    ["0.30.0", "0.29.x", false],
    ["19.3.4", "~19.3.0", true],
    ["19.4.0", "~19.3.0", false],
    ["26.9.0", "^26.0.0", true],
    ["27.0.0", "^26.0.0", false],
    ["0.29.9", "^0.29.0", true],
    ["0.30.0", "^0.29.0", false],
    ["1.7.25", "1.7.25", true],
    ["1.7.26", "1.7.25", false],
    ["5.0.0", ">=4.0.0 <6.0.0", true],
    ["6.0.0", ">=4.0.0 <6.0.0", false],
    ["4.0.0", ">4.0.0", false],
    ["4.0.0", "<=4.0.0", true],
  ])("%s against %s is %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });

  it("rejects a range it cannot read", () => {
    expect(() => satisfies("1.0.0", "1.0 || 2.0")).toThrow(
      'Unsupported version range "1.0 || 2.0"',
    );
  });
});

describe("classifyChange", () => {
  it("names the part of the version that moved", () => {
    expect(classifyChange("1.2.3", "2.0.0")).toBe("major");
    expect(classifyChange("1.2.3", "1.3.0")).toBe("minor");
    expect(classifyChange("1.2.3", "1.2.4")).toBe("patch");
  });

  it("treats a minor change below 1.0 as major, since 0.x minors may break", () => {
    expect(classifyChange("0.23.7", "0.24.0")).toBe("major");
    expect(classifyChange("0.23.7", "0.23.8")).toBe("patch");
  });
});
