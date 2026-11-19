/** `bun run agent:check`: see agent-check.ts. */
import { agentCheck, GATES, runScript } from "./agent-check";

process.exitCode = agentCheck(GATES, runScript, console.log);
