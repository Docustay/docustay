// src/webhooks/enrich.mjs — WHAT A SUBJECT CAN ADD TO ITS OWN EVENTS AT DELIVERY (FP-C1, 7 Oct 2026).
// A domain registers one function per subject type (`registerEventEnricher`); when an event is read for delivery, replay or retry, `enrichEvent` merges what that function returns into the event's payload.
// This is how a developer's own reference (metadata, externalId) reaches every document webhook without the webhook layer naming any Documents table. An enricher that throws changes nothing: delivery goes on without it.
const enrichers = new Map();

export function registerEventEnricher(subjectType, fn) { enrichers.set(subjectType, fn); }

export async function enrichEvent(tx, event) {
  const fn = event ? enrichers.get(event.subject_type) : null;
  if (!fn) return event;
  try {
    const extra = await fn(tx, event);
    if (!extra || typeof extra !== "object") return event;
    // `$omit`: keys the subject says a receiver outside the workspace must not see (internal person ids). Removed from the delivered copy only; the stored event is unchanged.
    const { $omit = [], ...add } = extra; const payload = { ...(event.payload ?? {}), ...add }; for (const k of $omit) delete payload[k];
    return { ...event, payload };
  } catch { return event; }
}
