import { Schema } from "effect";

/** The roles a signed-in user can have. */
export const Role = Schema.Literals(["user", "admin"]);
export type Role = typeof Role.Type;

/**
 * Who may call an RPC method: anyone (`"public"`), any signed-in user (`"session"`), or a
 * signed-in user with the given role (`{ role }`). The server checks it before it decodes the
 * payload.
 */
export const RpcAuth = Schema.Union([
  Schema.Literals(["public", "session"]),
  Schema.Struct({ role: Role }),
]);
export type RpcAuth = typeof RpcAuth.Type;

/**
 * One RPC method: its name, who may call it, and the schemas for its payload and result. The
 * type parameters are the decoded and encoded (JSON) types, which differ for schemas such as
 * `Schema.NumberFromString`.
 */
export interface RpcContract<
  Payload = unknown,
  Success = unknown,
  PayloadEncoded = unknown,
  SuccessEncoded = unknown,
> {
  readonly method: string;
  readonly auth: RpcAuth;
  readonly payload: Schema.Codec<Payload, PayloadEncoded>;
  readonly success: Schema.Codec<Success, SuccessEncoded>;
}

/** Declares an RPC method. `auth` is required: there is no default level. */
export function defineRpc<Payload, Success, PayloadEncoded, SuccessEncoded>(contract: {
  readonly method: string;
  readonly auth: RpcAuth;
  readonly payload: Schema.Codec<Payload, PayloadEncoded>;
  readonly success: Schema.Codec<Success, SuccessEncoded>;
}): RpcContract<Payload, Success, PayloadEncoded, SuccessEncoded> {
  return {
    method: contract.method,
    auth: contract.auth,
    payload: contract.payload,
    success: contract.success,
  };
}

/** The body of every `POST /rpc` request. The payload is decoded later by the method's contract. */
export const RpcRequest = Schema.Struct({
  method: Schema.String,
  payload: Schema.Unknown,
});
export type RpcRequest = typeof RpcRequest.Type;
