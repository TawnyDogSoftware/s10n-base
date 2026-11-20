/**
 * The web app's Vite config, loaded as Vite loads it: where the dev server listens, given where
 * the browser reaches it (APP_URL).
 */
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const keys = ["APP_URL", "WEB_DEV_HOST", "WEB_DEV_PORT", "VITE_API_BASE_URL"] as const;

/** Read through a variable, so the scripts' type check does not compile the web app's config. */
const CONFIG = path.resolve(import.meta.dirname, "../apps/web/vite.config.ts");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function devServerWith(env: Partial<Record<(typeof keys)[number], string>>) {
  for (const key of keys) vi.stubEnv(key, env[key]);
  vi.resetModules();
  const { default: config } = (await import(CONFIG)) as {
    default: { server: { host: string; port: number; allowedHosts?: readonly string[] } };
  };
  return config.server;
}

describe("the web app's dev server", () => {
  it("listens on APP_URL's host and port when APP_URL is the computer's own http address", async () => {
    expect(await devServerWith({ APP_URL: "http://localhost:5173" })).toMatchObject({
      host: "localhost",
      port: 5173,
    });
    expect(await devServerWith({ APP_URL: "http://laptop.example.com:5173" })).toMatchObject({
      host: "laptop.example.com",
      port: 5173,
    });
  });

  it("listens on 127.0.0.1:5173 behind an https forwarder, and answers the forwarder's name", async () => {
    // A private network serves https://computer-name:8445 and forwards to the dev server
    // (docs/mobile-dev.md). Vite cannot bind that name or port, and must accept it as a host.
    const server = await devServerWith({ APP_URL: "https://computer-name:8445" });

    expect(server).toMatchObject({ host: "127.0.0.1", port: 5173 });
    expect(server.allowedHosts).toContain("computer-name");
  });

  it("listens where WEB_DEV_HOST and WEB_DEV_PORT say", async () => {
    expect(
      await devServerWith({
        APP_URL: "https://computer-name:8445",
        WEB_DEV_HOST: "0.0.0.0",
        WEB_DEV_PORT: "5180",
      }),
    ).toMatchObject({ host: "0.0.0.0", port: 5180 });
  });
});
