import type { Kysely } from "kysely";

import type { AppAuth } from "../auth/instance";
import type { DB } from "../infra/postgres/generated/db";
import { adminUserHandlers } from "./admin-users";
import type { RpcHandler } from "./dispatcher";
import { profileHandlers } from "./profile";

/** What the handlers need from the server. */
export interface RpcHandlerDependencies {
  readonly db: Kysely<DB>;
  readonly auth: Pick<AppAuth, "updateUserName">;
}

/**
 * The server's RPC handlers, one per contract in `rpcContracts` (a test checks both lists match).
 * Build each with `defineHandler(contract, handle)`.
 */
export function createRpcHandlers(dependencies: RpcHandlerDependencies): ReadonlyArray<RpcHandler> {
  return [...profileHandlers(dependencies), ...adminUserHandlers(dependencies)];
}
