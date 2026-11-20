/**
 * `bun run ses:local` (run.main.ts): runs the local SES capture server on the host and port of `SES_ENDPOINT`
 * (from `.env`, or `.env.example`), until Ctrl-C. The inbox is at that address.
 */
import { parseCaptureEndpoint } from "../../packages/shared/src/local-endpoint";
import { type SesLocal, startSesLocal } from "./server";

/**
 * Where to listen, from `SES_ENDPOINT`: the same rule the server's config applies to it.
 *
 * @throws {Error} when it is unset or not an http loopback origin with a port.
 */
export function listenAddress(endpoint: string | undefined): { host: string; port: number } {
  const parsed = parseCaptureEndpoint(endpoint ?? "");
  if (parsed === null) {
    throw new Error(
      "SES_ENDPOINT must be set to the capture server's address, an http loopback origin with a port, such as http://127.0.0.1:8005.",
    );
  }
  return { host: parsed.host, port: parsed.port };
}

/** What `ses:local` touches: where it prints and how it learns to stop. */
export interface SesLocalIo {
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  /** Called once with a function to call on Ctrl-C or SIGTERM. */
  readonly onInterrupt: (stop: () => void) => void;
}

/** Calls `stop` on Ctrl-C and on SIGTERM, listening for each signal once. */
export function onProcessInterrupt(stop: () => void): void {
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

/**
 * Runs the capture server at `SES_ENDPOINT` until interrupted, then stops it. Resolves with the
 * exit code: 0 after a clean stop, 1 when it could not start.
 */
export async function runSesLocal(
  env: Readonly<Record<string, string | undefined>>,
  io: SesLocalIo,
): Promise<number> {
  let local: SesLocal;
  try {
    local = await startSesLocal(listenAddress(env.SES_ENDPOINT));
  } catch (error) {
    io.error(`ses-local: ${(error as Error).message}`);
    return 1;
  }
  io.log(`ses-local: capturing SES email at ${local.url}; inbox: ${local.url}/`);
  await new Promise<void>((resolve) => {
    io.onInterrupt(resolve);
  });
  await local.stop();
  return 0;
}
