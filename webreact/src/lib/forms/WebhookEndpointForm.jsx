import { useEffect, useRef, useState } from "react";
import { api, ApiError, request } from "@/lib/api.js";
import WebhookEndpointFormModal1Modal from "./WebhookEndpointFormModal1Modal.jsx";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * A12.1 — THE "ADD ENDPOINT" SURFACE. **ONE DRAWER, 83 TOPICS.**
 *
 * ★★★ THIS IS THE HIGHEST VALUE-PER-LINE ITEM IN THE PLAN, AND THE REASON IS THAT EVERYTHING
 *     BEHIND IT IS ALREADY FINISHED. `POST /api/developer/webhook-endpoints` has existed since
 *     P8.5 — admin-guarded, validating every topic against `ALL_TOPICS`, minting a `whsec_…`,
 *     returning it exactly once, storing a fingerprint, emitting an audit event. And the drain's
 *     webhook fan-out is **UNIVERSAL**: `hasSubscribers → addJob("deliver_webhooks")` runs for
 *     EVERY topic, handled or not, including `booking.booking.completed`.
 *   ★★★ SO n8n OWNING ANY OF THE 79 HANDLER-LESS TOPICS REQUIRES **NO PIPELINE WORK AT ALL** —
 *       only a `webhook_endpoint` row. And nothing in either generation could create one: the
 *       route had ZERO references in `web/src` and ZERO in `webui/src` (F398), while the screen's
 *       own empty state said **"Add endpoint"** over a `?new=1` href that opened nothing (F401).
 *       **The screen told you to do the one thing the product could not do.** This file is the
 *       door, and it is about two hundred lines.
 *
 * ★★ THE TOPICS ARE IMPORTED, NEVER RE-DECLARED. `$keystone/events/topics.mjs` is the closed set
 *    the SERVER validates against, split out of `outbox.mjs` at A12.1 precisely so a browser can
 *    read it (that file imports `pg`). A hand-copied list here would be DUPLICATE-TRUTH on the
 *    exact object that has already produced it once — and the symptom would be an endpoint
 *    subscribed to a topic that silently does not exist, i.e. configured-looking and dead.
 *
 * ★★★ AND THIS SURFACE DELIBERATELY DOES **NOT** CLOSE ON SUCCESS. Every other surface in the
 *     plan closes, toasts and refetches. This one cannot: the response carries `shown_once: true`
 *     and the secret exists NOWHERE ELSE — the row holds a sealed envelope and a fingerprint, and
 *     there is no route in this product that can produce the plaintext again. Closing on success
 *     would destroy the only copy. So success SWAPS THE BODY for the secret panel, and the person
 *     dismisses it themselves once they have copied it.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

export default function WebhookEndpointForm({ onDone = null, onCancel = null }) {
  // ★ the maintainer, 28 Sep 2026 — TOPICS is read from `GET /api/developer/webhook-topics` at runtime, not a
  //   static import: the frontend bundle cannot import `src/events/topics.mjs` (a backend-only
  //   module — it imports `pg`), and a hand-copied client list would be exactly the DUPLICATE-
  //   TRUTH this file's own header already warns against. The route re-exports the SAME `TOPICS`
  //   object the server validates subscriptions against, so this stays one source either way.
  const [topics, setTopics] = useState(null);
  const [topicsError, setTopicsError] = useState(null);
  // ★ Section order is the vocabulary's own. Re-sorting alphabetically here would put `accounts`
  //   above `documents` and quietly disagree with every other list of sections in the product.
  const GROUPS = topics ? Object.entries(topics).map(([section, ts]) => ({ section, topics: ts })) : [];

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null); // ★ the secret panel's data — see the header
  const [copied, setCopied] = useState(false);
  const firstFieldRef = useRef(null);

  useEffect(() => { firstFieldRef.current?.focus(); }, []);
  useEffect(() => {
    request("/api/developer/webhook-topics")
      .then((r) => setTopics(r.topics))
      .catch((err) => setTopicsError(err instanceof ApiError ? err.message : "Could not load the topic list — try again"));
  }, []);

  // ★★ 83 TOPICS IS TOO MANY TO SCAN, SO IT FILTERS. A picker that shows everything and offers no
  //    way to find one item is the reason people subscribe to the wrong thing.
  const q = filter.trim().toLowerCase();
  const visible = GROUPS
    .map((g) => ({ ...g, topics: q ? g.topics.filter((t) => t.toLowerCase().includes(q)) : g.topics }))
    .filter((g) => g.topics.length > 0);

  const count = chosen.size;
  // ★★★ AN ENDPOINT SUBSCRIBED TO NOTHING IS THE FAILURE THIS WHOLE SURFACE EXISTS TO END — it
  //     would be created, listed, look configured, and receive nothing forever. The ROUTE does not
  //     refuse it (it only refuses UNKNOWN topics), so the refusal belongs here. ★ It is expressed
  //     as a DISABLED BUTTON WITH A VISIBLE REASON, never as a fake error message after the fact:
  //     inventing a server-shaped error the server did not send is the re-wording this codebase
  //     forbids, pointed at ourselves.
  const ready = count > 0 && url.trim().length > 0 && name.trim().length > 0;

  function toggle(topic) {
    // ★ React state updates track value reassignment, not Set mutation — a bare `chosen.add()` updates nothing.
    const next = new Set(chosen);
    next.has(topic) ? next.delete(topic) : next.add(topic);
    setChosen(next);
  }

  function toggleSection(g) {
    const next = new Set(chosen);
    const all = g.topics.every((t) => next.has(t));
    for (const t of g.topics) { all ? next.delete(t) : next.add(t); }
    setChosen(next);
  }

  const sectionState = (g) => {
    const on = g.topics.filter((t) => chosen.has(t)).length;
    return on === 0 ? "none" : on === g.topics.length ? "all" : "some";
  };

  async function submit(e) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api.createWebhookEndpoint({
        url: url.trim(),
        name: name.trim(),
        // ★ Sorted so the stored array reads the way the picker does. The server does not care;
        //   a person reading the row later does.
        eventTypes: [...chosen].sort(),
      });
      // ★★★ NOT `onDone()` YET. See the header — closing here would destroy the only copy of the
      //     secret. `onDone` fires from the secret panel's own dismiss.
      setCreated(made);
    } catch (err) {
      // ★★ THE SERVER'S OWN MESSAGE, VERBATIM. Its refusal for an unknown topic NAMES the topic and
      //    explains that an endpoint subscribed to one "would receive nothing and look configured".
      //    No re-wording can improve on that, and any re-wording loses the name.
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(created.secret);
      setCopied(true);
    } catch {
      // ★ Clipboard access can be refused, and there is no sky-is-falling here: the secret is on
      //   screen and selectable. Saying nothing would be worse than saying "select it yourself".
      setCopied(false);
      setError("Could not reach the clipboard. Select the secret above and copy it manually.");
    }
  }

  // ★★ DISMISSING THE SECRET PANEL IS THE WRITE'S REAL END. It refetches (tier 1) — the new row has
  //    to appear in the list behind it — and only then closes.
  function finish() { onDone?.(); }

  // ★★ ESCAPE CLOSES — a modal with no keyboard exit is a trap, and axe does not catch it because
  //     nothing about the markup is wrong. ★★★ EXCEPT WHILE THE SECRET IS SHOWING: a stray Escape
  //     there destroys the only copy of a credential. That is the one place this contract bends, and
  //     it bends deliberately.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "Escape" || busy) return;
      if (created) return;
      onCancel?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, created, onCancel]);

  // ★ A click on the SCRIM closes; a click inside does not. Same carve-out for the secret panel,
  //     for the same reason — this is the single worst surface in the product to lose to a stray
  //     click, because there is no route that can show the value again.
  const handleScrimClick = (e) => {
    if (e.target === e.currentTarget && !busy && !created) onCancel?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim"
         data-testid="webhook-form-scrim" role="presentation" onClick={handleScrimClick}>
      <WebhookEndpointFormModal1Modal
        open={true}
        onOpenChange={() => {}}
        onCancel={onCancel}
        name={name}
        url={url}
        filter={filter}
        chosen={chosen}
        busy={busy}
        error={error}
        created={created}
        copied={copied}
        firstField={firstFieldRef}
        visible={visible}
        count={count}
        ready={ready}
        toggle={toggle}
        toggleSection={toggleSection}
        sectionState={sectionState}
        submit={submit}
        copySecret={copySecret}
        finish={finish}
      />
    </div>
  );
}
