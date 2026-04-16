import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { startServer } from "./server";

let cleanup: (() => Promise<void>) | null = null;
let s10nBaseHome: string | null = null;
const originalS10nBaseHome = process.env.S10N_BASE_HOME;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  process.env.S10N_BASE_HOME = originalS10nBaseHome;
  if (s10nBaseHome) {
    fs.rmSync(s10nBaseHome, { recursive: true, force: true });
    s10nBaseHome = null;
  }
});

describe("server smoke", () => {
  it("serves health, config, rpc, and websocket activity", async () => {
    s10nBaseHome = fs.mkdtempSync(path.join(os.tmpdir(), "s10n-base-server-test-"));
    process.env.S10N_BASE_HOME = s10nBaseHome;

    const started = await startServer({ port: 0 });
    cleanup = started.stop;
    const baseUrl = `http://${started.config.host}:${started.port}`;

    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    expect(health.ok).toBe(true);

    const config = await fetch(`${baseUrl}/config`).then((response) => response.json());
    expect(config.appName).toBe("S10N Base");

    const events: unknown[] = [];
    const socket = new WebSocket(config.websocketUrl as string);
    await new Promise<void>((resolve) => {
      socket.once("message", (message) => {
        events.push(JSON.parse(message.toString("utf8")));
        resolve();
      });
    });

    const createProject = await fetch(`${baseUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "projects.create",
        payload: {
          name: "S10N Base Project",
          description: "Initial project",
        },
      }),
    }).then((response) => response.json());

    expect(createProject.ok).toBe(true);

    const projects = await fetch(`${baseUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "projects.list",
        payload: {},
      }),
    }).then((response) => response.json());

    expect(events[0]).toMatchObject({ type: "activity.snapshot" });
    expect(projects).toMatchObject({
      ok: true,
      data: {
        projects: [
          expect.objectContaining({
            name: "S10N Base Project",
          }),
        ],
      },
    });
    socket.close();
  });
});
