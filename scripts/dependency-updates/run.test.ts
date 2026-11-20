import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import type { FlowOptions, FlowOutcome, runDependencyUpdate } from "./flow";
import { parseArgs, ProcessIo, requestHeaders, updateCommand } from "./run";

describe("parseArgs", () => {
  it("defaults to a real run from main", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, from: undefined });
  });

  it("reads --dry-run and --from", () => {
    expect(parseArgs(["--dry-run", "--from", "HEAD"])).toEqual({ dryRun: true, from: "HEAD" });
  });

  it("rejects --from without a ref and unknown arguments", () => {
    expect(() => parseArgs(["--from"])).toThrow("--from needs a git ref");
    expect(() => parseArgs(["--from", "--dry-run"])).toThrow("--from needs a git ref");
    expect(() => parseArgs(["--push"])).toThrow("Unknown argument: --push");
  });
});

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "deps-run-"));
  roots.push(dir);
  return dir;
}

describe("requestHeaders", () => {
  it("names the script, and sends the token only to GitHub's API", () => {
    expect(requestHeaders("https://registry.npmjs.org/x", "t")).toEqual({
      "User-Agent": "dependency-updates-script",
    });
    expect(requestHeaders("https://api.github.com/repos/o/r", "t")).toEqual({
      "User-Agent": "dependency-updates-script",
      Authorization: "Bearer t",
    });
    expect(requestHeaders("https://api.github.com/repos/o/r", "")).not.toHaveProperty(
      "Authorization",
    );
    expect(requestHeaders("https://api.github.com/repos/o/r", undefined)).not.toHaveProperty(
      "Authorization",
    );
  });
});

describe("ProcessIo", () => {
  it("runs a command in a directory under its root, with input, and prints it first", async () => {
    const root = tempDir();
    mkdirSync(path.join(root, "sub"));
    const lines: string[] = [];
    const io = new ProcessIo(root, undefined, (line) => lines.push(line));

    const result = await io.run(
      "node",
      ["-e", "process.stdin.pipe(process.stdout); console.error(process.cwd())"],
      { cwd: "sub", input: "hello" },
    );

    expect(result).toEqual({ code: 0, stdout: "hello", stderr: `${path.join(root, "sub")}\n` });
    expect(lines[0]).toMatch(/^\$ node -e /);
  });

  it("reports the exit code of a command that exits without reading its input", async () => {
    // Its end of the pipe closes first, so writing the input fails with EPIPE. That is the
    // command's choice, not an error of the run: before, it surfaced as an uncaught exception.
    const io = new ProcessIo(tempDir(), undefined, () => {});

    for (const options of [{}, { input: "x".repeat(4 * 1024 * 1024) }]) {
      const result = await io.run("node", ["-e", "process.exit(3)"], options);
      expect(result.code).toBe(3);
    }
  });

  it("reports a command a signal ended as a failure, and rejects one that cannot start", async () => {
    const io = new ProcessIo(tempDir(), undefined, () => {});

    expect((await io.run("node", ["-e", "process.kill(process.pid, 'SIGKILL')"])).code).toBe(1);
    await expect(io.run("no-such-command-anywhere", [])).rejects.toThrow("ENOENT");
  });

  it("reads, writes and finds files under its root", async () => {
    const root = tempDir();
    mkdirSync(path.join(root, "apps/web"), { recursive: true });
    mkdirSync(path.join(root, "apps/empty"), { recursive: true });
    writeFileSync(path.join(root, "apps/notes.txt"), "not a directory");
    const io = new ProcessIo(root, undefined, () => {});

    await io.writeFile("apps/web/package.json", "{}");

    expect(await io.readFile("apps/web/package.json")).toBe("{}");
    expect(await io.exists("apps/web/package.json")).toBe(true);
    expect(await io.exists("apps/empty/package.json")).toBe(false);
    expect(await io.glob("apps/*/package.json")).toEqual(["apps/web/package.json"]);
    expect(await io.glob("missing/*/package.json")).toEqual([]);
    expect(await io.glob("apps/web/package.json")).toEqual(["apps/web/package.json"]);
    expect(await io.glob("apps/none.json")).toEqual([]);
  });

  it("fetches JSON, and fails on an error status", async () => {
    const server = http.createServer((request, response) => {
      response.statusCode = request.url === "/ok" ? 200 : 404;
      response.end(JSON.stringify({ url: request.url, agent: request.headers["user-agent"] }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const lines: string[] = [];
    const io = new ProcessIo(tempDir(), "token", (line) => lines.push(line));
    try {
      expect(await io.fetchJson(`${base}/ok`)).toEqual({
        url: "/ok",
        agent: "dependency-updates-script",
      });
      await expect(io.fetchJson(`${base}/missing`)).rejects.toThrow(
        `GET ${base}/missing answered 404`,
      );
      io.log("a line");
      expect(lines).toEqual(["a line"]);
    } finally {
      server.close();
    }
  });
});

describe("ProcessIo.fetchHeaders", () => {
  it("sends a HEAD request with the given headers, returns the response headers, and fails on an error status", async () => {
    const seen: Array<{ method: string | undefined; accept: string | undefined }> = [];
    const server = http.createServer((request, response) => {
      seen.push({ method: request.method, accept: request.headers.accept });
      response.statusCode = request.url === "/ok" ? 200 : 401;
      response.setHeader("Docker-Content-Digest", "sha256:abc");
      response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const io = new ProcessIo(tempDir(), undefined, () => {});
    try {
      const headers = await io.fetchHeaders(`${base}/ok`, { Accept: "application/json" });
      expect(headers["docker-content-digest"]).toBe("sha256:abc");
      expect(seen).toEqual([{ method: "HEAD", accept: "application/json" }]);
      await expect(io.fetchHeaders(`${base}/denied`, {})).rejects.toThrow(
        `HEAD ${base}/denied answered 401`,
      );
    } finally {
      server.close();
    }
  });
});

/** A git repository with one commit, to make the dry run's worktree from. */
function repository(): string {
  const root = tempDir();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "--quiet");
  writeFileSync(path.join(root, "package.json"), "{}\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--quiet", "-m", "start");
  return root;
}

function commandIo(repoRoot: string, outcome: FlowOutcome, env: Record<string, string> = {}) {
  const lines: string[] = [];
  const seen: Array<{ root: string; options: FlowOptions }> = [];
  const flow = vi.fn<typeof runDependencyUpdate>(async (io, options) => {
    seen.push({ root: (await io.readFile("package.json")) === "{}\n" ? "repo" : "?", options });
    return outcome;
  });
  return {
    lines,
    seen,
    flow,
    io: {
      repoRoot,
      env,
      now: new Date("2026-11-19T00:00:00Z"),
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(`! ${line}`),
      flow,
    },
  };
}

describe("updateCommand", () => {
  const opened: FlowOutcome = {
    kind: "opened",
    branch: "deps/update-2026-11-19",
    url: "https://example.com/pr/9",
    body: "",
  };

  it("runs in the checkout and reports the PR, with the bot's author", async () => {
    const run = commandIo(repository(), opened, {
      DEPS_UPDATE_GIT_NAME: "bot",
      DEPS_UPDATE_GIT_EMAIL: "bot@example.com",
    });

    expect(await updateCommand([], run.io)).toBe(0);
    expect(run.lines).toEqual(["opened: https://example.com/pr/9"]);
    expect(run.seen[0]?.options).toMatchObject({
      dryRun: false,
      author: { name: "bot", email: "bot@example.com" },
    });
    expect(run.seen[0]?.options).not.toHaveProperty("startRef");
  });

  it("says when no PR is needed", async () => {
    const run = commandIo(
      repository(),
      { kind: "unchanged" },
      {
        DEPS_UPDATE_GIT_NAME: "bot",
        DEPS_UPDATE_GIT_EMAIL: "bot@example.com",
      },
    );

    await updateCommand([], run.io);

    expect(run.lines).toEqual(["No update PR needed."]);
  });

  it("refuses a real run without the bot's name and email", async () => {
    const run = commandIo(repository(), opened);

    expect(await updateCommand([], run.io)).toBe(1);
    expect(run.lines).toEqual([
      "! Set DEPS_UPDATE_GIT_NAME and DEPS_UPDATE_GIT_EMAIL, or pass --dry-run.",
    ]);
    expect(run.flow).not.toHaveBeenCalled();
  });

  it("does a dry run in a temporary worktree from a ref, and removes the worktree", async () => {
    const repo = repository();
    const run = commandIo(repo, opened);

    expect(await updateCommand(["--dry-run", "--from", "HEAD"], run.io)).toBe(0);
    expect(run.seen[0]?.options).toMatchObject({
      dryRun: true,
      startRef: "HEAD",
      author: { name: "dependency-updates dry run", email: "dry-run@localhost.invalid" },
    });
    expect(run.lines).toContain("Dry run: would have opened deps/update-2026-11-19.");
    expect(
      execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" }).trim().split("\n"),
    ).toHaveLength(1);
  });

  it("reports an unchanged dry run", async () => {
    const run = commandIo(repository(), { kind: "unchanged" });

    await updateCommand(["--dry-run"], run.io);

    expect(run.lines).toContain("Dry run: no update PR needed.");
  });

  it("fails when git cannot make the worktree", async () => {
    const run = commandIo(tempDir(), opened);

    expect(await updateCommand(["--dry-run"], run.io)).toBe(1);
    const failure = /^! git worktree add --detach (.*) HEAD failed: /.exec(run.lines.at(-1) ?? "");
    expect(failure).not.toBeNull();
    // The temporary directory made for the worktree is removed too, not left behind empty.
    expect(existsSync(failure?.[1] ?? "")).toBe(false);
  });
});
