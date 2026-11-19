/**
 * Routes `POST /rpc` calls to their handlers. Every call is checked in this order: the method
 * exists (404), the caller may use it (401 or 403), the payload matches the contract (400), then
 * the handler runs and its result is encoded with the contract. The caller is checked before the
 * payload is decoded, so a caller who may not use a method learns nothing about its payload.
 */
import { Schema } from "effect";
import type { IncomingMessage } from "node:http";

import {
  type AppError,
  ERROR_CODES,
  type Role,
  type RpcAuth,
  type RpcContract,
  type RpcRequest,
} from "@s10n-base/contracts";

import type { Logger } from "../observability/logger";

/** Who is calling: nobody signed in, or a signed-in user with a role. */
export type Actor =
  | { readonly kind: "anonymous" }
  | { readonly kind: "user"; readonly userId: string; readonly role: Role };

/** Finds the caller of a request: in the server, a session lookup (`auth/session-actor.ts`). */
export type ActorResolver = (request: IncomingMessage | undefined) => Promise<Actor>;

export const anonymousActorResolver: ActorResolver = () => Promise.resolve({ kind: "anonymous" });

/** What the HTTP layer passes in for each call. */
export interface RpcCallContext {
  readonly requestId: string;
  readonly logger: Logger;
  readonly request?: IncomingMessage;
}

/** What a handler receives besides its payload. */
export interface RpcHandlerContext extends RpcCallContext {
  /**
   * The caller. Already looked up for a method that needs a session; a public method's handler
   * pays for the lookup only if it asks. Looked up at most once per call.
   */
  readonly getActor: () => Promise<Actor>;
}

/** Serves one RPC method. Build it with {@link defineHandler} so its types follow the contract. */
export interface RpcHandler<Payload = unknown, Success = unknown> {
  readonly contract: RpcContract<Payload, Success>;
  /** Receives only payloads the contract decoded. A method, so typed handlers share one list. */
  handle(payload: Payload, context: RpcHandlerContext): Promise<Success>;
}

export function defineHandler<Payload, Success, PayloadEncoded, SuccessEncoded>(
  contract: RpcContract<Payload, Success, PayloadEncoded, SuccessEncoded>,
  handle: (payload: Payload, context: RpcHandlerContext) => Promise<Success>,
): RpcHandler<Payload, Success> {
  return { contract, handle };
}

export type RpcFailureStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429;

export type RpcResponse =
  | { readonly status: 200; readonly body: { readonly ok: true; readonly data: unknown } }
  | {
      readonly status: RpcFailureStatus;
      readonly body: { readonly ok: false; readonly error: AppError };
    };

/**
 * An expected failure a handler answers with. The dispatcher sends its status and error; any
 * other error a handler throws becomes a 500 in the HTTP layer, with nothing of it sent.
 */
export class RpcFailure extends Error {
  override readonly name = "RpcFailure";

  constructor(
    readonly status: RpcFailureStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RpcDispatcher = (request: RpcRequest, context: RpcCallContext) => Promise<RpcResponse>;

function failure(status: RpcFailureStatus, code: string, message: string): RpcResponse {
  return { status, body: { ok: false, error: { code, message } } };
}

/**
 * Returns the failure for an actor that may not call a method with `auth`, or `null` when it may.
 * A role level requires exactly that role.
 */
export function authorize(auth: RpcAuth, actor: Actor): RpcResponse | null {
  if (auth === "public") return null;
  if (actor.kind === "anonymous") {
    return failure(401, ERROR_CODES.unauthenticated, "Sign in to use this method.");
  }
  if (auth !== "session" && actor.role !== auth.role) {
    return failure(403, ERROR_CODES.forbidden, "You are not allowed to use this method.");
  }
  return null;
}

export interface RpcDispatcherOptions {
  readonly handlers: ReadonlyArray<RpcHandler>;
  readonly resolveActor: ActorResolver;
}

/** @throws {Error} when two handlers serve the same method. */
export function createRpcDispatcher(options: RpcDispatcherOptions): RpcDispatcher {
  const byMethod = new Map<string, RpcHandler>();
  for (const handler of options.handlers) {
    const { method } = handler.contract;
    if (byMethod.has(method)) throw new Error(`Duplicate RPC handler for ${method}`);
    byMethod.set(method, handler);
  }

  return async (request, context) => {
    const handler = byMethod.get(request.method);
    if (handler === undefined) {
      return failure(404, ERROR_CODES.methodNotFound, `Unknown RPC method ${request.method}`);
    }
    const { contract } = handler;
    let lookup: Promise<Actor> | undefined;
    const getActor = () => (lookup ??= options.resolveActor(context.request));
    // A public method costs no session lookup.
    if (contract.auth !== "public") {
      const denied = authorize(contract.auth, await getActor());
      if (denied !== null) return denied;
    }

    const decoded = Schema.decodeUnknownExit(contract.payload)(request.payload);
    if (decoded._tag === "Failure") {
      return failure(400, ERROR_CODES.invalidPayload, `Invalid payload for ${contract.method}`);
    }
    let result: unknown;
    try {
      result = await handler.handle(decoded.value, { ...context, getActor });
    } catch (error) {
      if (error instanceof RpcFailure) return failure(error.status, error.code, error.message);
      throw error;
    }
    return { status: 200, body: { ok: true, data: Schema.encodeSync(contract.success)(result) } };
  };
}
