/** `bun run rename:proof`: see proof.ts. */
import path from "node:path";

import { processProofIo, renameProof } from "./proof";

process.exitCode = renameProof(
  process.argv.slice(2),
  processProofIo(path.resolve(import.meta.dirname, "../.."), console.log),
);
