import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import * as contracts from "./index";
import {
  AppError,
  BootstrapConfig,
  ERROR_CODES,
  Role,
  RpcAuth,
  RpcRequest,
  defineRpc,
  rpcContracts,
} from "./index";

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
  it("returns the method, auth level and schemas it was given", () => {
    const payload = Schema.Struct({ id: Schema.String });
    const success = Schema.Struct({ name: Schema.String });

    const contract = defineRpc({ method: "example.get", auth: "session", payload, success });

    expect(contract).toEqual({ method: "example.get", auth: "session", payload, success });
  });

  it("keeps the encoded and decoded types of each schema apart", () => {
    // NumberFromString decodes "1" to 1 and encodes 1 to "1", so the two types differ.
    const contract = defineRpc({
      method: "example.count",
      auth: "public",
      payload: Schema.Struct({ n: Schema.NumberFromString }),
      success: Schema.NumberFromString,
    });

    const decoded: { readonly n: number } = Schema.decodeUnknownSync(contract.payload)({ n: "1" });
    const encoded: string = Schema.encodeSync(contract.success)(2);

    expect(decoded).toEqual({ n: 1 });
    expect(encoded).toBe("2");
  });

  it("requires an auth level", () => {
    // @ts-expect-error auth is required: there is no default level.
    defineRpc({
      method: "example.none",
      payload: Schema.Struct({}),
      success: Schema.Struct({}),
    });
  });
});

describe("RpcAuth", () => {
  const decode = Schema.decodeUnknownSync(RpcAuth);

  it("accepts public, session and a role", () => {
    expect(decode("public")).toBe("public");
    expect(decode("session")).toBe("session");
    expect(decode({ role: "admin" })).toEqual({ role: "admin" });
  });

  it("rejects an unknown level or role", () => {
    expect(() => decode("anyone")).toThrow();
    expect(() => decode({ role: "owner" })).toThrow();
  });
});

describe("Role", () => {
  it("is user or admin", () => {
    expect(Role.literals).toEqual(["user", "admin"]);
  });
});

describe("ERROR_CODES", () => {
  it("names every error the RPC layer and auth checks answer with", () => {
    expect(ERROR_CODES).toEqual({
      unauthenticated: "auth.unauthenticated",
      forbidden: "auth.forbidden",
      invalidRequest: "rpc.invalid_request",
      invalidPayload: "rpc.invalid_payload",
      methodNotFound: "rpc.method_not_found",
      unexpected: "server.unexpected_error",
    });
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
