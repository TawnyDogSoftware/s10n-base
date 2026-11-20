/**
 * Transactions that code holding only a database handle can join.
 *
 * Better Auth is given {@link JoinableTransactions.joinable} instead of the pool's Kysely. While
 * {@link JoinableTransactions.transaction} runs, every query made through `joinable` from the same
 * async context runs on that transaction; anywhere else, `joinable` is the plain database. So a
 * handler can lock a row with Kysely and write through Better Auth's internal adapter (keeping its
 * user hooks) in one transaction, and both commit or roll back together.
 *
 * A transaction cannot be nested: calling `joinable.transaction()` inside one fails, as it does on
 * any Kysely transaction. Better Auth 1.7.25 opens none on the paths the handlers use (the live
 * tests would fail if an upgrade started to).
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { Kysely, Transaction } from "kysely";

export interface JoinableTransactions<DB> {
  /** The database for code that cannot be handed a transaction: inside one, it is that one. */
  readonly joinable: Kysely<DB>;
  /** Runs `work` in a transaction that queries through `joinable` join. */
  readonly transaction: <T>(work: (trx: Transaction<DB>) => Promise<T>) => Promise<T>;
}

/** Whether `property` is read through a getter on `object` or its prototypes. */
function isGetter(object: object | null, property: string | symbol): boolean {
  if (object === null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  if (descriptor === undefined)
    return isGetter(Object.getPrototypeOf(object) as object | null, property);
  return descriptor.get !== undefined;
}

export function joinableTransactions<DB>(db: Kysely<DB>): JoinableTransactions<DB> {
  // The open transaction, cleared when it ends: work started inside it that is still running
  // afterwards goes back to the pool instead of a finished transaction.
  const current = new AsyncLocalStorage<{ trx: Transaction<DB> | undefined }>();
  const joinable = new Proxy(db, {
    get(target, property) {
      const source = current.getStore()?.trx ?? target;
      const value: unknown = Reflect.get(source, property, source);
      // A getter's result is kept as it is: `fn` returns a function that carries `count` and the
      // rest. A method is bound to the real instance, since Kysely keeps its state in private
      // fields.
      if (isGetter(source, property) || typeof value !== "function") return value;
      return (value as () => unknown).bind(source);
    },
  });
  return {
    joinable,
    transaction: (work) =>
      db.transaction().execute(async (trx) => {
        const scope = { trx: trx as Transaction<DB> | undefined };
        try {
          return await current.run(scope, () => work(trx));
        } finally {
          scope.trx = undefined;
        }
      }),
  };
}
