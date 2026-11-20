import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkHealthBody, runSmoke, smokeCommand } from "./smoke-built-server";

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
  const ok = request.url === "/health" || request.url === "/ready";
  response.statusCode = ok ? 200 : 404;
  response.end(JSON.stringify(ok ? { ok: true, status: "ok" } : {}));
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
  it("passes when the server answers /health and /ready and exits 0 on SIGTERM", async () => {
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

  it("fails at once, naming the error, when node cannot be spawned", async () => {
    const started = Date.now();

    const result = await runSmoke({
      serverEntry: healthyServer,
      deadlineMs: 10_000,
      env: { PATH: path.join(fixtureDir, "no-such-dir") },
    });

    expect(result).toEqual({
      ok: false,
      reason: "the server could not start: spawn node ENOENT",
      output: "",
    });
    expect(Date.now() - started).toBeLessThan(5_000);
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

  it("fails when /ready does not answer 200", async () => {
    const notReady = fixture(
      "not-ready",
      `import http from "node:http";
const server = http.createServer((request, response) => {
  response.statusCode = request.url === "/health" ? 200 : 503;
  response.end(request.url === "/health" ? '{"ok":true}' : '{"ok":false,"status":"database_unavailable"}');
});
server.listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
    );

    const result = await runSmoke({ serverEntry: notReady, deadlineMs: 10_000 });

    expect(result).toMatchObject({
      ok: false,
      reason: '/ready answered 503: {"ok":false,"status":"database_unavailable"}',
    });
  });

  it("passes the database settings and its own APP_URL, PORT and deadline to the server", async () => {
    const echo = fixture(
      "echo-env",
      `import http from "node:http";
const server = http.createServer((_request, response) => response.end('{"ok":true}'));
server.listen(Number(process.env.PORT), "127.0.0.1", () =>
  console.log(JSON.stringify({ app: process.env.APP_URL, db: process.env.DATABASE_URL, deadline: process.env.SHUTDOWN_TIMEOUT_MS, port: process.env.PORT })),
);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
    );

    const result = await runSmoke({
      serverEntry: echo,
      deadlineMs: 10_000,
      shutdownDeadlineMs: 3000,
      env: { DATABASE_URL: "postgres://u:p@h/db" },
    });

    expect(result.ok).toBe(true);
    const seen = JSON.parse(result.output.trim().split("\n")[0] ?? "") as Record<string, string>;
    expect(seen).toEqual({
      app: `http://127.0.0.1:${String(seen.port)}`,
      db: "postgres://u:p@h/db",
      deadline: "3000",
      port: seen.port,
    });
  });

  it("fails when the server exits with a non-zero code after SIGTERM", async () => {
    const forced = fixture(
      "forced-exit",
      `import http from "node:http";
const server = http.createServer((_request, response) => response.end('{"ok":true}'));
server.listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => process.exit(1));
`,
    );

    const result = await runSmoke({ serverEntry: forced, deadlineMs: 10_000 });

    expect(result).toMatchObject({
      ok: false,
      reason: "the server exited with code 1 after SIGTERM, not 0",
    });
  });

  it("fails and kills the server when it ignores SIGTERM past its deadline", async () => {
    const stubborn = fixture(
      "ignores-sigterm",
      `import http from "node:http";
const server = http.createServer((_request, response) => response.end('{"ok":true}'));
server.listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => {});
`,
    );

    const result = await runSmoke({
      serverEntry: stubborn,
      deadlineMs: 10_000,
      shutdownDeadlineMs: 200,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "the server did not exit within 200 ms of SIGTERM",
    });
  }, 10_000);

  it("fails when a web build exists but the server does not serve it at /", async () => {
    const noWebApp = fixture(
      "no-web-app",
      `import http from "node:http";
const server = http.createServer((request, response) => {
  const api = request.url === "/health" || request.url === "/ready";
  response.statusCode = api ? 200 : 404;
  response.setHeader("Content-Type", api ? "application/json" : "text/plain; charset=utf-8");
  response.end(api ? '{"ok":true}' : "Not Found");
});
server.listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
    );

    const result = await runSmoke({
      serverEntry: noWebApp,
      deadlineMs: 10_000,
      expectWebApp: true,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "/ answered 404 text/plain, not the web app's HTML",
    });
  });

  it("passes when the server serves the web app's HTML at /", async () => {
    const withWebApp = fixture(
      "with-web-app",
      `import http from "node:http";
const server = http.createServer((request, response) => {
  if (request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end("<!doctype html>");
    return;
  }
  response.end('{"ok":true}');
});
server.listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
    );

    const result = await runSmoke({
      serverEntry: withWebApp,
      deadlineMs: 10_000,
      expectWebApp: true,
    });

    expect(result.ok).toBe(true);
  });
});

/** A server that answers each path with `answers[path]`, written as code. */
function serverAnswering(name: string, answers: Record<string, string>): string {
  const branches = Object.entries(answers)
    .map(([url, code]) => `if (request.url === ${JSON.stringify(url)}) { ${code}; return; }`)
    .join("\n  ");
  return fixture(
    name,
    `import http from "node:http";
const server = http.createServer((request, response) => {
  ${branches}
  response.statusCode = 404;
  response.end();
});
server.listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
  );
}

const OK = `response.setHeader("content-type", "application/json"); response.end('{"ok":true}')`;

describe("runSmoke's other failures", () => {
  it("fails when /health answers another status", async () => {
    const entry = serverAnswering("health-503", {
      "/health": `response.statusCode = 503; response.end("starting")`,
    });

    expect(await runSmoke({ serverEntry: entry, deadlineMs: 10_000 })).toMatchObject({
      ok: false,
      reason: "/health answered 503: starting",
    });
  });

  it("fails when the server is gone by the time /ready is asked", async () => {
    const entry = serverAnswering("gone-before-ready", {
      "/health": `${OK}; server.close(); server.closeAllConnections()`,
    });

    const result = await runSmoke({ serverEntry: entry, deadlineMs: 10_000 });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^\/ready did not answer: /);
  });

  it("fails when /ready's body never arrives", async () => {
    const entry = serverAnswering("ready-body-lost", {
      "/health": OK,
      "/ready": `response.statusCode = 503; response.flushHeaders(); response.destroy()`,
    });

    expect(await runSmoke({ serverEntry: entry, deadlineMs: 10_000 })).toMatchObject({
      ok: false,
      reason: "/ready answered 503: (body could not be read)",
    });
  });

  it("fails when /ready answers 200 with the wrong body", async () => {
    const entry = serverAnswering("ready-wrong-body", {
      "/health": OK,
      "/ready": `response.end('{"ok":false}')`,
    });

    expect(await runSmoke({ serverEntry: entry, deadlineMs: 10_000 })).toMatchObject({
      ok: false,
      reason: '/ready answered 200 but expected {"ok":true}, got {"ok":false}',
    });
  });

  it("fails when / cannot be reached for the web app", async () => {
    const entry = serverAnswering("gone-before-web", {
      "/health": OK,
      "/ready": `${OK}; server.close(); server.closeAllConnections()`,
    });

    const result = await runSmoke({ serverEntry: entry, deadlineMs: 10_000, expectWebApp: true });

    expect(result.reason).toMatch(/^\/ did not answer: /);
  });

  it("names a missing content type when / answers without one", async () => {
    const entry = serverAnswering("web-untyped", {
      "/health": OK,
      "/ready": OK,
      "/": `response.end("<html>")`,
    });

    const result = await runSmoke({ serverEntry: entry, deadlineMs: 10_000, expectWebApp: true });

    expect(result.reason).toBe("/ answered 200 (no type), not the web app's HTML");
  });
});

/** A repo root whose built server is `source`, with or without a built web app. */
function root(source: string, webBuilt: boolean): string {
  const dir = mkdtempSync(path.join(fixtureDir, "root-"));
  mkdirSync(path.join(dir, "apps/server/dist"), { recursive: true });
  writeFileSync(path.join(dir, "apps/server/dist/bin.mjs"), source);
  if (webBuilt) {
    mkdirSync(path.join(dir, "apps/web/dist"), { recursive: true });
    writeFileSync(path.join(dir, "apps/web/dist/index.html"), "<!doctype html>");
  }
  return dir;
}

function capture() {
  const lines: string[] = [];
  return {
    lines,
    out: {
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(`! ${line}`),
    },
  };
}

describe("smokeCommand", () => {
  it("reports a pass, and says when it also checked the web app", async () => {
    const html = readFileSync(
      serverAnswering("serves-html", {
        "/health": OK,
        "/ready": OK,
        "/": `response.setHeader("content-type", "text/html"); response.end("<html>")`,
      }),
      "utf8",
    );
    const withWeb = root(html, true);
    const { lines, out } = capture();

    expect(await smokeCommand(withWeb, { SHUTDOWN_TIMEOUT_MS: "3000" }, out)).toBe(0);
    expect(lines).toEqual([
      `Smoke test passed: ${path.join(withWeb, "apps/server/dist/bin.mjs")} answered /health and /ready, served the web app and exited 0 on SIGTERM.`,
    ]);

    const plain = capture();
    expect(
      await smokeCommand(root(readFileSync(healthyServer, "utf8"), false), {}, plain.out),
    ).toBe(0);
    expect(plain.lines[0]).toMatch(/answered \/health and \/ready and exited 0 on SIGTERM\.$/);
  });

  it("reports a failure with the server's output, or says there was none", async () => {
    const noisy = capture();
    expect(
      await smokeCommand(root('console.error("boom"); process.exit(2);', false), {}, noisy.out),
    ).toBe(1);
    expect(noisy.lines).toEqual([
      "! Smoke test failed: the server exited with code 2 before /health answered",
      "! Server output:",
      "! boom\n",
    ]);

    const quiet = capture();
    expect(await smokeCommand(root("process.exit(3);", false), {}, quiet.out)).toBe(1);
    expect(quiet.lines.at(-1)).toBe("! (none)");
  });
});
