// B11 — THE AI ACTION LOG (keystone.document_ai_action, append-only). It records what the assistant proposed and what a person did with it: counts, who, which model, how many tokens. It NEVER holds the prompt or the document text; `note` is one of our own plain sentences.
const KINDS = ["draft", "edit", "fill", "chat"], ACTIONS = ["proposed", "failed", "accepted", "rejected", "undone", "created", "confirmed"];
const cleanCounts = (c) => Object.fromEntries(Object.entries(c ?? {}).filter(([k, v]) => /^[a-z_]{1,24}$/.test(k) && Number.isInteger(v) && v >= 0 && v <= 100000));

export async function logAiAction(tx, { tenantId, actorUserId = null, jobId = null, kind, action, targetType = null, targetId = null, counts = {}, provider = null, model = null, inputTokens = null, outputTokens = null, note = null }) {
  if (!KINDS.includes(kind) || !ACTIONS.includes(action)) throw new Error(`ai action log: unknown kind/action ${kind}/${action}`);
  await tx.query(
    `INSERT INTO keystone.document_ai_action (tenant_id, actor_user_id, job_id, kind, action, target_type, target_id, counts, provider, model, input_tokens, output_tokens, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`,
    [tenantId, actorUserId, jobId, kind, action, targetType, targetId, JSON.stringify(cleanCounts(counts)), provider, model, inputTokens, outputTokens, note ? String(note).slice(0, 300) : null]);
}

/** What the person did with a finished job: accepted n changes, rejected m. Only for a job of this workspace that finished; counts are whole numbers. */
export async function recordAiOutcome(tx, { tenantId, actorUserId, jobId, accepted = 0, rejected = 0, targetType = null, targetId = null, undone = false }) {
  const { rows: [job] } = await tx.query(`SELECT kind, state, provider, model FROM keystone.document_ai_job WHERE id = $1`, [jobId]);
  if (!job || job.state !== "done") return { ok: false };
  const base = { tenantId, actorUserId, jobId, kind: job.kind, targetType: targetType === "document" || targetType === "template" ? targetType : null, targetId: targetId || null, provider: job.provider, model: job.model };
  if (undone) await logAiAction(tx, { ...base, action: "undone", counts: { changes: accepted } });
  else {
    if (accepted > 0) await logAiAction(tx, { ...base, action: "accepted", counts: { changes: accepted } });
    if (rejected > 0) await logAiAction(tx, { ...base, action: "rejected", counts: { changes: rejected } });
  }
  return { ok: true };
}

export async function listAiActions(tx, { limit = 50 } = {}) {
  const { rows } = await tx.query(
    `SELECT a.id, a.at, a.kind, a.action, a.job_id, a.target_type, a.target_id, a.counts, a.provider, a.model, a.input_tokens, a.output_tokens, a.note, a.actor_user_id
       FROM keystone.document_ai_action a ORDER BY a.at DESC, a.id DESC LIMIT $1`, [Math.min(Math.max(Number(limit) || 50, 1), 200)]);
  return rows;
}
