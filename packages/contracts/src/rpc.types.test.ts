/**
 * A type-level test: `bun run typecheck` fails if `defineRpc` stops requiring an auth level. The
 * `@ts-expect-error` line must be an error; if a contract without `auth` were accepted, the
 * directive would be unused and TypeScript would report that instead.
 */
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { defineRpc } from "./rpc";

describe("defineRpc's types", () => {
  it("require an auth level: there is no default", () => {
    // @ts-expect-error auth is required: there is no default level.
    const contract = defineRpc({
      method: "example.none",
      payload: Schema.Struct({}),
      success: Schema.Struct({}),
    });

    // At run time defineRpc copies what it is given, so the guard is the compiler alone.
    expect(contract.auth).toBeUndefined();
  });
});
