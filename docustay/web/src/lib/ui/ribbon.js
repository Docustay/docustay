// The ribbon says where a document is, from TRUE data only (COMBINED-STYLE-SPEC sections 4 and 7). Pure: facts in, stages and a plain-words label out. No fields are invented;
// when a stage cannot be known the ribbon shows the nearest true one.
//   facts: { state, sentAt, openedCount, signedCount, totalCount, executedAt, nextName, openedBy, declined, expired, voided }
//   state is the document's own state: draft, sent, partially_signed, executed (or completed), declined, expired, voided/void/cancelled
export const STAGES = ["Sent", "Opened", "Signed", "Sealed"];
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const fmtDay = (d) => { const x = d ? new Date(d) : null; return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null; };   // in the viewer's own time zone, like every other date in the app

export function ribbonOf(f = {}, tr = (s) => s) {
  const st = String(f.state ?? "").toLowerCase();
  const total = num(f.totalCount), signed = num(f.signedCount), opened = num(f.openedCount);
  const sealed = st === "executed" || st === "completed" || Boolean(f.executedAt);
  const draft = st === "draft" || (!f.sentAt && !sealed && !["declined", "expired", "voided", "void", "cancelled"].includes(st));
  const ended = ["declined", "expired", "voided", "void", "cancelled"].includes(st) ? (st === "declined" ? "declined" : st === "expired" ? "expired" : "cancelled") : null;
  if (draft) return { kind: "draft", reached: 0, current: -1, sealed: false, ended: null, label: tr("Draft"), tone: "mute", stages: STAGES.map((name) => ({ name, state: "todo", sub: "" })) };
  let reached = 1;                                                        // sent
  if (opened > 0 || signed > 0) reached = 2;                              // opened (signing someone's own link means it was opened)
  if (signed > 0) reached = 3;
  if (sealed) reached = 4;
  const sealDay = fmtDay(f.executedAt);
  let label, tone = "info";
  if (ended) { label = ended === "declined" ? tr("Declined") : ended === "expired" ? tr("Expired") : tr("Cancelled"); tone = ended === "expired" ? "warn" : "bad"; }
  else if (sealed) { label = sealDay ? tr("Sealed {day}", { day: sealDay }) : tr("Sealed"); tone = "ok"; }
  else if (signed > 0) { label = tr("{signed} of {total} signed", { signed, total: Math.max(total, signed) }); tone = "info"; }
  else if (opened > 0) { label = f.openedBy ? tr("{name} opened it", { name: f.openedBy }) : tr("Opened"); }
  else { label = f.nextName ? tr("Waiting on {name}", { name: f.nextName }) : tr("Sent"); }
  const sub = [
    f.sentAt ? (fmtDay(f.sentAt) ?? "") : "",
    opened > 0 ? (f.openedBy ?? tr("{n} opened", { n: opened })) : (f.nextName ? tr("Waiting on {name}", { name: f.nextName }) : ""),
    signed > 0 ? tr("{signed} of {total}", { signed, total: Math.max(total, signed) }) : (opened > 0 && f.nextName ? tr("Next: {name}", { name: f.nextName }) : ""),
    sealed ? (sealDay ?? "") : (signed > 0 ? tr("When everyone has signed") : ""),
  ];
  const stages = STAGES.map((name, i) => ({ name, sub: sub[i], state: i < reached - (sealed ? 0 : 0) ? "done" : "todo" }));
  // the stage in progress is the first not done (never for a sealed or ended document)
  const current = sealed || ended ? -1 : Math.min(3, reached);
  if (current >= 0) stages[current] = { ...stages[current], state: "current" };
  if (reached === 3 && !sealed && !ended) { stages[2] = { ...stages[2], state: "current" }; stages[3] = { ...stages[3], state: "todo" }; }
  return { kind: sealed ? "sealed" : ended ? "ended" : "active", reached, current, sealed, ended, label, tone, stages };
}
