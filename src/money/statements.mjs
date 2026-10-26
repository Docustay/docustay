// @ts-check
// Money › Statements on the Stripe API (the maintainer, 23 Oct 2026: "rebuild the Money screens that use Stripe's embedded components on the Stripe API").
//
// ★ WHY. The old screen mounted Stripe's embedded "documents" component, which needs an Account Session, and Account Sessions only exist
//   for CONNECTED accounts. an example organisation is the platform's own (direct) account, so the screen said "This didn't load" for GLC.
// ★ WHAT IT IS NOW. Monthly statements are Stripe Reporting API report runs (/v1/reporting/report_runs):
//   - the practice's own (direct) account: `balance.summary.1` (the month's balance summary) and `payouts.itemized.3` (every payout);
//   - a connected practice: the platform asks for the `connected_account_*` versions of the same two, scoped to that account.
//   A run is asked for once, Stripe builds the CSV, and the download goes through this server (Stripe's file link needs the secret key,
//   which never reaches a browser). 1099-K and other tax forms stay in Stripe's own Dashboard: Stripe has no API that hands them out.
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { getConnectAccountState } from "./connect.mjs";
import { stripeSecretKeyForConfig } from "./charge.mjs";
import { stripeEnv, productOfTenant } from "../product/stripeFor.mjs";
import { invalid, notFound, dependency } from "../http/errors.mjs";

const KINDS = Object.freeze({
  balance: { label: "Balance summary", direct: "balance.summary.1", connected: "connected_account_balance.summary.1" },
  payouts: { label: "Payouts, itemised", direct: "payouts.itemized.3", connected: "connected_account_payouts.itemized.3" },
});

async function accountFacts(tx, tenantId) {
  const st = await getConnectAccountState(tx, tenantId);
  return { direct: st.isDirectAccount === true, acct: st.stripeAccountId ?? null, state: st.state };
}

/** Platform-key call (never sent "on" the connected account: the Reporting API runs on the platform for connected_account_* types). */
const call = (tx, tenantId, args) => stripeConnectedRequest(tx, { tenantId, movesMoney: false, onAccount: false, allowUnverified: true, ...args });

const monthBounds = (ym) => {
  if (!/^\d{4}-\d{2}$/.test(String(ym ?? ""))) throw invalid("month must look like 2026-09");
  const [y, m] = ym.split("-").map(Number);
  return { start: Math.floor(Date.UTC(y, m - 1, 1) / 1000), end: Math.floor(Date.UTC(y, m, 1) / 1000) };
};

function rowOf(run, { direct, acct }) {
  const p = run.parameters ?? {};
  if (!direct && p.connected_account !== acct) return null;
  const kind = Object.entries(KINDS).find(([, k]) => k.direct === run.report_type || k.connected === run.report_type)?.[0];
  if (!kind) return null;
  const start = p.interval_start ? new Date(p.interval_start * 1000) : null;
  return {
    id: run.id,
    kind,
    label: KINDS[kind].label,
    month: start ? `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}` : null,
    status: run.status, // pending | succeeded | failed
    error: run.error ?? null,
    createdAt: run.created ? new Date(run.created * 1000).toISOString() : null,
    ready: run.status === "succeeded" && !!run.result?.url,
    sizeBytes: run.result?.size ?? null,
  };
}

/** The statements asked for so far, newest first, plus the last month Stripe has data for. */
export async function listStatements(tx, { tenantId }) {
  const facts = await accountFacts(tx, tenantId);
  if (facts.state === "not_connected") return { connected: false, rows: [], availableUntil: null, kinds: KINDS };
  const { body } = await call(tx, tenantId, { method: "GET", path: "/reporting/report_runs", query: { limit: 100 }, purpose: "statements_list" });
  const rows = (body?.data ?? []).map((r) => rowOf(r, facts)).filter(Boolean);
  const type = facts.direct ? KINDS.balance.direct : KINDS.balance.connected;
  let availableUntil = null;
  try {
    const { body: t } = await call(tx, tenantId, { method: "GET", path: `/reporting/report_types/${type}`, purpose: "statements_type" });
    availableUntil = t?.data_available_end ? new Date(t.data_available_end * 1000).toISOString() : null;
  } catch { /* the list still shows; the month picker just isn't capped */ }
  return { connected: true, direct: facts.direct, rows, availableUntil, kinds: KINDS };
}

/** Ask Stripe for one month's statement of one kind. Returns the new row (status pending). */
export async function requestStatement(tx, { tenantId, month, kind }) {
  if (!KINDS[kind]) throw invalid("kind must be balance or payouts");
  const facts = await accountFacts(tx, tenantId);
  if (facts.state === "not_connected") throw invalid("Connect Stripe first.");
  const { start, end } = monthBounds(month);
  const type = facts.direct ? KINDS[kind].direct : KINDS[kind].connected;
  const { body: t } = await call(tx, tenantId, { method: "GET", path: `/reporting/report_types/${type}`, purpose: "statements_type" });
  const until = Number(t?.data_available_end ?? 0), from = Number(t?.data_available_start ?? 0);
  if (until && start >= until) throw invalid("Stripe doesn't have that month's figures yet. Try an earlier month.");
  const form = {
    report_type: type,
    "parameters[interval_start]": Math.max(start, from || start),
    "parameters[interval_end]": until ? Math.min(end, until) : end,
    ...(facts.direct ? {} : { "parameters[connected_account]": facts.acct }),
  };
  const { body } = await call(tx, tenantId, { method: "POST", path: "/reporting/report_runs", form, purpose: `statements_run_${kind}` });
  return rowOf(body, facts);
}

/** The CSV of one finished statement: `{ filename, bytes }`. Only a run that belongs to this practice. */
export async function downloadStatement(tx, { tenantId, runId }, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (!/^frr_[A-Za-z0-9]+$/.test(String(runId ?? ""))) throw notFound("No such statement.");
  const facts = await accountFacts(tx, tenantId);
  const { body } = await call(tx, tenantId, { method: "GET", path: `/reporting/report_runs/${runId}`, purpose: "statements_get" });
  const row = body ? rowOf(body, facts) : null;
  if (!row) throw notFound("No such statement.");
  if (!row.ready) throw invalid("Stripe is still making this statement. Try again in a minute.");
  const key = stripeSecretKeyForConfig(stripeEnv(await productOfTenant(tx, tenantId), env));
  const r = await fetchImpl(body.result.url, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw dependency(`Stripe did not hand over the file (${r.status}).`);
  const bytes = Buffer.from(await r.arrayBuffer());
  return { filename: `stripe-${row.kind}-${row.month ?? "statement"}.csv`, bytes };
}
