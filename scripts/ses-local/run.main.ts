/** `bun run ses:local`: see run.ts. */
import { onProcessInterrupt, runSesLocal } from "./run";

process.exitCode = await runSesLocal(process.env, {
  log: console.log,
  error: console.error,
  onInterrupt: onProcessInterrupt,
});
