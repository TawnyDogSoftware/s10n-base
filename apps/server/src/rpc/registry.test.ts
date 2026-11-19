import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { defineRpc, rpcContracts } from "@s10n-base/contracts";

import { defineHandler } from "./dispatcher";
import { rpcHandlers } from "./handlers";
import { findRegistryMismatches } from "./registry";

const empty = Schema.Struct({});
const listed = defineRpc({
  method: "fixture.listed",
  auth: "public",
  payload: empty,
  success: empty,
});
const unserved = defineRpc({
  method: "fixture.unserved",
  auth: "session",
  payload: empty,
  success: empty,
});
const unlisted = defineRpc({
  method: "fixture.unlisted",
  auth: "public",
  payload: empty,
  success: empty,
});
const respond = () => Promise.resolve({});

describe("RPC registry", () => {
  it("has exactly one handler for every contract, and no handler without a contract", () => {
    expect(findRegistryMismatches(rpcContracts, rpcHandlers)).toEqual([]);
  });

  // The check above passes trivially while both lists are empty; this proves it can fail.
  it("reports a contract with no handler and a handler with no contract", () => {
    expect(
      findRegistryMismatches(
        [listed, unserved],
        [defineHandler(listed, respond), defineHandler(unlisted, respond)],
      ),
    ).toEqual([
      "fixture.unserved has a contract in rpcContracts but no handler.",
      "fixture.unlisted has a handler but no contract in rpcContracts.",
    ]);
  });

  it("reports a handler built from a different contract object with the same name", () => {
    const copy = defineRpc({
      method: "fixture.listed",
      auth: "session",
      payload: empty,
      success: empty,
    });

    expect(findRegistryMismatches([listed], [defineHandler(copy, respond)])).toEqual([
      "fixture.listed's handler does not use the contract listed in rpcContracts.",
    ]);
  });

  it("reports a method listed twice", () => {
    expect(findRegistryMismatches([listed, listed], [defineHandler(listed, respond)])).toEqual([
      "fixture.listed is listed more than once in rpcContracts.",
    ]);
  });
});
