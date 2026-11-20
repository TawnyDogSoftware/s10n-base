/** `bun run lint:directives`: the no-suppression gate (lint-directives.ts). */
import path from "node:path";

import { runLintDirectiveCheck } from "./lint-directives";

process.exitCode = runLintDirectiveCheck(path.resolve(import.meta.dirname, "../.."), console.log);
