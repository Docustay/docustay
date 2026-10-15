// @ts-check
// src/db/kysely.mjs — L3.0. Kysely as the typed query BUILDER, nothing more.
//
// ★★★ RULING: Kysely only builds SQL; every statement still runs on the TENANT TRANSACTION via
//     `run(tx, query)`, so FORCE RLS, `withTenant`'s GUCs and the outbox-in-transaction all stay
//     exactly as they are. `db` below never opens a connection of its own — its driver is a
//     no-op (`DummyDriver`) and its only job is compiling a query object into `{ sql, parameters }`
//     that then goes through the SAME `tx.query` every hand-written query already used.
import { Kysely, PostgresAdapter, DummyDriver, PostgresIntrospector, PostgresQueryCompiler } from "kysely";

export const db = new Kysely({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (d) => new PostgresIntrospector(d),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

/**
 * Compile `query` and run it on `tx` — the tenant transaction, unchanged. Kysely never sees a
 * connection; `tx.query` is the same call every raw-SQL query in this codebase already makes.
 * ★ R4 (RECONCILE) — `compile(db)`, not `compile()`: a bare `sql\`…\`` RawBuilder has no executor
 *   of its own and throws "this query cannot be compiled to SQL" without one. Builder queries ignore
 *   the argument. Compiled ONCE, not twice.
 * @param {{ query: (sql: string, params: readonly unknown[]) => Promise<any> }} tx
 * @param {{ compile: (executorProvider?: any) => { sql: string, parameters: readonly unknown[] } }} query
 */
export function run(tx, query) {
  const compiled = query.compile(db);
  return tx.query(compiled.sql, compiled.parameters);
}
