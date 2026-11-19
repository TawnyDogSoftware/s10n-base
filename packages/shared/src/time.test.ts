import { afterEach, describe, expect, it, vi } from "vitest";

import { nowIso } from "./time";

afterEach(() => {
  vi.useRealTimers();
});

describe("nowIso", () => {
  it("returns the current time as an ISO 8601 string", () => {
    vi.useFakeTimers({ now: new Date("2026-11-19T06:00:00.000Z") });

    expect(nowIso()).toBe("2026-11-19T06:00:00.000Z");
  });
});
