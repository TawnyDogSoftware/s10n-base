/** `bun run docker:smoke [image]`: see smoke.ts. */
import path from "node:path";

import { containerSmokeCommand, nodeCommandIo } from "./smoke";

process.exitCode = await containerSmokeCommand(
  process.argv.slice(2),
  nodeCommandIo(path.resolve(import.meta.dirname, "../..")),
);
