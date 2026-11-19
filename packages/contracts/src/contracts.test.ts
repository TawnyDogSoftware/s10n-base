import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import * as contracts from "./index";
import { AppError, BootstrapConfig, RpcRequest, defineRpc, rpcContracts } from "./index";

describe("AppError", () => {
  it("decodes a valid error", () => {
    const decode = Schema.decodeUnknownSync(AppError);

    expect(decode({ code: "rpc.method_not_found", message: "Unknown method" })).toEqual({
      code: "rpc.method_not_found",
      message: "Unknown method",
    });
  });
});

describe("BootstrapConfig", () => {
  const decode = Schema.decodeUnknownSync(BootstrapConfig);

  it("decodes the three-field shape", () => {
    expect(
      decode({ appName: "S10N Base", appVersion: "0.0.0", apiBaseUrl: "http://127.0.0.1:4210" }),
    ).toEqual({ appName: "S10N Base", appVersion: "0.0.0", apiBaseUrl: "http://127.0.0.1:4210" });
  });

  it("rejects a value missing a field", () => {
    expect(() => decode({ appName: "S10N Base", appVersion: "0.0.0" })).toThrow();
  });

  it("has exactly the three fields, without the removed desktop and live-stream fields", () => {
    expect(Object.keys(BootstrapConfig.fields).sort()).toEqual([
      "apiBaseUrl",
      "appName",
      "appVersion",
    ]);
  });
});

describe("RpcRequest", () => {
  const decode = Schema.decodeUnknownSync(RpcRequest);

  it("accepts a method and payload", () => {
    expect(decode({ method: "example.get", payload: { id: "1" } })).toEqual({
      method: "example.get",
      payload: { id: "1" },
    });
  });

  it("rejects a non-string method", () => {
    expect(() => decode({ method: 42, payload: {} })).toThrow();
  });

  it("rejects an envelope without a payload key", () => {
    expect(() => decode({ method: "example.get" })).toThrow();
  });

  it("rejects a value that is not an object", () => {
    expect(() => decode("example.get")).toThrow();
  });
});

describe("defineRpc", () => {
  it("returns the method and schemas it was given", () => {
    const payload = Schema.Struct({ id: Schema.String });
    const success = Schema.Struct({ name: Schema.String });

    const contract = defineRpc("example.get", payload, success);

    expect(contract.method).toBe("example.get");
    expect(contract.payload).toBe(payload);
    expect(contract.success).toBe(success);
  });
});

describe("rpcContracts", () => {
  it("has a unique name for every method", () => {
    const methods = rpcContracts.map((contract) => contract.method);

    expect(new Set(methods).size).toBe(methods.length);
  });
});

describe("package exports", () => {
  it("no longer exports the demo domain, activity stream or settings contracts", () => {
    const removed = [
      "DeleteResult",
      "Project",
      "ProjectDetail",
      "Note",
      "StreamMessage",
      "ActivityEntry",
      "AppSettings",
      "RPC_METHODS",
      "EmptyPayload",
      "ProjectsListRpc",
      "SettingsGetRpc",
    ];

    for (const name of removed) {
      expect(contracts).not.toHaveProperty(name);
    }
  });
});
