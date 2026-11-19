import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixtureSchema, type FixtureSchema } from "../../test/live-database";

const CODEGEN = path.resolve(import.meta.dirname, "../../../node_modules/.bin/kysely-codegen");

let fixture: FixtureSchema;
let outDir: string;

beforeEach(async () => {
  fixture = await createFixtureSchema();
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "s10n-codegen-"));
});

afterEach(async () => {
  await fixture.drop();
  fs.rmSync(outDir, { recursive: true, force: true });
});

/** Runs kysely-codegen with the options `db:generate` uses, pointed at the fixture schema. */
async function codegen(outFile: string, extra: string[] = []) {
  const child = spawn(
    CODEGEN,
    [
      "--dialect",
      "postgres",
      "--url",
      fixture.url,
      "--default-schema",
      fixture.schema,
      "--include-pattern",
      `${fixture.schema}.*`,
      "--out-file",
      outFile,
      ...extra,
    ],
    { cwd: outDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  const [code] = (await once(child, "exit")) as [number | null];
  return { code, output };
}

describe("kysely-codegen against Postgres", () => {
  it("generates a table's types, and --verify fails once the schema changes", async () => {
    await fixture.admin.query(
      `create table "${fixture.schema}".widget (
         id integer primary key,
         name text not null,
         created_at timestamptz not null default now()
       )`,
    );
    const outFile = path.join(outDir, "db.ts");

    expect((await codegen(outFile)).code).toBe(0);
    const generated = fs.readFileSync(outFile, "utf8");
    expect(generated).toContain("export interface Widget {");
    expect(generated).toMatch(/createdAt|created_at: Generated<Timestamp>/);
    expect(generated).toContain("name: string;");
    expect(generated).toMatch(/export interface DB \{\s+widget: Widget;\s+\}/);
    expect(generated).not.toContain("kysely_migration");

    expect((await codegen(outFile, ["--verify"])).code).toBe(0);

    await fixture.admin.query(`alter table "${fixture.schema}".widget add column note text`);
    const stale = await codegen(outFile, ["--verify"]);
    expect(stale.code).not.toBe(0);
  });
});
