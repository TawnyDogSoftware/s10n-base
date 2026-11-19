import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  type Acceptance,
  type Advisory,
  advisoryId,
  auditProblems,
  parseTriage,
  runBunAudit,
  runDependencyAudit,
} from "./dependency-audit";

// The shape `bun audit --json` printed for minimatch 10.0.0 on bun 1.4.4.
const advisory: Advisory = {
  url: "https://github.com/advisories/GHSA-g3hv-75wg-m249",
  title: "minimatch has potential denial of service via globparts amplification",
  severity: "moderate",
  vulnerable_versions: ">=7.0.0 <11.0.1",
};

const accepted: Acceptance = {
  id: "GHSA-g3hv-75wg-m249",
  package: "minimatch",
  reason: "Reached only through a build tool that never matches user input.",
  expires: "2026-12-31",
};

describe("advisoryId", () => {
  it("is the GHSA id in the URL, or the URL when there is none", () => {
    expect(advisoryId(advisory)).toBe("GHSA-g3hv-75wg-m249");
    expect(advisoryId({ ...advisory, url: "https://example.com/advisory/1" })).toBe(
      "https://example.com/advisory/1",
    );
  });
});

describe("auditProblems", () => {
  it("passes a clean audit with an empty triage, and an accepted advisory before its expiry", () => {
    expect(auditProblems({}, [], "2026-11-19")).toEqual([]);
    expect(auditProblems({ minimatch: [advisory] }, [accepted], "2026-11-19")).toEqual([]);
  });

  it("fails an advisory nobody accepted, naming it", () => {
    expect(auditProblems({ minimatch: [advisory] }, [], "2026-11-19")).toEqual([
      "not triaged: minimatch GHSA-g3hv-75wg-m249 (moderate, >=7.0.0 <11.0.1): minimatch has potential denial of service via globparts amplification",
    ]);
  });

  it("fails an acceptance on and after its expiry date", () => {
    expect(auditProblems({ minimatch: [advisory] }, [accepted], "2026-12-31")[0]).toMatch(
      /^acceptance expired on 2026-12-31: minimatch GHSA-g3hv-75wg-m249/,
    );
  });

  it("fails an acceptance for another package, and one that no longer matches anything", () => {
    expect(auditProblems({}, [accepted], "2026-11-19")).toEqual([
      "no longer reported, so remove it from the triage: minimatch GHSA-g3hv-75wg-m249",
    ]);
    expect(
      auditProblems(
        { minimatch: [advisory] },
        [{ ...accepted, package: "brace-expansion" }],
        "2026-11-19",
      ),
    ).toHaveLength(2);
  });
});

describe("parseTriage", () => {
  it("reads complete acceptances", () => {
    expect(parseTriage({ accepted: [accepted] })).toEqual([accepted]);
  });

  it.each([
    [{}, "dependency-audit-triage.json needs an accepted list"],
    [{ accepted: ["x"] }, "entry 1 must be an object"],
    [
      { accepted: [{ ...accepted, id: "1130591" }] },
      "entry 1 needs an id such as GHSA-xxxx-xxxx-xxxx",
    ],
    [{ accepted: [{ ...accepted, package: "" }] }, "entry 1 needs a package"],
    [{ accepted: [{ ...accepted, reason: " " }] }, "entry 1 needs a reason"],
    [
      { accepted: [{ ...accepted, expires: "next year" }] },
      "entry 1 needs an expiry date (YYYY-MM-DD)",
    ],
  ])("refuses %j", (json, message) => {
    expect(() => parseTriage(json)).toThrow(message);
  });
});

function run(root: string, stdout: string) {
  const lines: string[] = [];
  const code = runDependencyAudit(
    root,
    "2026-11-19",
    (line) => lines.push(line),
    () => ({
      status: stdout === "{}" ? 0 : 1,
      stdout,
      stderr: "",
    }),
  );
  return { code, lines };
}

describe("runDependencyAudit", () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function repo(triage: unknown): string {
    const root = mkdtempSync(path.join(tmpdir(), "audit-"));
    roots.push(root);
    writeFileSync(path.join(root, "dependency-audit-triage.json"), JSON.stringify(triage));
    return root;
  }

  it("passes a clean audit", () => {
    expect(run(repo({ accepted: [] }), "{}")).toEqual({
      code: 0,
      lines: ["bun audit reports no advisory."],
    });
  });

  it("passes when every advisory is accepted, and says how many", () => {
    expect(run(repo({ accepted: [accepted] }), JSON.stringify({ minimatch: [advisory] }))).toEqual({
      code: 0,
      lines: ["bun audit reports 1 advisories, each accepted in the triage file."],
    });
  });

  it("fails and lists each problem", () => {
    const result = run(repo({ accepted: [] }), JSON.stringify({ minimatch: [advisory] }));

    expect(result.code).toBe(1);
    expect(result.lines[0]).toMatch(/^not triaged: minimatch/);
  });

  it("fails when the audit command does not print JSON", () => {
    const lines: string[] = [];

    const code = runDependencyAudit(
      repo({ accepted: [] }),
      "2026-11-19",
      (line) => lines.push(line),
      (root) => runBunAudit(root, "node"),
    );

    expect(code).toBe(1);
    expect(lines[0]).toMatch(/^bun audit did not print JSON \(exit 1\): /);
  });
});

describe("dependency-audit-triage.json", () => {
  it("is a valid triage file", () => {
    const json = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "../../dependency-audit-triage.json"), "utf8"),
    ) as unknown;

    expect(() => parseTriage(json)).not.toThrow();
  });
});
