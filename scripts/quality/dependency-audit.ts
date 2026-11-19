/**
 * The audit gate (`bun run deps:audit`): `bun audit` against dependency-audit-triage.json. It
 * fails on an advisory nobody has accepted, on an acceptance past its expiry date, and on an
 * acceptance that no longer matches any advisory, so the triage file never keeps stale entries.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/** One advisory as `bun audit --json` reports it, under its package's name. */
export interface Advisory {
  readonly url: string;
  readonly title: string;
  readonly severity: string;
  readonly vulnerable_versions: string;
}

export type AuditReport = Readonly<Record<string, readonly Advisory[]>>;

/** An advisory someone looked at and accepted for now. */
export interface Acceptance {
  /** The GitHub advisory id, such as `GHSA-g3hv-75wg-m249`. */
  readonly id: string;
  readonly package: string;
  readonly reason: string;
  /** `YYYY-MM-DD`: the acceptance ends at the start of this day (UTC). */
  readonly expires: string;
}

const GHSA = /GHSA(?:-[0-9a-z]{4}){3}/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The GHSA id in an advisory's URL, or the URL itself when it has none. */
export function advisoryId(advisory: Advisory): string {
  return GHSA.exec(advisory.url)?.[0] ?? advisory.url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function acceptanceProblem(entry: Record<string, unknown>): string | undefined {
  const { id, reason, expires } = entry;
  if (typeof id !== "string" || !GHSA.test(id)) return "needs an id such as GHSA-xxxx-xxxx-xxxx";
  if (typeof entry.package !== "string" || entry.package === "") return "needs a package";
  if (typeof reason !== "string" || reason.trim() === "") return "needs a reason";
  if (typeof expires !== "string" || !DATE.test(expires))
    return "needs an expiry date (YYYY-MM-DD)";
  return undefined;
}

/**
 * Reads the triage file's `accepted` list.
 *
 * @throws {Error} naming the first entry that is not a complete acceptance.
 */
export function parseTriage(json: unknown): Acceptance[] {
  const accepted = isRecord(json) && Array.isArray(json.accepted) ? json.accepted : undefined;
  if (accepted === undefined)
    throw new Error("dependency-audit-triage.json needs an accepted list");
  return accepted.map((entry: unknown, index) => {
    const label = `dependency-audit-triage.json entry ${String(index + 1)}`;
    if (!isRecord(entry)) throw new Error(`${label} must be an object`);
    const problem = acceptanceProblem(entry);
    if (problem !== undefined) throw new Error(`${label} ${problem}`);
    return entry as unknown as Acceptance;
  });
}

/** Everything wrong with the audit against the triage on `today` (`YYYY-MM-DD`); empty when clean. */
export function auditProblems(
  report: AuditReport,
  triage: readonly Acceptance[],
  today: string,
): string[] {
  const problems: string[] = [];
  const found = new Set<string>();
  for (const [name, advisories] of Object.entries(report)) {
    for (const advisory of advisories) {
      const id = advisoryId(advisory);
      found.add(`${name} ${id}`);
      const accepted = triage.find((entry) => entry.id === id && entry.package === name);
      const what = `${name} ${id} (${advisory.severity}, ${advisory.vulnerable_versions}): ${advisory.title}`;
      if (accepted === undefined) problems.push(`not triaged: ${what}`);
      else if (accepted.expires <= today) {
        problems.push(`acceptance expired on ${accepted.expires}: ${what}`);
      }
    }
  }
  for (const entry of triage) {
    if (!found.has(`${entry.package} ${entry.id}`)) {
      problems.push(
        `no longer reported, so remove it from the triage: ${entry.package} ${entry.id}`,
      );
    }
  }
  return problems;
}

/** What `bun audit --json` printed, and how it exited. */
export interface AuditRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `<bun> audit --json` in `root`. */
export function runBunAudit(root: string, bun = "bun"): AuditRun {
  const result = spawnSync(bun, ["audit", "--json"], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * The gate over `root` on `today`. `audit` runs `bun audit --json`; a test passes a stand-in.
 * Returns the exit code.
 */
export function runDependencyAudit(
  root: string,
  today: string,
  print: (line: string) => void,
  audit: (root: string) => AuditRun = runBunAudit,
): number {
  const triage = parseTriage(
    JSON.parse(readFileSync(path.join(root, "dependency-audit-triage.json"), "utf8")) as unknown,
  );
  const run = audit(root);
  let report: AuditReport;
  try {
    report = JSON.parse(run.stdout) as AuditReport;
  } catch {
    print(`bun audit did not print JSON (exit ${String(run.status)}): ${run.stderr.trim()}`);
    return 1;
  }
  const problems = auditProblems(report, triage, today);
  for (const problem of problems) print(problem);
  if (problems.length > 0) return 1;
  const advisories = Object.values(report).flat().length;
  print(
    advisories === 0
      ? "bun audit reports no advisory."
      : `bun audit reports ${String(advisories)} advisories, each accepted in the triage file.`,
  );
  return 0;
}
