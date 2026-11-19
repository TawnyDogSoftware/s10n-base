import { describe, expect, it } from "vitest";

import { parseOutdated } from "./outdated";

// Captured from `bun outdated -r` on bun 1.4.4.
const output = `bun outdated v1.4.4 (38afee6c8)
|----------------------------------------------------------------------------|
| Package                   | Current | Update    | Latest    | Workspace    |
|---------------------------|---------|-----------|-----------|--------------|
| @tanstack/react-query     | 5.107.1 | 5.107.1 * | 5.107.1 * | catalog (a)  |
|---------------------------|---------|-----------|-----------|--------------|
| @testing-library/jest-dom | 6.9.1   | 6.9.1     | 7.0.1 *   | catalog (a)  |
|---------------------------|---------|-----------|-----------|--------------|
| effect                    | 4.0.3   | 4.0.3     | 4.1.4     | catalog (a)  |
|---------------------------|---------|-----------|-----------|--------------|
| oxlint (dev)              | 1.90.0  | 1.90.0    | 1.93.0 *  | catalog (bt) |
|----------------------------------------------------------------------------|
Note: The * indicates that version isn't true latest due to minimum release age
`;

describe("parseOutdated", () => {
  it("reads each row and whether the age gate holds back a newer release", () => {
    expect(parseOutdated(output)).toEqual([
      { name: "@tanstack/react-query", current: "5.107.1", latest: "5.107.1", heldByAge: true },
      { name: "@testing-library/jest-dom", current: "6.9.1", latest: "7.0.1", heldByAge: true },
      { name: "effect", current: "4.0.3", latest: "4.1.4", heldByAge: false },
      { name: "oxlint", current: "1.90.0", latest: "1.93.0", heldByAge: true },
    ]);
  });

  it("skips a row with fewer cells than the table has", () => {
    expect(parseOutdated("| effect | 4.0.3 | 4.0.3 |\n")).toEqual([]);
  });

  it("returns nothing when everything is current", () => {
    expect(parseOutdated("bun outdated v1.4.4 (38afee6c8)\n")).toEqual([]);
  });
});
