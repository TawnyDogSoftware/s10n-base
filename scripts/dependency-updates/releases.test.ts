import { describe, expect, it } from "vitest";

import { pickBunRelease, pickNodeRelease, type NodeIndexEntry } from "./releases";

const now = new Date("2026-11-19T06:00:00Z");

describe("pickBunRelease", () => {
  it("takes the newest stable release that is at least 3 days old", () => {
    expect(
      pickBunRelease(
        [
          {
            tag_name: "bun-v1.4.6",
            published_at: "2026-11-18T00:00:00Z",
            prerelease: false,
            draft: false,
          },
          {
            tag_name: "bun-v1.5.0-canary.1",
            published_at: "2026-11-01T00:00:00Z",
            prerelease: true,
            draft: false,
          },
          {
            tag_name: "bun-v1.4.5",
            published_at: "2026-11-15T00:00:00Z",
            prerelease: false,
            draft: false,
          },
          {
            tag_name: "bun-v1.4.4",
            published_at: "2026-10-22T10:11:32Z",
            prerelease: false,
            draft: false,
          },
        ],
        now,
      ),
    ).toBe("1.4.5");
  });

  it("returns undefined when nothing qualifies", () => {
    expect(pickBunRelease([], now)).toBeUndefined();
  });
});

describe("pickNodeRelease", () => {
  const index: NodeIndexEntry[] = [
    { version: "v28.1.0", date: "2026-11-01", lts: "Next" },
    { version: "v27.0.0-alpha.0.1.1", date: "2026-11-16", lts: false },
    { version: "v26.13.2", date: "2026-11-17", lts: "Lithium" },
    { version: "v26.13.1", date: "2026-11-10", lts: "Lithium" },
    { version: "v26.12.1", date: "2026-10-21", lts: false },
    { version: "v24.22.3", date: "2026-11-10", lts: "Krypton" },
  ];

  it("takes the newest release at least 3 days old on the current major", () => {
    expect(pickNodeRelease(index, 26, now)).toEqual({ version: "26.13.1", newerLtsMajor: 28 });
  });

  it("skips a release whose date cannot be read", () => {
    expect(
      pickNodeRelease([{ version: "v26.13.2", date: "17 Nov 2026", lts: "Lithium" }], 26, now),
    ).toEqual({ version: undefined, newerLtsMajor: undefined });
  });

  it("counts a release dated today or 3 days ago as too young", () => {
    expect(
      pickNodeRelease([{ version: "v26.13.2", date: "2026-11-16", lts: "Lithium" }], 26, now),
    ).toEqual({ version: undefined, newerLtsMajor: undefined });
  });
});
