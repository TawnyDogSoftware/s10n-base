import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isInside, resolveStaticFile, wantsHtmlFallback } from "./static-files";

let parent: string;
let root: string;

beforeAll(() => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "s10n-static-"));
  root = path.join(parent, "dist");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(root, "assets", "index-abc123.js"), "console.log(1)");
  fs.writeFileSync(path.join(root, "favicon.svg"), "<svg/>");
  // A sibling whose name starts with the build directory's name.
  fs.mkdirSync(path.join(parent, "dist-evil"));
  fs.writeFileSync(path.join(parent, "dist-evil", "secret.txt"), "secret");
});

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
});

describe("resolveStaticFile", () => {
  it("serves index.html for / with no-cache and the HTML type", async () => {
    expect(await resolveStaticFile(root, "/")).toMatchObject({
      filePath: path.join(root, "index.html"),
      contentType: "text/html; charset=utf-8",
      cacheControl: "no-cache",
      isHtml: true,
    });
  });

  it("caches hashed assets for a year as immutable", async () => {
    expect(await resolveStaticFile(root, "/assets/index-abc123.js")).toMatchObject({
      contentType: "text/javascript; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable",
      isHtml: false,
      size: 14,
    });
  });

  it("revalidates other files", async () => {
    expect((await resolveStaticFile(root, "/favicon.svg"))?.cacheControl).toBe("no-cache");
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
    expect(await resolveStaticFile(root, pathname)).toBeNull();
  });
});

describe("wantsHtmlFallback", () => {
  it("is true for a page navigation", () => {
    expect(wantsHtmlFallback("GET", "/settings", "text/html,application/xhtml+xml")).toBe(true);
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
  ])("is false for %s %s accepting %s", (method, pathname, accept) => {
    expect(wantsHtmlFallback(method, pathname, accept)).toBe(false);
  });
});
