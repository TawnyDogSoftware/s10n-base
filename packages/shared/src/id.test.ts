import { describe, expect, it } from "vitest";

import { createId } from "./id";

describe("createId", () => {
  it("joins the prefix and 32 lowercase hex characters", () => {
    expect(createId("user")).toMatch(/^user_[0-9a-f]{32}$/);
  });

  it("returns a different id each time", () => {
    expect(createId("user")).not.toBe(createId("user"));
  });
});
