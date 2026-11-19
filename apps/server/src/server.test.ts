import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { AppError, BootstrapConfig } from "@s10n-base/contracts";

import { startServer, type StartedServer } from "./server";

let started: StartedServer | null = null;

afterEach(async () => {
  await started?.stop();
  started = null;
});

async function start() {
  started = await startServer({ port: 0 });
  return `http://${started.config.host}:${started.port}`;
}

function postRpc(baseUrl: string, body: string) {
  return fetch(`${baseUrl}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function readError(response: Response) {
  const body = (await response.json()) as { ok: unknown; error: unknown };
  expect(body.ok).toBe(false);
  return Schema.decodeUnknownSync(AppError)(body.error);
}

describe("server", () => {
  it("answers /health", async () => {
    const baseUrl = await start();

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("serves a three-field bootstrap config", async () => {
    const baseUrl = await start();

    const response = await fetch(`${baseUrl}/config`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(Schema.decodeUnknownSync(BootstrapConfig)(body)).toMatchObject({
      appName: "S10N Base",
    });
    // Exactly the three fields: the removed desktop and live-stream fields are gone.
    expect(Object.keys(body).sort()).toEqual(["apiBaseUrl", "appName", "appVersion"]);
  });

  it("returns 404 rpc.method_not_found for an unknown method", async () => {
    const baseUrl = await start();

    const response = await postRpc(
      baseUrl,
      JSON.stringify({ method: "projects.list", payload: {} }),
    );

    expect(response.status).toBe(404);
    expect((await readError(response)).code).toBe("rpc.method_not_found");
  });

  it("returns 400 rpc.invalid_request for a body that is not JSON", async () => {
    const baseUrl = await start();

    const response = await postRpc(baseUrl, "{not json");

    expect(response.status).toBe(400);
    expect(await readError(response)).toEqual({
      code: "rpc.invalid_request",
      message: "The request body is not a valid RPC request.",
    });
  });

  it("returns 400 rpc.invalid_request for a non-string method", async () => {
    const baseUrl = await start();

    const response = await postRpc(baseUrl, JSON.stringify({ method: 42, payload: {} }));

    expect(response.status).toBe(400);
    expect((await readError(response)).code).toBe("rpc.invalid_request");
  });

  it("returns 400 rpc.invalid_request for an empty body", async () => {
    const baseUrl = await start();

    const response = await postRpc(baseUrl, "");

    expect(response.status).toBe(400);
    expect((await readError(response)).code).toBe("rpc.invalid_request");
  });

  it("stops accepting connections once stop() resolves", async () => {
    const baseUrl = await start();
    const server = started;
    started = null;

    await expect(server?.stop()).resolves.toBeUndefined();

    await expect(fetch(`${baseUrl}/health`)).rejects.toThrow();
  });

  it("creates no file when it starts and stops", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "s10n-base-server-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    try {
      expect(os.homedir()).toBe(home);

      const server = await startServer({ port: 0 });
      await fetch(`http://${server.config.host}:${server.port}/health`);
      await server.stop();

      expect(fs.readdirSync(home)).toEqual([]);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
