import { describe, expect, it } from "vitest";

import { errorMessageKey } from "./messages";
import { DecodeError, NetworkError, RpcError } from "./transport";

describe("errorMessageKey", () => {
  it("maps each kind of failure to an errors key", () => {
    expect(errorMessageKey({ ok: false, code: "INVALID_TOKEN", status: 400 })).toBe(
      "betterAuth.INVALID_TOKEN",
    );
    expect(errorMessageKey({ ok: false, code: "INVALID_NAME", status: 400 })).toBe(
      "betterAuth.INVALID_NAME",
    );
    expect(errorMessageKey({ ok: false, code: "RATE_LIMITED", status: 429 })).toBe("rateLimited");
    expect(errorMessageKey({ ok: false, code: "SOMETHING_NEW", status: 400 })).toBe("generic");
    expect(errorMessageKey(new RpcError("rpc.invalid_payload", "x", 400))).toBe(
      "rpc.invalid_payload",
    );
    expect(errorMessageKey(new RpcError("made.up", "x", 400))).toBe("generic");
    expect(errorMessageKey(new NetworkError("x"))).toBe("network");
    expect(errorMessageKey(new DecodeError("x"))).toBe("generic");
    expect(errorMessageKey(new Error("x"))).toBe("generic");
    expect(errorMessageKey("thrown string")).toBe("generic");
  });
});
