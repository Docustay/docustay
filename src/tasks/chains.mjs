// @ts-check
/**
 * THE TASK CHAINS — P20.3, ADD3-1's table as DATA.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ WHAT A CHAIN IS. An outbox event OPENS a task; a later outbox event CLOSES it. Nothing else in
 *     this file happens. The whole value is that both halves are declared in ONE place, next to each
 *     other, because the failure ADD3-1 names — *"a task that outlives its subject is the defect to
 *     hunt"* — is precisely what you get when an opener is written and its closer is forgotten.
 *     Two topics in two files cannot be reviewed; five rows in one table can.
 *
 * ★★★ AND THE TABLE IS WHERE THE GAP IS VISIBLE. Two of ADD3-1's five chains have NO CLOSING TOPIC —
 *     their closers are described in prose ("note document created", "new package purchased"). Those
 *     two are declared here with `closesOn: null` and an explicit reason, so a reader can see that the
 *     product knows they are open-ended rather than discovering it when a task never clears. ★ A chain
 *     with a null closer is still worth creating: it is closed by a HUMAN, `closed_reason='manual'`,
 *     which is a legitimate ending. What is NOT legitimate is pretending a closer exists.
 *
 * ★★ WHY A SEPARATE MODULE FROM `src/queue/tasks.mjs`. That file is the graphile-worker task list —
 *    the things the RUNNER executes. This is a mapping table the dispatcher consults. Keeping them
 *    apart means the chain table can be imported and asserted by a gate without starting a worker,
 *    which is the difference between a testable rule and one you have to deploy to inspect.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ STAGE 3 TASK 3 — `title` IS NOW `async (ev, tx) => string`, NOT `(ev) => string`.
 *
 *     Every `title` below used to read a name straight off `ev.payload` — `person_name`,
 *     `client_name`, `task_title` — and every one of those was, or would have been, refused by
 *     `emit()`'s new payload lint (§2.4: no names, no free text, ever). The rule's own answer is
 *     "listeners that need a name read it from the current record at read time" — so `title` now
 *     takes the chain's own `tx` (the dispatcher's live tenant transaction, already open when
 *     `applyChains` runs) and queries the record itself, the same way `booking/attendance.mjs`
 *     already did for the payload field it used to populate.
 *   ★ `applyChains` (`src/tasks/writes.mjs`) is the one caller and now does `await chain.title(ev, tx)`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { RUN_FACTS } from "../run/blocked.mjs";
import { asViewer } from "../db/viewer.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { instanceById } from "../documents/api.mjs";

// ★ STAGE 3 TASK 3 FIX 1, REVIEW M6 — the one `asViewer`, from the leaf module both callers share
//   (it was a copied helper here; see `src/db/viewer.mjs` for why a leaf breaks the cycle).

/**
 * ★★ EVERY TOPIC NAMED HERE MUST EXIST IN `TOPICS`, AND THAT IS ASSERTED, NOT ASSUMED —
 *    see `assertChainTopicsAreCatalogued()` at the bottom, which the gate calls.
 *    Six of these nine did not exist before migration 0054 (P20.3a). If this table had been written
 *    first, four of the five chains would have been silent no-ops: the opener never fires, so no task
 *    is ever created, and a Tasks screen that is empty because nothing can reach it looks exactly like
 *    a Tasks screen that is empty because there is no work.
 */
export const TASK_CHAINS = Object.freeze([
  {
    key: "respond_to_lead",
    opensOn: "forms.form.submitted",
    subjectType: "person",
    // ★ The form submission is ABOUT a person; the task is about that person, not about the form.
    //   A task whose subject is a form row cannot be opened from the person's record page, which is
    //   where a coach actually works.
    subjectFrom: (ev) => ev.payload?.person_id ?? null,
    // ★★★ STAGE 3 TASK 3 — `person_name` DROPPED FROM THE PAYLOAD (it was free text under an
    //   unbanned key, but a name all the same). The current `app_user.display_name` is read
    //   instead, by the same id `subjectFrom` above already resolves.
    title: async (ev, tx) => {
      const id = ev.payload?.person_id ?? null;
      const name = id
        ? (await run(tx, db.selectFrom("keystone.app_user").select(["display_name"]).where("id", "=", id))).rows[0]?.display_name
        : null;
      return `Respond to new lead${name ? `: ${name}` : ""}`;
    },
    closesOn: "people.person.stage_changed",
    // ★★★ `stage_changed` AND NOT `updated`, and this is the reason the topic is separate (0054's note).
    //     "Respond to the lead" is done when the lead MOVES — not when somebody fixes their phone
    //     number. Closing on `updated` would clear the task on any edit, which is worse than never
    //     closing it: the work disappears from the screen without being done.
    closesWhy: "the person's pipeline stage moved, which is what responding to a lead accomplishes",
    automationKey: "forms.lead_task",
  },
  {
    key: "chase_signature",
    opensOn: "documents.document.sent",
    subjectType: "document",
    subjectFrom: (ev) => ev.subject_id ?? null,
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ STAGE 3 TASK 3 — `title` (the document's) IS A BANNED PAYLOAD KEY OUTRIGHT (§2.4), and was
    //     never actually populated on `documents.document.sent`'s own emit anyway (a pre-existing
    //     gap, not something this task's payload removal caused).
    //   ★★★ [EXECUTED, found by driving this through the REAL dispatcher, not just calling
    //       `title()` directly] a naive `tx.query('SELECT title FROM document_instance …')` returns
    //       ZERO ROWS here — `document_instance`'s `tenant_isolation` policy calls
    //       `document_is_visible()`, which fails closed on `current_user_id() IS NULL`, and the
    //       DISPATCHER'S `tx` HAS NO VIEWER (0112's own header: "A WORKER HAS NO USER"). Only a task
    //       opens THIS chain, and only `documents.document.sent` opens it — `title()` is never
    //       actually called for the closers, since `applyChains` sets a task's title once, at open
    //       time. So the one call that matters must read AS THE SENDER, exactly like the
    //       `documents.document.sent` TOPIC_HANDLERS a few files over already does.
    //   ★ `asViewer` comes from `src/db/viewer.mjs` (fix 1, M6) — the same function the
    //     `documents.document.sent` handler uses, not a copy of it.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    title: async (ev, tx) => {
      const id = ev.subject_id ?? null;
      const sentBy = ev.payload?.sent_by ?? null;
      if (!id || !sentBy) return "Chase signature";
      // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
      const row = await asViewer(tx, sentBy, async () => instanceById(tx, { instanceId: id }));
      return `Chase signature${row?.title ? ` on ${row.title}` : ""}`;
    },
    // ★★★ TWO CLOSERS, AND THE SECOND ONE IS THE POINT OF P20.3a. `executed` existed all along;
    //     `expired` did NOT, and it is the branch THAT REQUIRES NOBODY TO ACT. A document that simply
    //     lapses emitted nothing, so this task — the only chain that was buildable before 0054 — was
    //     exactly the one ADD3-1's closing warning described: it would have sat on the screen forever
    //     for every document nobody ever signed.
    //   ★ They are DISTINCT from `declined`: declining is an act by a party and is already its own
    //     topic; expiring is the absence of one. Collapsing them records a refusal nobody made.
    closesOn: ["documents.document.executed", "documents.document.expired"],
    closesWhy: "the instrument reached a terminal state — signed by everyone, or lapsed unsigned",
  },
  {
    key: "write_session_note",
    opensOn: "booking.booking.completed",
    subjectType: "booking",
    subjectFrom: (ev) => ev.subject_id ?? null,
    // ★★★ STAGE 3 TASK 3 — `client_name` DROPPED FROM `booking.booking.completed`'s payload (§2.4:
    //   no names). The CURRENT client participant is read instead, the same query
    //   `booking/attendance.mjs` used to run to populate the payload field this replaces.
    title: async (ev, tx) => {
      const id = ev.subject_id ?? null;
      const row = id
        ? (await run(tx, db.selectFrom("keystone.booking_participant").select(["display_name"]).where("booking_id", "=", id).where("party", "<>", "coach").orderBy("display_name", "asc").limit(1))).rows[0]
        : null;
      return `Write the session note${row?.display_name ? ` for ${row.display_name}` : ""}`;
    },
    // ★★★ NO CLOSING TOPIC, DECLARED AS NULL RATHER THAN GUESSED. ADD3-1's own column reads "note
    //     document created — prose, not a topic". There IS no event for "a note document was created
    //     for this booking": `documents.document.created` (if it fired) knows nothing about which
    //     booking it belongs to, so closing on it would close this task when ANY document was created.
    //   ★ Recording it as `null` + a reason is the honest shape. Inventing a closer that fires on the
    //     wrong event is worse than a manual close, because the task would clear without the note
    //     being written and nobody would ever know.
    closesOn: null,
    closesWhy: null,
    manualCloseReason:
      "there is no event that links a created note to the booking it documents. A coach closes this " +
      "one by hand (closed_reason='manual'). ★ Wiring a document→booking link is NOT in P20.3's scope; " +
      "it is recorded here as the known cost of that decision.",
  },
  {
    key: "chase_the_grant",
    opensOn: "run.item.blocked",
    subjectType: "run_schedule_item",
    subjectFrom: (ev) => ev.subject_id ?? null,
    // ★★★ THE TITLE COMES FROM THE PAYLOAD'S FACT, NOT FROM A FIXED STRING (P20.9a). Three of the
    //     five facts block an item, and each needs a DIFFERENT HUMAN ACTION: ask for access, ask to
    //     re-consent, re-link a property. A single "chase the access grant" for all three is the
    //     screen lying — and telling a client to re-consent when they removed one property is, in
    //     P20.9a's words, "how you lose them".
    //   ★★★ STAGE 3 TASK 3 — `task_title`/`screen_text` DROPPED FROM THE PAYLOAD (free-text
    //      sentences, §2.4/§12). What the emitter (`src/run/schedule.mjs`) still puts on the event is
    //      `fact` — the ENUM KEY into `RUN_FACTS` (`src/run/blocked.mjs`), which is the one place
    //      the actual words live. Looking the words up here from the SAME table the emitter reads
    //      means the two can never disagree, which "freeze the sentence into the event" could not
    //      promise — a later wording change to `RUN_FACTS` would have left old events quoting stale
    //      text forever (§11: existing events are never rewritten).
    //   ★ No `tx` needed for this one: `RUN_FACTS` is a fixed, in-process table, not a database read.
    title: async (ev) => {
      const fact = RUN_FACTS[ev.payload?.fact];
      return fact?.taskTitle
        ?? `Restore access${ev.payload?.service ? ` for ${ev.payload.service}` : ""}`;
    },
    closesOn: "run.access.granted",
    // ★★ THIS IS THE CHAIN THAT PROTECTS REVENUE, NOT JUST TIDINESS. P20.9: no grant ⇒ no job ⇒ the
    //    item is BILLED AND NOT DELIVERABLE, and billing does not pause. So the task is the only thing
    //    standing between a client being charged and nobody noticing the work cannot be done.
    closesWhy: "the access this item needs was granted, so the blocked work can run",
  },
  {
    key: "offer_repurchase",
    opensOn: "booking.entitlement.exhausted",
    subjectType: "entitlement",
    subjectFrom: (ev) => ev.subject_id ?? null,
    // ★★★ STAGE 3 TASK 3 — this read `ev.payload?.client_name`, a key `src/time/due.mjs`'s
    //   `booking.entitlement.exhausted` emit never actually populated (a pre-existing gap, not
    //   something this task's payload removal caused) — so the title always fell back to the
    //   generic sentence below. Fixed properly rather than left dead now that every other title in
    //   this file reads its name from a live query: `owner_user_id` is already on the payload (an
    //   id, not a name) and names the entitlement's owner.
    title: async (ev, tx) => {
      const ownerId = ev.payload?.owner_user_id ?? null;
      const row = ownerId
        ? (await run(tx, db.selectFrom("keystone.app_user").select(["display_name"]).where("id", "=", ownerId))).rows[0]
        : null;
      return `Offer a repurchase${row?.display_name ? ` to ${row.display_name}` : ""} — credits are used up`;
    },
    // ★★★ THE SECOND NULL CLOSER. ADD3-1: "new package purchased — prose, not a topic". A purchase
    //     emits a money topic about an INVOICE or a PAYMENT; nothing ties it back to the exhausted
    //     entitlement, so there is no correct event to close on. Declared, not faked.
    closesOn: null,
    closesWhy: null,
    manualCloseReason:
      "a purchase emits a money event about an invoice or payment, with no link back to the exhausted " +
      "entitlement, so no event can correctly close this. Closed by hand when the client re-buys or " +
      "declines — and 'declined' is a real outcome that must still clear the task.",
  },
]);

/** ★ Every topic that OPENS a chain, for the dispatcher's fast path. */
export const OPENING_TOPICS = Object.freeze(TASK_CHAINS.map((c) => c.opensOn));

/**
 * ★★ CLOSING TOPIC → the chains it closes. Built as a MAP because one topic can close more than one
 *    chain, and because the dispatcher must not scan five rows per event.
 *  ★ A chain with `closesOn: null` contributes nothing here, by construction — so a null closer cannot
 *    accidentally match "no topic" and close on every event, which is the bug this shape forecloses.
 */
export const CLOSING_TOPICS = Object.freeze(
  TASK_CHAINS.reduce((acc, chain) => {
    const closers = chain.closesOn == null
      ? []
      : Array.isArray(chain.closesOn) ? chain.closesOn : [chain.closesOn];
    for (const topic of closers) (acc[topic] ??= []).push(chain);
    return acc;
  }, {}));

/**
 * ★★★ STAGE 3 TASK 9 — SUBJECT CLOSERS (spec 02 §6: "booking.booking.cancelled … closes session tasks").
 *     A chain closer closes the tasks ONE chain opened. A subject closer is a different rule: the subject
 *     itself is over, so EVERY open task on it closes, whichever chain (or future feature) opened it —
 *     a task to prepare for, chase or review a session that is not happening is ADD3-1's "task that
 *     outlives its subject". Kept as its own table so `write_session_note` stays honestly manual-close
 *     (its reason — no note→booking link — is unchanged; a completed session cannot be cancelled,
 *     `cancelBookingByRequest`), and so MANUAL_CLOSE_ONLY still counts what it says it counts.
 *   ★ Closed with closed_reason='event' and closed_by_event_id = the closing event (task_closed_shape, 0055).
 */
export const SUBJECT_CLOSERS = Object.freeze({
  "booking.booking.cancelled": Object.freeze({
    subjectType: "booking",
    why: "the session was cancelled, so no task about it is still work",
  }),
});

/**
 * ★★★ THE TABLE DESCRIBES TOPICS THAT MUST ACTUALLY EXIST, AND THIS IS HOW WE KNOW.
 *
 * A chain naming a topic outside `TOPICS` is not a small mistake: `emit()` would refuse the opener, so
 * the chain would never fire, and the only symptom is an empty Tasks screen — indistinguishable from
 * "there is no work". Before 0054 that was the state of FOUR of these five chains.
 *
 * ★ It takes `TOPICS` as an argument rather than importing it, so a gate can run this against a
 *   deliberately tampered catalogue and confirm the check is not vacuous.
 */
export function assertChainTopicsAreCatalogued(TOPICS) {
  const catalogued = new Set(Object.values(TOPICS).flat());
  const problems = [];
  for (const chain of TASK_CHAINS) {
    if (!catalogued.has(chain.opensOn)) {
      problems.push(
        `chain "${chain.key}" opens on "${chain.opensOn}", which is NOT in TOPICS — the opener would be ` +
        `refused by emit(), so this chain can never create a task and the Tasks screen would be empty ` +
        `for a reason nobody could see`);
    }
    const closers = chain.closesOn == null
      ? [] : Array.isArray(chain.closesOn) ? chain.closesOn : [chain.closesOn];
    for (const topic of closers) {
      if (!catalogued.has(topic)) {
        problems.push(
          `chain "${chain.key}" closes on "${topic}", which is NOT in TOPICS — the task would be created ` +
          `and then never closed, which is exactly ADD3-1's "a task that outlives its subject"`);
      }
    }
  }
  for (const topic of Object.keys(SUBJECT_CLOSERS)) {
    if (!catalogued.has(topic)) {
      problems.push(`subject closer "${topic}" is NOT in TOPICS — it could never fire, and its subject's tasks would outlive it`);
    }
  }
  return problems;
}

/**
 * ★★ THE CHAINS THAT HAVE NO CLOSING EVENT, NAMED. Exported so a gate can assert the count is TWO and
 *    that each carries a reason — not so the number can be looked up, but so that a THIRD one appearing
 *    is a red gate rather than a quiet drift toward "everything is closed by hand".
 */
export const MANUAL_CLOSE_ONLY = Object.freeze(
  TASK_CHAINS.filter((c) => c.closesOn == null).map((c) => c.key));

/**
 * ★★★ STAGE 3 TASK 2 — THE CHAIN TABLE'S OWN `subjectType` MUST BE A MEMBER OF THE SAME CLOSED
 *     VOCABULARY EVENT.SUBJECT_TYPE USES (`src/events/topics.mjs` `SUBJECT_TYPES`).
 *
 * ★★ WHY THIS WAS ITS OWN, THIRD, UNCOORDINATED VOCABULARY (recon §3). `tasks/writes.mjs`'s
 *    `applyChains` writes the OPEN/CLOSE task rows' `subject_type` from `chain.subjectType` taken
 *    as a literal from THIS table — never derived from or checked against the event's own
 *    `subject_type` column. So a chain naming a value outside `SUBJECT_TYPES` would be internally
 *    consistent (open and close both read the same literal from this same table and so still match
 *    each other) while quietly drawing `keystone.task.subject_type` from a vocabulary
 *    `keystone.event.subject_type` does not share — invisible until something joins the two columns
 *    for the same conceptual record, which is exactly the shape F474 already produced once for
 *    `app_user`/`user`/`document_instance`.
 *
 * ★ Takes `SUBJECT_TYPES` as an argument, exactly as `assertChainTopicsAreCatalogued` takes `TOPICS`
 *   above, so a gate can run this against a deliberately tampered vocabulary and confirm the check
 *   is not vacuous.
 */
export function assertChainSubjectTypesAreVocabulary(SUBJECT_TYPES) {
  const allowed = new Set(SUBJECT_TYPES);
  const problems = [];
  for (const chain of TASK_CHAINS) {
    if (!allowed.has(chain.subjectType)) {
      problems.push(
        `chain "${chain.key}" declares subjectType "${chain.subjectType}", which is NOT in ` +
        `SUBJECT_TYPES — the task rows this chain opens/closes would carry a subject_type the ` +
        `event table's own vocabulary does not recognise`);
    }
  }
  return problems;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ P8.4 — EVERY CHAIN TOPIC MUST HAVE A **REACHABLE PRODUCER**, NOT MERELY A CATALOGUE ENTRY.
 *
 *   `assertChainTopicsAreCatalogued` above asks whether a topic EXISTS in `TOPICS`. It passes for
 *   all nine chain topics — and it passed while FOUR of the five chains were dead, because a topic
 *   can be perfectly catalogued and emitted by nothing at all.
 *
 *   ★★★ THE TWO FAILURES LOOK IDENTICAL FROM THE TASKS SCREEN. A chain whose opener is not in the
 *       catalogue and a chain whose opener is catalogued but never emitted both produce **no task**,
 *       and "no task" is indistinguishable from "there is no work". That is why this exists as a
 *       SECOND assertion rather than a stricter version of the first: they fail for different
 *       reasons and a reader needs to be told which.
 *
 *   ★★ IT TAKES THE PRODUCER SET AS AN ARGUMENT, exactly as the catalogue check takes `TOPICS` —
 *      "so a gate can run this against a deliberately tampered catalogue and confirm the check is
 *      not vacuous". Application code does not scan the filesystem; the gate builds the index and
 *      hands it in.
 *
 *   ★ A CLOSER WITH NO PRODUCER IS WORSE THAN AN OPENER WITH NONE, and the messages say so. An
 *     opener that cannot fire leaves a screen empty; a closer that cannot fire leaves tasks
 *     ACCUMULATING with no way to clear them — the "task that outlives its subject" ADD3-1 names.
 *     `closesOn: null` is exempt: it is a DECLARED decision with a reason, not an absence.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * @param {Set<string>|string[]} produced topics some reachable module in `src/` actually emits
 * @returns {string[]} problems, empty when every chain topic can fire
 */
export function assertChainTopicsHaveProducers(produced) {
  const canFire = produced instanceof Set ? produced : new Set(produced);
  const problems = [];
  for (const chain of TASK_CHAINS) {
    if (!canFire.has(chain.opensOn)) {
      problems.push(
        `chain "${chain.key}" opens on "${chain.opensOn}", which is CATALOGUED BUT NEVER EMITTED by ` +
        `any reachable module — so this chain can never create a task, and the Tasks screen shows ` +
        `"no work" for a reason nobody can see`);
    }
    const closers = chain.closesOn == null
      ? [] : Array.isArray(chain.closesOn) ? chain.closesOn : [chain.closesOn];
    for (const topic of closers) {
      if (!canFire.has(topic)) {
        problems.push(
          `chain "${chain.key}" closes on "${topic}", which is CATALOGUED BUT NEVER EMITTED — the ` +
          `chain opens and its tasks ACCUMULATE WITH NO WAY TO CLEAR THEM. ★ This is worse than an ` +
          `opener with no producer: that leaves a screen empty, this fills it with work nobody can ` +
          `finish`);
      }
    }
  }
  return problems;
}
