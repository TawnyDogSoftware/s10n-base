/** `bun run smoke`: see smoke-built-server.ts. */
import path from "node:path";

import { smokeCommand } from "./smoke-built-server";

process.exitCode = await smokeCommand(
  path.resolve(import.meta.dirname, ".."),
  process.env,
  console,
);
