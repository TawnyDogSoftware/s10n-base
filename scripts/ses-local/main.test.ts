import { describe, expect, it } from "vitest";

import { listenAddress } from "./main";

describe("listenAddress", () => {
  it("reads the host and port from SES_ENDPOINT", () => {
    expect(listenAddress("http://127.0.0.1:8005")).toEqual({ host: "127.0.0.1", port: 8005 });
    expect(listenAddress("http://[::1]:8005")).toEqual({ host: "::1", port: 8005 });
  });

  it.each([undefined, "", "https://127.0.0.1:8005", "http://127.0.0.1", "nonsense"])(
    "refuses %j",
    (value) => {
      expect(() => listenAddress(value)).toThrow(/SES_ENDPOINT/);
    },
  );
});
