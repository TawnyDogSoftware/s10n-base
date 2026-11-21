import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

import { describe, expect, it } from "vitest";

const BIN = path.join(import.meta.dirname, "bin.ts");

async function runBin(env: Record<string, string>) {
  // bun runs the TypeScript source directly; the built entry is covered by `bun run smoke`.
  const child = spawn("bun", [BIN], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const [code] = (await once(child, "exit")) as [number | null];
  return { code, stdout, stderr };
}

describe("bin", () => {
  it("prints one line naming every bad variable, never the database password, and exits 1", async () => {
    const result = await runBin({
      APP_URL: "not-a-url",
      PORT: "99999",
      LOG_LEVEL: "loud",
      DATABASE_URL: "mysql://app:hunter2-secret@db/app",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "") as { message: string; error: { message: string } };
    expect(entry.message).toBe("startup_failed");
    for (const name of ["APP_URL", "PORT", "LOG_LEVEL", "DATABASE_URL"]) {
      expect(entry.error.message).toContain(name);
    }
    expect(result.stdout).not.toContain("hunter2-secret");
  }, 20_000);
});
