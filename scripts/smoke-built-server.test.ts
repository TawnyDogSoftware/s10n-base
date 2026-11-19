import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkHealthBody, runSmoke } from "./smoke-built-server";

const fixtureDir = mkdtempSync(path.join(tmpdir(), "smoke-fixture-"));

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

/** Writes a stand-in for the built server and returns its path. */
function fixture(name: string, source: string): string {
  const file = path.join(fixtureDir, `${name}.mjs`);
  writeFileSync(file, source);
  return file;
}

const healthyServer = fixture(
  "healthy",
  `import http from "node:http";
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(request.url === "/health" ? { ok: true, status: "ok" } : {}));
});
server.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("listening"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
);

describe("checkHealthBody", () => {
  it("accepts the server's health response", () => {
    expect(checkHealthBody('{"ok":true,"status":"ok"}')).toBeUndefined();
  });

  it("rejects anything else", () => {
    expect(checkHealthBody('{"ok":false}')).toBe('expected {"ok":true}, got {"ok":false}');
    expect(checkHealthBody("not json")).toBe("expected JSON, got not json");
  });
});

describe("runSmoke", () => {
  it("passes when the server answers /health and then stops", async () => {
    const result = await runSmoke({ serverEntry: healthyServer, deadlineMs: 10_000 });

    expect(result).toMatchObject({ ok: true });
    expect(result.output).toContain("listening");
  });

  it("fails with the server's output when the server exits early", async () => {
    const crashing = fixture(
      "crashing",
      `console.error("Error [ERR_MODULE_NOT_FOUND]: Cannot find module './base'");
process.exit(1);
`,
    );

    const result = await runSmoke({ serverEntry: crashing, deadlineMs: 10_000 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("the server exited with code 1 before /health answered");
    expect(result.output).toContain("ERR_MODULE_NOT_FOUND");
  });

  it("fails when /health answers with the wrong body", async () => {
    const wrongBody = fixture(
      "wrong-body",
      `import http from "node:http";
const server = http.createServer((_request, response) => response.end('{"ok":false}'));
server.listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
    );

    const result = await runSmoke({ serverEntry: wrongBody, deadlineMs: 10_000 });

    expect(result).toMatchObject({
      ok: false,
      reason: '/health answered 200 but expected {"ok":true}, got {"ok":false}',
    });
  });

  it("fails and stops the server when /health sends headers but never finishes its body", async () => {
    const stalled = fixture(
      "stalled-body",
      `import http from "node:http";
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.flushHeaders();
});
server.listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));
`,
    );

    const result = await runSmoke({ serverEntry: stalled, deadlineMs: 10_000 });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^\/health answered 200 but its body could not be read: /);
  });

  it("fails when the server never answers before the deadline", async () => {
    const silent = fixture(
      "silent",
      `setInterval(() => undefined, 1000);
process.on("SIGTERM", () => process.exit(0));
`,
    );

    const result = await runSmoke({ serverEntry: silent, deadlineMs: 500 });

    expect(result).toMatchObject({ ok: false, reason: "/health did not answer within 500 ms" });
  });
});
