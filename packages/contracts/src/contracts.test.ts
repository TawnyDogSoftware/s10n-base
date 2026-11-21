import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import * as contracts from "./index";
import {
  AppError,
  AppSession,
  AppSessionResponse,
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

describe("AppSession", () => {
  const session = {
    userId: "6f1c2b9e-0000-4000-8000-000000000001",
    email: "user@example.com",
    name: "User",
    image: null,
    role: "user",
    emailVerified: true,
    expiresAt: "2026-11-28T12:00:00.000Z",
  };

  it("has exactly the fields clients rely on", () => {
    expect(
      Object.keys(AppSession.fields).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["email", "emailVerified", "expiresAt", "image", "name", "role", "userId"]);
  });

  it("does not decode a session without its expiry", () => {
    const without = Object.fromEntries(
      Object.entries(session).filter(([field]) => field !== "expiresAt"),
    );

    expect(Schema.decodeUnknownExit(AppSession)(without)._tag).toBe("Failure");
  });

  it("decodes a session and a signed-out response", () => {
    const decode = Schema.decodeUnknownSync(AppSessionResponse);

    expect(decode({ session })).toEqual({ session });
    expect(decode({ session: null })).toEqual({ session: null });
  });

  it("rejects an unknown role", () => {
    expect(() => Schema.decodeUnknownSync(AppSession)({ ...session, role: "owner" })).toThrow(
      'Expected "user" | "admin"\n  at ["role"]',
    );
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
    expect(() => decode({ appName: "S10N Base", appVersion: "0.0.0" })).toThrow(
      'Missing key\n  at ["apiBaseUrl"]',
    );
  });

  it("has exactly the three fields: app name, version and API base URL", () => {
    expect(
      Object.keys(BootstrapConfig.fields).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["apiBaseUrl", "appName", "appVersion"]);
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
    expect(() => decode({ method: 42, payload: {} })).toThrow('Expected string\n  at ["method"]');
  });

  it("rejects an envelope without a payload key", () => {
    expect(() => decode({ method: "example.get" })).toThrow('Missing key\n  at ["payload"]');
  });

  it("rejects a value that is not an object", () => {
    expect(() => decode("example.get")).toThrow("Expected object");
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
});

describe("RpcAuth", () => {
  const decode = Schema.decodeUnknownSync(RpcAuth);

  it("accepts public, session and a role", () => {
    expect(decode("public")).toBe("public");
    expect(decode("session")).toBe("session");
    expect(decode({ role: "admin" })).toEqual({ role: "admin" });
  });

  it("rejects an unknown level or role", () => {
    expect(() => decode("anyone")).toThrow('Expected "public" | "session"');
    expect(() => decode({ role: "owner" })).toThrow('Expected "user" | "admin"\n  at ["role"]');
  });
});

describe("Role", () => {
  it("is user or admin", () => {
    expect(Role.literals).toEqual(["user", "admin"]);
  });
});

describe("ERROR_CODES", () => {
  it("names every error the server answers with", () => {
    expect(ERROR_CODES).toEqual({
      unauthenticated: "auth.unauthenticated",
      forbidden: "auth.forbidden",
      invalidRequest: "rpc.invalid_request",
      invalidPayload: "rpc.invalid_payload",
      invalidCursor: "rpc.invalid_cursor",
      methodNotFound: "rpc.method_not_found",
      notFound: "http.not_found",
      methodNotAllowed: "http.method_not_allowed",
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
