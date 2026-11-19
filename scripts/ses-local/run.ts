/**
 * `bun run ses:local` (run.main.ts): runs the local SES capture server on the host and port of `SES_ENDPOINT`
 * (from `.env`, or `.env.example`), until Ctrl-C. The inbox is at that address.
 */
import { type SesLocal, startSesLocal } from "./server";

/**
 * Where to listen, from `SES_ENDPOINT`.
 *
 * @throws {Error} when it is unset or not an http URL with a port.
 */
export function listenAddress(endpoint: string | undefined): { host: string; port: number } {
  const url = endpoint === undefined || endpoint === "" ? null : URL.parse(endpoint);
  if (url === null || url.protocol !== "http:" || url.port === "") {
    throw new Error(
      "SES_ENDPOINT must be set to the capture server's address, such as http://127.0.0.1:8005.",
    );
  }
  return { host: url.hostname.replace(/^\[(.*)\]$/, "$1"), port: Number(url.port) };
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
