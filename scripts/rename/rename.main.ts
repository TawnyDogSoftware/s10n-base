/** `bun run rename`: see rename.ts. */
import path from "node:path";

import { processRenameIo, rename } from "./rename";

process.exitCode = rename(
  process.argv.slice(2),
  processRenameIo(path.resolve(import.meta.dirname, "../.."), console.log),
);
