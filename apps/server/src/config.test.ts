import { afterEach, describe, expect, it } from "vitest";

import { resolveServerConfig } from "./config";

const managedVariables = ["HOST", "PORT", "S10N_BASE_PORT"] as const;
const originalValues = new Map(managedVariables.map((name) => [name, process.env[name]]));

function setEnv(values: Partial<Record<(typeof managedVariables)[number], string | undefined>>) {
  for (const name of managedVariables) {
    const value = values[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

afterEach(() => {
  for (const [name, value] of originalValues) {
    // An originally unset variable must be deleted; assigning undefined would store "undefined".
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("resolveServerConfig", () => {
  it("defaults to 127.0.0.1:4210", () => {
    setEnv({});

    const config = resolveServerConfig();

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(4210);
  });

  it("reads PORT when S10N_BASE_PORT is unset", () => {
    setEnv({ PORT: "5001" });

    expect(resolveServerConfig().port).toBe(5001);
  });

  it("prefers S10N_BASE_PORT over PORT", () => {
    setEnv({ PORT: "5001", S10N_BASE_PORT: "5002" });

    expect(resolveServerConfig().port).toBe(5002);
  });

  it("reads HOST and trims it", () => {
    setEnv({ HOST: " 0.0.0.0 " });

    expect(resolveServerConfig().host).toBe("0.0.0.0");
  });

  it("lets overrides win over the environment", () => {
    setEnv({ HOST: "0.0.0.0", S10N_BASE_PORT: "5002" });

    const config = resolveServerConfig({ host: "localhost", port: 0 });

    expect(config.host).toBe("localhost");
    expect(config.port).toBe(0);
  });

  it("keeps the app name and package version", () => {
    setEnv({});

    const config = resolveServerConfig();

    expect(config.appName).toBe("S10N Base");
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("resolves only the web build directory, with no data, log, database or settings path", () => {
    setEnv({});

    const config = resolveServerConfig();

    expect(Object.keys(config.paths)).toEqual(["webDistDir"]);
    expect(config.paths.webDistDir).toMatch(/apps[/\\]web[/\\]dist$/);
  });

  it("restores an originally unset variable by deleting it", () => {
    // Guards the helper above: the previous server test left the string "undefined" behind.
    for (const name of managedVariables) {
      if (originalValues.get(name) === undefined) {
        expect(process.env[name]).not.toBe("undefined");
      }
    }
  });
});
