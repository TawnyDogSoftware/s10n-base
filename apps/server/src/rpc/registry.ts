import type { RpcContract } from "@s10n-base/contracts";

import type { RpcHandler } from "./dispatcher";

/**
 * Compares the contract list with the handler list and describes every mismatch: a contract no
 * handler serves, a handler with no contract, a handler built from another contract object with
 * the same method name, or a method listed twice. Empty when they match one to one.
 */
export function findRegistryMismatches(
  contracts: ReadonlyArray<RpcContract>,
  handlers: ReadonlyArray<RpcHandler>,
): ReadonlyArray<string> {
  const problems: string[] = [];
  const byMethod = new Map<string, RpcContract>();
  for (const contract of contracts) {
    if (byMethod.has(contract.method)) {
      problems.push(`${contract.method} is listed more than once in rpcContracts.`);
    }
    byMethod.set(contract.method, contract);
  }
  const served = new Set(handlers.map((handler) => handler.contract.method));
  for (const method of byMethod.keys()) {
    if (!served.has(method))
      problems.push(`${method} has a contract in rpcContracts but no handler.`);
  }
  for (const handler of handlers) {
    const { method } = handler.contract;
    const listed = byMethod.get(method);
    if (listed === undefined) {
      problems.push(`${method} has a handler but no contract in rpcContracts.`);
    } else if (listed !== handler.contract) {
      problems.push(`${method}'s handler does not use the contract listed in rpcContracts.`);
    }
  }
  return problems;
}
