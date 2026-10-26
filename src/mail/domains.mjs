// src/mail/domains.mjs — THE SENDING DOMAIN: add it at the provider (Resend), show the DNS records, check them. "Already in OUR provider account" is the ATTACH case: the existing domain is found and used, never an error.
import { ports } from "./ports.mjs";
import { domainRow, resolveIdentity } from "./identity.mjs";
import { invalid, notFound } from "../http/errors.mjs";

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const API = "https://api.resend.com";
const asState = (s) => (s === "verified" ? "verified" : s === "failed" || s === "temporary_failure" ? "failed" : "pending");
const shape = (d) => ({
  ref: d?.id ?? null, status: asState(d?.status),
  records: (d?.records ?? []).map((r) => ({ record: r.record ?? null, name: r.name ?? "", type: r.type ?? "", value: r.value ?? "", priority: r.priority ?? null, ttl: r.ttl ?? "Auto", status: r.status ?? "not_started" })),
});
async function call(method, path, body) {
  const P = await ports();
  return P.outside("resend", `${API}${path}`, { method, headers: { authorization: `Bearer ${P.adminKey()}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }, { timeoutMs: 15_000 });
}
function failure(r, what) {
  const msg = r.status === null ? `could not reach the email provider (${r.timedOut ? "timed out" : "no reply"})` : (r.body?.message ?? `the email provider answered ${r.status}`);
  const e = new Error(`${what}: ${msg}`); e.status = r.status; return e;
}
/** Provider calls — exported so the live proofs can drive them directly. `attached` is true when the domain already existed in our account. */
export const provider = {
  async get(ref) { const r = await call("GET", `/domains/${encodeURIComponent(ref)}`); if (!r.ok) throw failure(r, "reading the sending domain"); return shape(r.body); },
  async verify(ref, { poll = true } = {}) {
    // read first: asking the provider to verify RESTARTS its check (a domain it had already verified reads "pending" again for a minute), so only ask when it is not verified yet
    const first = await provider.get(ref); if (first.status === "verified") return first;
    const r = await call("POST", `/domains/${encodeURIComponent(ref)}/verify`); if (!r.ok) throw failure(r, "asking the provider to verify the domain");
    // the provider checks DNS asynchronously: the answer to this call is the OLD status, so look again a few times
    let d = await provider.get(ref);
    for (let i = 0; poll && i < 4 && d.status === "pending"; i += 1) { await new Promise((ok) => setTimeout(ok, 2500)); d = await provider.get(ref); }
    return d;
  },
  async create(domain) {
    const r = await call("POST", "/domains", { name: domain });
    if (r.ok) return { ...shape(r.body), attached: false };
    if (r.status === 409 || /already/i.test(r.body?.message ?? "")) {
      const list = await call("GET", "/domains");
      const found = list.ok ? (list.body?.data ?? []).find((d) => d.name === domain) : null;
      if (found) return { ...(await provider.get(found.id)), attached: true };
    }
    throw failure(r, "adding the sending domain");
  },
  async remove(ref) { const r = await call("DELETE", `/domains/${encodeURIComponent(ref)}`); if (!r.ok && r.status !== 404) throw failure(r, "removing the sending domain"); },
};

const save = (tx, tenantId, domain, state) => tx.query(
  `INSERT INTO keystone.mail_domain (tenant_id, domain, provider_ref, status, records, last_error, verified_at, checked_at)
   VALUES ($1,$2,$3,$4,$5::jsonb,$6, CASE WHEN $4 = 'verified' THEN now() END, now())
   ON CONFLICT (tenant_id) DO UPDATE SET domain = EXCLUDED.domain, provider_ref = EXCLUDED.provider_ref, status = EXCLUDED.status, records = EXCLUDED.records,
      last_error = EXCLUDED.last_error, verified_at = CASE WHEN EXCLUDED.status = 'verified' THEN coalesce(keystone.mail_domain.verified_at, now()) END, checked_at = now(), updated_at = now()`,
  [tenantId, domain, state.ref ?? null, state.status, JSON.stringify(state.records ?? []), state.error ?? null]);

export async function startDomain(tx, { tenantId, domain }) {
  const d = String(domain ?? "").trim().toLowerCase();
  if (!DOMAIN.test(d)) throw invalid("Enter a domain like yourdomain.com", { field: "domain" });
  try { await save(tx, tenantId, d, await provider.create(d)); }
  catch (e) { await save(tx, tenantId, d, { ref: null, status: "failed", records: [], error: e.message }); throw invalid(e.message, { field: "domain" }); }
}
export async function verifyDomainNow(tx, { tenantId }) {
  const row = await domainRow(tx);
  if (!row?.provider_ref) throw notFound("Add your sending domain first");
  try { await save(tx, tenantId, row.domain, { ...(await provider.verify(row.provider_ref)), ref: row.provider_ref }); }
  catch (e) { await tx.query(`UPDATE keystone.mail_domain SET last_error = $1, checked_at = now(), updated_at = now() WHERE tenant_id = $2`, [e.message.slice(0, 300), tenantId]); }
}
/** Due fact (run by the worker's tenant sweep): a domain still waiting on DNS is asked again in the background — every 2 minutes for its first hour, every 30 minutes after — so verification does not wait for someone to click "Check now". Once the row says verified, the identity resolver sends from it with no further step. Throttled by checked_at, so a second pass straight after is a no-op. */
export const MAIL_DOMAIN_PENDING_FACT = {
  key: "mail_domain_pending",
  why: "an own-domain verification is waiting on DNS and nobody is looking at the screen",
  find: (tx, { tenantId }) => tx.query(
    `SELECT domain, provider_ref FROM keystone.mail_domain
      WHERE tenant_id = $1 AND status = 'pending' AND provider_ref IS NOT NULL
        AND COALESCE(checked_at, 'epoch') < now() - CASE WHEN created_at > now() - interval '1 hour' THEN interval '2 minutes' ELSE interval '30 minutes' END`, [tenantId]),
  act: async (tx, { tenantId, row }) => {
    try {
      // READ FIRST: asking the provider to verify restarts its check (the status goes back to pending), so a sweep that only asked would never see the answer to its own last question
      let d = await provider.get(row.provider_ref);
      if (d.status === "pending") await provider.verify(row.provider_ref, { poll: false });
      await save(tx, tenantId, row.domain, { ...d, ref: row.provider_ref });
      return `${row.domain} is ${d.status}`;
    } catch (e) {
      await tx.query(`UPDATE keystone.mail_domain SET last_error = $1, checked_at = now(), updated_at = now() WHERE tenant_id = $2`, [e.message.slice(0, 300), tenantId]);
      return `${row.domain} could not be checked: ${e.message.slice(0, 120)}`;
    }
  },
};
export async function removeDomain(tx, { tenantId }) {
  const row = await domainRow(tx);
  if (!row) return;
  await tx.query(`DELETE FROM keystone.mail_domain WHERE tenant_id = $1`, [tenantId]);
}
export { resolveIdentity };
