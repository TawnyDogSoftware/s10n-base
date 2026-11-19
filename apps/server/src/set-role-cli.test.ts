import { describe, expect, it } from "vitest";

import { parseSetRoleArgs, runSetRoleCli } from "./set-role-cli";

describe("parseSetRoleArgs", () => {
  it("reads an email and a known role", () => {
    expect(parseSetRoleArgs(["admin@example.com", "admin"])).toEqual({
      email: "admin@example.com",
      role: "admin",
    });
    expect(parseSetRoleArgs([" user@example.com ", "user"]).email).toBe("user@example.com");
  });

  it.each([[[]], [["a@example.com"]], [["a@example.com", "admin", "extra"]], [["", "admin"]]])(
    "refuses %j with the usage line",
    (args) => {
      expect(() => parseSetRoleArgs(args)).toThrow(/^usage: auth:set-role <email> <user\|admin>/);
    },
  );

  it("refuses a role the app does not know", () => {
    expect(() => parseSetRoleArgs(["a@example.com", "owner"])).toThrow(/Unknown role "owner"/);
  });
});

describe("runSetRoleCli", () => {
  it("exits 2 with the usage line for bad arguments, before touching the database", async () => {
    const lines: string[] = [];

    const code = await runSetRoleCli({
      args: ["a@example.com", "root"],
      env: {},
      write: (line) => lines.push(line),
    });

    expect(code).toBe(2);
    expect(lines.join("")).toContain("set_role_usage");
  });

  it("exits 1 when DATABASE_URL is missing", async () => {
    const lines: string[] = [];

    const code = await runSetRoleCli({
      args: ["a@example.com", "admin"],
      env: {},
      write: (line) => lines.push(line),
    });

    expect(code).toBe(1);
    expect(lines.join("")).toContain("DATABASE_URL");
  });
});
