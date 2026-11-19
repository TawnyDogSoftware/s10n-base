/**
 * Error codes the server answers with in `{ ok: false, error: { code, message } }`. Clients
 * branch on the code, never on the message.
 */
export const ERROR_CODES = {
  /** The method needs a signed-in caller and there is none (401). */
  unauthenticated: "auth.unauthenticated",
  /** The caller is signed in but lacks the role the method needs (403). */
  forbidden: "auth.forbidden",
  /** The body is not a `{method, payload}` envelope, or not JSON (400). */
  invalidRequest: "rpc.invalid_request",
  /** The payload does not match the method's contract (400). */
  invalidPayload: "rpc.invalid_payload",
  /** No method has that name (404). */
  methodNotFound: "rpc.method_not_found",
  /** Anything unexpected; the details are in the server log, never in the response (500). */
  unexpected: "server.unexpected_error",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
