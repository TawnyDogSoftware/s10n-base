import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isInside, resolveStaticFile, sendStaticFile, wantsHtmlFallback } from "./static-files";

let parent: string;
let root: string;

beforeAll(() => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "static-files-test-"));
  root = path.join(parent, "dist");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(root, "assets", "index-abc123.js"), "console.log(1)");
  fs.writeFileSync(path.join(root, "favicon.svg"), "<svg/>");
  fs.writeFileSync(path.join(root, "notes.unknownext"), "?");
  // A sibling whose name starts with the build directory's name.
  fs.mkdirSync(path.join(parent, "dist-evil"));
  fs.writeFileSync(path.join(parent, "dist-evil", "secret.txt"), "secret");
  // A file inside the build whose name starts with two dots.
  fs.writeFileSync(path.join(root, "..config.js"), "inside");
  // A link inside the build to a file outside it.
  fs.symlinkSync(path.join(parent, "dist-evil", "secret.txt"), path.join(root, "linked.txt"));
  // A file the server may not read.
  fs.writeFileSync(path.join(root, "locked.txt"), "locked");
  fs.chmodSync(path.join(root, "locked.txt"), 0o000);
});

/** Resolves `pathname` in the build and closes the file it opened. */
async function resolved(pathname: string) {
  const file = await resolveStaticFile(root, pathname);
  await file?.handle.close();
  return file;
}

afterAll(() => {
  fs.rmSync(parent, { recursive: true, force: true });
});

describe("isInside", () => {
  it("accepts the root's descendants", () => {
    expect(isInside("/srv/dist", "/srv/dist/assets/a.js")).toBe(true);
  });

  it("rejects the root itself, its parent and a sibling sharing its prefix", () => {
    expect(isInside("/srv/dist", "/srv/dist")).toBe(false);
    expect(isInside("/srv/dist", "/srv")).toBe(false);
    expect(isInside("/srv/dist", "/srv/dist-evil/secret.txt")).toBe(false);
    expect(isInside("/srv/dist", "/srv/dist/../dist-evil/secret.txt")).toBe(false);
  });

  it("accepts a descendant whose name starts with two dots", () => {
    expect(isInside("/srv/dist", "/srv/dist/..config.js")).toBe(true);
    expect(isInside("/srv/dist", "/srv/dist/assets/..x/a.js")).toBe(true);
  });
});

describe("resolveStaticFile", () => {
  it("serves index.html for / with no-cache and the HTML type", async () => {
    expect(await resolved("/")).toMatchObject({
      filePath: path.join(root, "index.html"),
      contentType: "text/html; charset=utf-8",
      cacheControl: "no-cache",
      isHtml: true,
    });
  });

  it("caches hashed assets for a year as immutable", async () => {
    expect(await resolved("/assets/index-abc123.js")).toMatchObject({
      contentType: "text/javascript; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable",
      isHtml: false,
      size: 14,
    });
  });

  it("serves a file of a type it does not know as plain bytes", async () => {
    expect((await resolved("/notes.unknownext"))?.contentType).toBe("application/octet-stream");
  });

  it("revalidates other files", async () => {
    expect((await resolved("/favicon.svg"))?.cacheControl).toBe("no-cache");
  });

  it("serves a file whose name starts with two dots", async () => {
    expect((await resolved("/..config.js"))?.size).toBe(6);
  });

  it("answers not found when the file goes away between finding and opening it", async () => {
    const gone = Object.assign(new Error("gone"), { code: "ENOENT" });
    const open = vi.spyOn(fs.promises, "open").mockRejectedValueOnce(gone);
    try {
      expect(await resolved("/favicon.svg")).toBeNull();
    } finally {
      open.mockRestore();
    }
  });

  it("refuses a link inside the build to a file outside it", async () => {
    expect(await resolved("/linked.txt")).toBeNull();
  });

  it("fails, rather than answering not found, on a file it may not read", async () => {
    await expect(resolved("/locked.txt")).rejects.toMatchObject({
      code: "EACCES",
    });
  });

  it.each([
    "/missing.js",
    "/assets",
    "/assets/",
    "/index.html/x",
    "/../dist-evil/secret.txt",
    "/..%2fdist-evil%2fsecret.txt",
    "/%2e%2e%2fdist-evil%2fsecret.txt",
    "/assets/%00.js",
    `/${"a".repeat(300)}.js`,
    "/%E0%A4%A",
  ])("refuses %s", async (pathname) => {
    expect(await resolved(pathname)).toBeNull();
  });
});

describe("wantsHtmlFallback", () => {
  it("is true for a page navigation", () => {
    expect(wantsHtmlFallback("GET", "/settings", "text/html,application/xhtml+xml")).toBe(true);
    expect(wantsHtmlFallback("GET", "/settings", "application/json, Text/HTML;q=0.9")).toBe(true);
  });

  it.each([
    ["POST", "/settings", "text/html"],
    ["GET", "/settings", "application/json"],
    ["GET", "/settings", undefined],
    ["GET", "/rpc/x", "text/html"],
    ["GET", "/api/auth/x", "text/html"],
    ["GET", "/health", "text/html"],
    ["GET", "/ready/x", "text/html"],
    ["GET", "/config", "text/html"],
    ["GET", "/settings", "application/x-text/html-fragment"],
    ["GET", "/settings", "text/html-fragment"],
  ])("is false for %s %s accepting %s", (method, pathname, accept) => {
    expect(wantsHtmlFallback(method, pathname, accept)).toBe(false);
  });
});

/** Serves `pathname` from the build, swapping the file for `replacement` between resolve and send. */
async function fetchWhileReplacing(pathname: string, replacement: string) {
  const server = http.createServer((_request, response) => {
    void (async () => {
      const file = await resolveStaticFile(root, pathname);
      if (file === null) throw new Error("not found");
      // A rebuild replaces the file with a new one of another size.
      const target = path.join(root, pathname);
      fs.writeFileSync(`${target}.next`, replacement);
      fs.renameSync(`${target}.next`, target);
      await sendStaticFile("GET", response, file);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${String(port)}${pathname}`);
    return {
      length: response.headers.get("content-length"),
      body: await response.text(),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Runs `handle` for one request to a server, and resolves once it has finished. */
async function serveOnce(
  handle: (response: http.ServerResponse) => Promise<void>,
  request: (url: string) => Promise<void>,
) {
  let finished: Promise<void> = Promise.resolve();
  const server = http.createServer((_request, response) => {
    finished = handle(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await request(`http://127.0.0.1:${String(port)}/`);
    await finished;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("sendStaticFile", () => {
  it("sends the bytes its Content-Length describes when the file is replaced in between", async () => {
    fs.writeFileSync(path.join(root, "swapped.txt"), "first version");

    const { length, body } = await fetchWhileReplacing("/swapped.txt", "v2");

    expect(body).toBe("first version");
    expect(length).toBe(String(Buffer.byteLength(body)));
  });

  it("closes the file without writing when the client has already gone", async () => {
    let fd: number | undefined;

    await serveOnce(
      async (response) => {
        const file = await resolveStaticFile(root, "/favicon.svg");
        if (file === null) throw new Error("not found");
        response.destroy();
        await sendStaticFile("GET", response, file);
        fd = file.handle.fd;
      },
      (url) =>
        fetch(url).then(
          () => undefined,
          () => undefined,
        ),
    );

    expect(fd).toBe(-1);
  });

  it("closes the file when the client leaves part way through", async () => {
    fs.writeFileSync(path.join(root, "large.bin"), Buffer.alloc(32 * 1024 * 1024));
    let fd: number | undefined;
    let failure: unknown;

    await serveOnce(
      async (response) => {
        const file = await resolveStaticFile(root, "/large.bin");
        if (file === null) throw new Error("not found");
        failure = await sendStaticFile("GET", response, file).catch((error: unknown) => error);
        fd = file.handle.fd;
      },
      async (url) => {
        const controller = new AbortController();
        const response = await fetch(url, { signal: controller.signal });
        const reader = response.body?.getReader();
        await reader?.read();
        controller.abort();
      },
    );

    expect(failure).toBeInstanceOf(Error);
    expect(fd).toBe(-1);
  });

  it("sends the headers only for HEAD, and closes the file", async () => {
    let fd: number | undefined;
    let length: string | null = null;
    let body = "";

    await serveOnce(
      async (response) => {
        const file = await resolveStaticFile(root, "/favicon.svg");
        if (file === null) throw new Error("not found");
        await sendStaticFile("HEAD", response, file);
        fd = file.handle.fd;
      },
      async (url) => {
        const response = await fetch(url, { method: "HEAD" });
        length = response.headers.get("content-length");
        body = await response.text();
      },
    );

    expect([length, body, fd]).toEqual(["6", "", -1]);
  });
});
