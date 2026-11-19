import type { RpcHandler } from "./dispatcher";

/**
 * The server's RPC handlers, one per contract in `rpcContracts` (a test checks both lists match).
 * Build each with `defineHandler(contract, handle)`.
 */
export const rpcHandlers: ReadonlyArray<RpcHandler> = [];
