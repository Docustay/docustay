// REQUIRE REVIEW (the maintainer, 7 Oct 2026; setting ai.require_review). A document that carries text the assistant wrote cannot be sent until its sender has said they read it. The fact is read from what is already recorded, never from the text:
//   · assistant-written = a chat proposal of kind changes / created / template that was accepted for this draft, or an accepted/created entry of the older writer (kinds draft, edit) in the action log
//   · read = the sender pressed "I have read it" AFTER the latest of those (a later assistant change, or a revise that makes a new draft id, asks again)
// The press is an entry in the AI action log (action confirmed, note review_ack): who, when, which draft. Never the text.
import { getDocumentSetting } from "../settings.mjs";
import { logAiAction } from "../engine/ai/actionLog.mjs";

const REVIEW_ACK_NOTE = "review_ack";
export const REVIEW_PROBLEM = "The assistant wrote part of this document. Read it on the Check step and press “I have read it” before sending.";

/** { required, aiWritten, reviewed, needed }  needed = required && aiWritten && !reviewed */
export async function reviewState(tx, { instanceId }) {
  const required = (await getDocumentSetting(tx, "ai.require_review").catch(() => true)) !== false;
  const { rows: [r] } = await tx.query(
    `SELECT
       (SELECT max(t) FROM (
          SELECT coalesce(decided_at, created_at) AS t FROM keystone.document_chat_proposal WHERE document_id = $1 AND state = 'accepted' AND kind IN ('changes','created','template')
          UNION ALL
          SELECT at FROM keystone.document_ai_action WHERE target_type = 'document' AND target_id = $1 AND kind IN ('draft','edit') AND action IN ('accepted','created')) x) AS ai_at,
       (SELECT max(at) FROM keystone.document_ai_action WHERE target_type = 'document' AND target_id = $1 AND action = 'confirmed' AND note = $2) AS ack_at`,
    [instanceId, REVIEW_ACK_NOTE]);
  const aiWritten = Boolean(r?.ai_at);
  const reviewed = aiWritten && Boolean(r.ack_at) && new Date(r.ack_at) > new Date(r.ai_at);
  return { required, aiWritten, reviewed, needed: required && aiWritten && !reviewed };
}

/** The sender says they read it. Only meaningful when the assistant wrote part of the draft. */
export async function acknowledgeReview(tx, { tenantId, actorUserId, instanceId }) {
  const s = await reviewState(tx, { instanceId });
  if (!s.aiWritten) return { ...s, acknowledged: false };
  await logAiAction(tx, { tenantId, actorUserId, kind: "chat", action: "confirmed", targetType: "document", targetId: instanceId, note: REVIEW_ACK_NOTE });
  return { ...(await reviewState(tx, { instanceId })), acknowledged: true };
}
