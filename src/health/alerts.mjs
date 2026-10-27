// ★★★ 07 §6 — THE WATCHER NOW TELLS A PERSON. Immediate email for the checks whose failure stops the
//     product or loses data; everything else waits for the 7 am summary (Stage 4). Sent through Resend from
//     the the platform system address, never a practice mailbox, so a broken practice mailbox can't hide it.
import { platformAlertTo } from "../mail/index.mjs";
import { sendViaResend } from "../email/resend.mjs";
import { sendingAddress } from "../email/send.mjs";
import { redirectForEnvironment } from "../email/redirect.mjs";
import { deliverOrThrow } from "../email/deliverOrThrow.mjs";
import { recordHealthTransition } from "./platformEvents.mjs";

// ★★★ TY, 2 Oct 2026 — "WHY AM I GETTING ALL THESE ALERTS." ~46 health emails in 4h20m, every one a REPEAT of four standing conditions (no restore test ever
//     recorded, queue backlog, one webhook unapplied, no backup record) announced hourly from production AND the sandbox, plus a migrations flap on every deploy.
//     THE RULE NOW: an email interrupts a person ONLY when the product is down — app, database, worker. Everything else (queue, outbox, backup, restore,
//     stripe_webhooks, n8n, migrations, …) is still checked, still recorded, still on Platform → Health, and is reported ONCE A DAY in the 7 am summary
//     (`dailySummary.mjs` already lists every non-immediate check). A reminder is once every 24h, not hourly. There is no "recovered" email (the platform fact
//     is still recorded). And only PRODUCTION emails: staging/local record the same facts and send nothing.
export const IMMEDIATE_KEYS = Object.freeze(["app", "database", "worker", "queue_latency"]);   // queue_latency (26 Oct 2026): a person-facing job older than 2 minutes, or more than 3,000 jobs waiting
const REPEAT_MINUTES = 24 * 60;
/** Checks whose transitions are RECORDED as platform facts (health.check_failed / recovered) — the nine that always were. Only IMMEDIATE_KEYS email. */
const RECORDED_KEYS = Object.freeze(["app", "database", "worker", "queue_latency", "outbox", "queue", "backup", "restore", "stripe_webhooks", "n8n", "migrations"]);
/** Only the real production environment may page a person. */
const mayEmailFor = (env) => (env.KEYSTONE_ENVIRONMENT ?? "") === "production";

// ★★★ R8 fix round 1 (Important #1) — ALERT LOST ON SEND FAILURE. `alert_transition` used to be
//     called and its result trusted before the email was even attempted: if `deliver` threw (the
//     provider down, a config error), `last_sent_at` was ALREADY committed, so the very breach the
//     send failed to report would go quiet for a full REPEAT_MINUTES — the worst possible moment
//     for silence.
//   ★★ SO EACH IMMEDIATE CHECK GETS ITS OWN TRANSACTION: BEGIN → alert_transition() → (send, only
//      if the verdict is alert/recovered) → COMMIT. A thrown send ROLLS BACK that check's row —
//      undoing the INSERT/UPDATE `alert_transition` just made — and rethrows, so the NEXT run of
//      `watchSystem` sees the same problem as still-new and tries again immediately, not 60
//      minutes from now.
//   ★ CHECKS ALREADY COMMITTED IN THIS SAME RUN STAY COMMITTED — each check is its own transaction,
//     not one covering the whole batch — but the loop STOPS at the first send failure and rethrows
//     rather than trying the remaining checks, so `watchSystem`'s try/catch (tasks.mjs) sees one
//     clear error naming what failed rather than a silently-incomplete round.
//
// ★★★ Stage 3 Task 6 fix round 1 — THE PLATFORM FACT DOES NOT DEPEND ON EMAIL. This used to throw
//     before the loop when KEYSTONE_ALERT_EMAIL was unset, so an environment with no alert address
//     recorded no health.check_failed / health.check_recovered either: the operator's list went
//     silent exactly where nobody was being emailed. Now every immediate check still runs
//     `alert_transition` and records its fact; only the SEND is skipped. The missing address is
//     still an error — thrown AFTER the loop, once the facts are committed — so watch_system keeps
//     logging "could not send alerts" (a watcher that cannot alert must say so).
//   ★ Consequence, stated: alert_state advances while unaddressed, so once an address is set a
//     problem that is already open is emailed as the 60-minute reminder ('repeat' still sends),
//     not immediately.
export async function notifyTransitions(checks, { query, send, env = process.env } = {}) {
  const to = platformAlertTo(env);
  const canEmail = Boolean(to && to.includes("@")) && mayEmailFor(env);
  const addressMissing = mayEmailFor(env) && !(to && to.includes("@"));
  const deliver = send ?? ((m) => sendViaResend(m, { env }));
  const out = [];
  for (const c of checks) {
    if (!RECORDED_KEYS.includes(c.key)) continue;
    await query("BEGIN");
    try {
      const { rows } = await query("SELECT keystone_meta.alert_transition($1,$2,$3) AS kind", [c.key, c.state, REPEAT_MINUTES]);
      const kind = rows[0].kind;
      // ★★ Stage 3 Task 6 (spec 02 §2.11) — a NEW problem and a recovery are PLATFORM FACTS, recorded
      //    in THIS transaction: if the email below throws, the fact rolls back with the alert row and
      //    the retry records it exactly once. A reminder ('repeat', 0138) is not a new fact.
      await recordHealthTransition(query, c, kind);
      // ★ "recovered" is recorded (recordHealthTransition above) but never emailed — a person is only interrupted for a problem, never to be told it ended.
      if (kind !== "quiet" && kind !== "recovered" && canEmail && IMMEDIATE_KEYS.includes(c.key)) {
        const envName = env.KEYSTONE_ENVIRONMENT ?? "unknown";
        const subject = `Workbench ${envName}: ${c.label} needs attention`;
        // KEYSTONE_ALERT_EMAIL may name more than one address, separated by commas (launch night: alerts@ and hello@): each gets its own message
        let lastRouted = null;
        for (const one of String(to).split(/[;,]\s*/).filter((x) => x.includes("@"))) {
          const routed = redirectForEnvironment({ to: one, subject }, env);
          lastRouted = routed;
          await deliverOrThrow(deliver, { to: routed.to, from: sendingAddress(env), subject: routed.subject, text: `${c.label}: ${c.detail}\n\nPlatform → Health shows every check.` });
        }
        out.push({ key: c.key, kind });
      }
      await query("COMMIT");
    } catch (err) {
      await query("ROLLBACK");
      throw err;
    }
  }
  if (addressMissing) throw new Error("KEYSTONE_ALERT_EMAIL is not set — health problems cannot reach a person (platform facts were still recorded)");
  return out;
}
