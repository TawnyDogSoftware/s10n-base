import { adminListUsers } from "./admin";
import { profileGet, profileUpdate } from "./profile";
import type { RpcContract } from "./rpc";

/**
 * Every RPC method the server exposes. Add a method by defining it with `defineRpc` and listing
 * it here; the element type accepts any contract, so adding entries does not change it. The
 * server's handler list must match it one to one (a server test checks that).
 */
export const rpcContracts: ReadonlyArray<RpcContract> = [profileGet, profileUpdate, adminListUsers];
