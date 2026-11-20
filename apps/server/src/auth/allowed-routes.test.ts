import { describe, expect, it } from "vitest";

import { testAuthOptions } from "../test/auth-options";
import { EXPOSED_AUTH_ROUTES, UNEXPOSED_AUTH_ROUTES } from "./allowed-routes";
import { createAppAuth } from "./instance";
import { routeKey } from "./route-guard";

const inventory = createAppAuth(testAuthOptions()).routes.map(routeKey);
const exposed = EXPOSED_AUTH_ROUTES.map(routeKey);
const unexposed = UNEXPOSED_AUTH_ROUTES.map(routeKey);

describe("the auth route allow-list", () => {
  it("decides every route Better Auth serves: each is exposed or deliberately not", () => {
    const undecided = inventory.filter((key) => !exposed.includes(key) && !unexposed.includes(key));

    expect(undecided).toEqual([]);
  });

  it("lists no route Better Auth no longer serves", () => {
    expect([...exposed, ...unexposed].filter((key) => !inventory.includes(key))).toEqual([]);
  });

  it("puts each route on one list once, with a reason", () => {
    const all = [...exposed, ...unexposed];

    expect(new Set(all).size).toBe(all.length);
    for (const decision of [...EXPOSED_AUTH_ROUTES, ...UNEXPOSED_AUTH_ROUTES]) {
      expect(decision.reason.trim(), routeKey(decision)).not.toBe("");
    }
  });

  it("does not list the disabled remove-user endpoint or server-only endpoints", () => {
    expect(inventory).not.toContain("POST /admin/remove-user");
    expect(inventory.some((key) => key.endsWith(" "))).toBe(false);
  });

  it("would fail on a route nobody decided about", () => {
    const withNewRoute = [...inventory, "POST /new-endpoint"];

    expect(
      withNewRoute.filter((key) => !exposed.includes(key) && !unexposed.includes(key)),
    ).toEqual(["POST /new-endpoint"]);
  });
});
