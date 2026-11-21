/**
 * The RPC client: `POST <baseUrl>/rpc` with the `{method, payload}` envelope, encoded and decoded
 * with the method's contract. Failures are typed; see `transport.ts`.
 */
import { Schema } from "effect";

import type { RpcContract } from "@s10n-base/contracts";

import { createTransport, DecodeError, type TransportOptions } from "./transport";

export { DecodeError, NetworkError, parseBaseUrl, RpcError } from "./transport";

interface CallOptions {
  readonly signal?: AbortSignal;
}

export interface RpcClient {
  /** The API origin every call goes to. */
  readonly baseUrl: string;
  /**
   * Calls a method and returns its decoded result.
   *
   * @throws {RpcError} when the server refused the call (its `code` and HTTP `status`).
   * @throws {DecodeError} when the answer does not match the contract.
   * @throws {NetworkError} when no answer arrived: the outcome is unknown.
   */
  readonly call: <Payload, Success, PayloadEncoded, SuccessEncoded>(
    contract: RpcContract<Payload, Success, PayloadEncoded, SuccessEncoded>,
    payload: Payload,
    options?: CallOptions,
  ) => Promise<Success>;
}

export function createRpcClient(options: TransportOptions): RpcClient {
  const transport = createTransport(options);
  return {
    baseUrl: transport.origin,
    call: async (contract, payload, callOptions = {}) => {
      // Encoding fails before anything is sent when the payload breaks the contract.
      const encoded = Schema.encodeUnknownSync(contract.payload)(payload);
      const data = await transport.request("/rpc", {
        method: "POST",
        body: { method: contract.method, payload: encoded },
        ...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
      });
      const decoded = Schema.decodeUnknownExit(contract.success)(data);
      if (decoded._tag === "Failure") {
        throw new DecodeError(`The result of ${contract.method} does not match its contract.`);
      }
      return decoded.value;
    },
  };
}
