import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.resolve(import.meta.dirname, "../.github/workflows/ci.yml"),
  "utf8",
);

/** Each job's name in the workflow, in order, with the commands its steps run. */
function jobs(text: string): Array<{ readonly id: string; readonly runs: string[] }> {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  const found: Array<{ id: string; runs: string[] }> = [];
  for (const line of body.split("\n")) {
    const job = /^ {2}([\w-]+):\s*$/.exec(line);
    if (job?.[1] !== undefined) found.push({ id: job[1], runs: [] });
    const run = /^\s+(?:- )?run: (.+)$/.exec(line);
    if (run?.[1] !== undefined) found.at(-1)?.runs.push(run[1].trim());
  }
  return found;
}

describe("the CI workflow", () => {
  it("runs bun run agent:check in its first job, rather than a copy of its gates", () => {
    const [first] = jobs(workflow);

    expect(first?.runs).toContain("bun run agent:check");
    for (const gate of ["bun run lint", "bun run fmt:check", "bun run typecheck", "bun run test"]) {
      expect(first?.runs).not.toContain(gate);
    }
  });

  it("checks out the whole history and passes the pull request's text to the attribution gate", () => {
    const first = workflow.slice(
      workflow.indexOf("\n  check:\n"),
      workflow.indexOf("\n  mobile:\n"),
    );

    expect(first).toContain("fetch-depth: 0");
    expect(first).toContain("PR_TITLE: ${{ github.event.pull_request.title }}");
    expect(first).toContain("PR_BODY: ${{ github.event.pull_request.body }}");
    expect(first).not.toMatch(/run: .*github\.event\.pull_request/);
  });

  it("then builds, migrates, runs the live tests and the smoke test", () => {
    const [first] = jobs(workflow);
    const runs = first?.runs ?? [];

    expect(runs.indexOf("bun run build")).toBeGreaterThan(runs.indexOf("bun run agent:check"));
    expect(runs).toEqual(
      expect.arrayContaining(["bun run db:migrate", "bun run test:live", "bun run smoke"]),
    );
  });

  it("runs the browser journeys in a job of their own, with Chromium installed first", () => {
    const journeys = jobs(workflow).find((job) => job.runs.includes("bun run test:e2e"));
    const runs = journeys?.runs ?? [];

    expect(runs.indexOf("bunx playwright install --with-deps chromium")).toBeGreaterThan(-1);
    expect(runs.indexOf("bun run test:e2e")).toBeGreaterThan(
      runs.indexOf("bunx playwright install --with-deps chromium"),
    );
  });

  it("builds the image from docker/Dockerfile in a job of its own, then runs docker:smoke", () => {
    const container = jobs(workflow).find((job) => job.runs.includes("bun run docker:smoke"));
    const section = workflow.slice(workflow.indexOf("\n  container:\n"));

    expect(container?.id).toBe("container");
    expect(section).toMatch(/uses: docker\/build-push-action@[0-9a-f]{40} /);
    expect(section).toContain("file: docker/Dockerfile");
    expect(section).toContain("push: false");
    expect(section.indexOf("docker/build-push-action")).toBeLessThan(
      section.indexOf("bun run docker:smoke"),
    );
  });

  it("proves the rename in a job of its own, with the whole history for the attribution gate", () => {
    const rename = jobs(workflow).find((job) => job.runs.includes("bun run rename:proof"));
    const section = workflow.slice(workflow.indexOf("\n  rename:\n"));

    expect(rename?.id).toBe("rename");
    expect(section).toContain("fetch-depth: 0");
  });

  it("uploads no artifact, so no trace, video or snapshot of a journey leaves the runner", () => {
    expect(workflow).not.toMatch(/actions\/upload-artifact/);
  });
});
