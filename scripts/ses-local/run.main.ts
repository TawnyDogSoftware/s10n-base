/** `bun run ses:local`: see run.ts. */
import { runSesLocal } from "./run";

process.exitCode = await runSesLocal(process.env, {
  log: console.log,
  error: console.error,
  onInterrupt: (stop) => {
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  },
});
