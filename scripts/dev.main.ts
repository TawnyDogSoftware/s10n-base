/** `bun dev`: see dev.ts. */
import path from "node:path";

import { processDevIo, runDev } from "./dev";

process.exitCode = await runDev(processDevIo(path.resolve(import.meta.dirname, "..")));
