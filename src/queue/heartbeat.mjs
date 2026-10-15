// src/queue/heartbeat.mjs — the worker heartbeat (07 §3, §5), and nothing else.
//
// ★★ WHY THIS IS ITS OWN FILE (Stage 2 final review M2). The tenant-predicate lint refuses raw database
//    access outside withTenant() unless a file is named in its allow-list WITH a reason. The heartbeat is a
//    legitimate exception — it writes one row per worker through ONE SECURITY DEFINER function,
//    keystone_meta.worker_beat(), as app_worker, which holds ZERO table rights (p21a_role_matrix). Exempting
//    the whole of runner.mjs to allow this one call would have exempted everything else in it too; this
//    file contains the call and nothing that could grow into a second one unnoticed.
import { dbSsl } from "../db/ssl.mjs";
import pg from "pg";
import { workerConnectionString } from "./runner.mjs";

/**
 * ★ 07 §5 heartbeat — one beat through the SECURITY DEFINER function, on the app_worker identity.
 *   ★★ A raw `pg.Client`, not `makeWorkerUtils`: this is a single INSERT/UPDATE through a function
 *      call, not queue traffic, and `keystone_meta.worker_beat` is reachable to app_worker precisely
 *      because it holds NO table rights — graphile's pool is not the point of this call.
 *   ★ ssl matches every other raw client in this codebase (src/db/index.mjs, src/health/probes.mjs):
 *     `{ rejectUnauthorized: false }`, because Railway's TCP proxy terminates with its own cert.
 */
export async function beat({ connectionString, worker } = {}) {
  const client = new pg.Client({
    connectionString: connectionString ?? workerConnectionString(),
    ssl: dbSsl(),
  });
  await client.connect();
  try {
    await client.query("SELECT keystone_meta.worker_beat($1)", [worker]);
  } finally {
    await client.end();
  }
}
