import { Schema } from "effect";

export interface RpcContract<Payload, Success> {
  readonly method: string;
  readonly payload: Schema.Schema<Payload>;
  readonly success: Schema.Schema<Success>;
}

export function defineRpc<Payload, Success>(
  method: string,
  payload: Schema.Schema<Payload>,
  success: Schema.Schema<Success>,
): RpcContract<Payload, Success> {
  return {
    method,
    payload,
    success,
  };
}

/** The body of every `POST /rpc` request. The payload is decoded later by the method's contract. */
export const RpcRequest = Schema.Struct({
  method: Schema.String,
  payload: Schema.Unknown,
});
export type RpcRequest = typeof RpcRequest.Type;

/**
 * Every RPC method the server exposes. Empty until an application adds its own methods with
 * `defineRpc`; the element type accepts any contract, so adding entries does not change it.
 */
export const rpcContracts: ReadonlyArray<RpcContract<unknown, unknown>> = [];
