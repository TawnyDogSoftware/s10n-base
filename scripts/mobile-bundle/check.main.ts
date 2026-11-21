/** `bun scripts/mobile-bundle/check.main.ts [dist]`: see check.ts. */
import { checkBundleCommand } from "./check";

process.exitCode = checkBundleCommand(process.argv.slice(2), process.cwd(), console);
