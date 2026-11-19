import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import { localInboxUrl, supervise, type Supervised } from "./dev";

function node(name: string, source: string): Supervised {
  return { name, child: spawn("node", ["-e", source], { stdio: "ignore" }) };
}

const RUN_UNTIL_SIGTERM =
  "setInterval(() => {}, 1000); process.on('SIGTERM', () => process.exit(0));";

describe("localInboxUrl", () => {
  it("is the capture server's page when SES_ENDPOINT is set, and undefined otherwise", () => {
    expect(localInboxUrl({ SES_ENDPOINT: "http://127.0.0.1:8005" })).toBe("http://127.0.0.1:8005/");
    expect(localInboxUrl({ SES_ENDPOINT: "" })).toBeUndefined();
    expect(localInboxUrl({})).toBeUndefined();
  });
});

describe("supervise", () => {
  it("stops every child when interrupted and returns 0", async () => {
    const children = [node("server", RUN_UNTIL_SIGTERM), node("web", RUN_UNTIL_SIGTERM)];

    const code = await supervise(children, new Promise((resolve) => setTimeout(resolve, 300)));

    expect(code).toBe(0);
    for (const { child } of children) expect(child.exitCode ?? child.signalCode).not.toBeNull();
  });

  it("stops the others when one child exits on its own, and returns its code", async () => {
    const web = node("web", RUN_UNTIL_SIGTERM);

    const code = await supervise([node("server", "process.exit(3)"), web], new Promise(() => {}));

    expect(code).toBe(3);
    expect(web.child.exitCode ?? web.child.signalCode).not.toBeNull();
  });

  it("kills a child that ignores SIGTERM after the grace period", async () => {
    const stubborn = node("web", "setInterval(() => {}, 1000); process.on('SIGTERM', () => {});");
    await new Promise((resolve) => setTimeout(resolve, 200));

    const code = await supervise([stubborn], Promise.resolve(), 300);

    expect(code).toBe(0);
    expect(stubborn.child.signalCode).toBe("SIGKILL");
  });
});
