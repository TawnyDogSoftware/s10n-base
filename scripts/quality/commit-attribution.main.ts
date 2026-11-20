/** `bun run commits:attribution`: see commit-attribution.ts. */
import path from "node:path";

import { commitAttribution, processIo } from "./commit-attribution";

process.exitCode = commitAttribution(
  process.argv.slice(2),
  processIo(path.resolve(import.meta.dirname, "../.."), console.log),
);
