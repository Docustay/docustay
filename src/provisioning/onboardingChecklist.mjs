// P2.12 — ONBOARDING CHECKLIST: GROUPED BY OUTCOME, NEVER BY VENDOR. REAL DIAGNOSTICS.
//
// ★★★ GROUPED BY OUTCOME. A practice manager does not know what Stripe or Resend is and should
// never have to. They know whether they can take payments. A checklist that reads
// "Stripe: pending / Resend: pending / Forms: ok" is a list of OUR implementation details
// presented as THEIR homework — and its first effect is to teach them the product is broken.
//
// ★★ REAL DIAGNOSTICS, NOT A SPINNER. "Pending" is not a diagnostic. A row must say:
//     what is blocked · what still works · who has to act · what to do · where to do it
// ★ "Who has to act" is the one most often missing, and it is the one that decides whether the
// row ever gets finished: a tenant staring at a row that WE have to complete will wait forever,
// and so will we.

import { deriveCapabilities, CAPABILITY_MAP, Capability } from "./capabilities.mjs";

export const Actor = Object.freeze({
  TENANT: "you",        // the practice must do something
  PLATFORM: "us",       // Keystone staff must do something
  WAITING: "nobody",    // a timer — DNS propagation, a provider queue
});

// ★★★ PART 4.7 [TY, RULED 23 Sep 2026] — STEPS FILTER BY SHAPE. A run-only practice never sees
//     "add your first client"; a crm-only one never sees "connect Google Ads". Every capability
//     row is CRM-side (documents, money, forms, booking — a run-only practice never signs,
//     invoices or books anything) so ALL FIVE are hidden under 'run'. `REAL_STATE_ROWS` are
//     classified below against `SHAPE_SECTIONS` (`src/nav/groups.mjs`), by the same section each
//     row's `fixUrl` already points into.
const CAPABILITY_SHAPE = "crm";

const REAL_STATE_SHAPE = Object.freeze({
  servicesDefined: "crm",      // /items/services
  servicesPriced: "crm",       // /items/services
  peopleAdded: "crm",          // /people/all
  coachHoursSet: "crm",        // /engagements/booking
  templatesCreated: "crm",     // /documents/contracts/templates
  plansCreated: "crm",         // /items/plans
  propertiesConnected: "run",  // /accounts/access
  accountsAdded: "run",        // /accounts
  listsCreated: "run",         // /growth/lists
  clientInviteReviewed: "crm", // /run/templates/auth.client_invite
});

/** @param {string} rowShape - 'crm' or 'run', the row's own section. */
function shapeIncludes(shape, rowShape) {
  return shape === "both" || shape == null || shape === rowShape;
}

/**
 * Build the checklist. Returns OUTCOME groups, each with rows the surface can render directly.
 * @param steps  provisioning_step rows [{name, state, last_error, attempts, max_attempts}]
 * @param realState  real state counts (services, people, etc.)
 * @param shape  the tenant's `tenant.shape` — 'crm' | 'run' | 'both' (or omitted — 'both' behaviour)
 * @param questionsAnswered  optional flag indicating if signup questions were answered (enables endowed mode for services)
 */
export function buildOnboardingChecklist(steps = [], realState = {}, shape = "both", questionsAnswered = false) {
  const byName = new Map(steps.map((s) => [s.name, s]));
  const caps = deriveCapabilities(steps);

  const rows = [];
  if (shapeIncludes(shape, CAPABILITY_SHAPE)) {
    for (const [cap, spec] of Object.entries(CAPABILITY_MAP)) {
      if (!spec.dependsOnStep) continue; // delivered by the critical prefix; nothing to chase
      const step = byName.get(spec.dependsOnStep);
      const c = caps[cap];
      rows.push(buildRow({ cap, spec, step, capability: c }));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P5.2 — SETUP COMPLETION IS NOT THE SAME QUESTION AS "DID OUR PROVISIONING JOBS FINISH."
  //
  // Every row above is derived from `provisioning_step`, i.e. from work KEYSTONE does. A practice
  // whose Stripe, Resend and Forms steps all succeeded reads **100% set up** while having no
  // services, no prices, and therefore nothing it can actually sell. ★★ The meter would say "done"
  // to somebody who cannot yet take a booking — the precise shape of a progress bar that measures
  // the vendor's homework and calls it the customer's.
  //
  // ★★★ SO REAL-STATE ROWS ARE DERIVED FROM ROWS IN THE TENANT'S OWN TABLES, NEVER FROM A FLAG
  //     ANYBODY CAN SET. KS-9.4: *"services priced is true when an active price row exists."* There
  //     is no `setup_complete` column and there must not be one — a box someone ticks is a box
  //     someone ticks while the thing remains undone.
  //
  // ★ `realState` is passed IN rather than queried here, because this module is pure and is unit
  //   tested without a database. The ROUTE owns the query; this owns the meaning.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  for (const spec of REAL_STATE_ROWS) {
    if (!shapeIncludes(shape, REAL_STATE_SHAPE[spec.key])) continue;
    // ★★ ABSENT IS NOT ZERO. A caller that does not supply real state at all (an older caller, or a
    //    unit test about provisioning only) must not be told the practice has no services — that is
    //    a claim, and the honest response to "I was not asked" is to omit the row rather than to
    //    invent a failing one. Zero IS reported; undefined is not.
    const value = realState[spec.key];
    if (value === undefined || value === null) continue;
    rows.push(buildRealStateRow(spec, value));
  }

  const done = rows.filter((r) => r.status === "done");
  const needsYou = rows.filter((r) => r.actor === Actor.TENANT && r.status !== "done");
  const needsUs = rows.filter((r) => r.actor === Actor.PLATFORM && r.status !== "done");
  const waiting = rows.filter((r) => r.actor === Actor.WAITING && r.status !== "done");

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 17.35 — FIRST RUN FIVE. The ruled five setup steps for a fresh practice, in order.
  // ★ ONE TRUTH, TWO SURFACES: this is an ADDITIONAL VIEW over the same checklist data,
  //   never a second checklist. Both surfaces (the grouping below and the firstRunFive view)
  //   are derived from the same `rows` array.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const firstRunFive = buildFirstRunFive(rows, realState, questionsAnswered);

  return {
    // ★ Ordered by who is blocked, because that is the only ordering that drives action.
    groups: [
      { key: "needs_you", title: "Needs you", rows: needsYou },
      { key: "needs_us", title: "We're on it", rows: needsUs },
      { key: "waiting", title: "Waiting on DNS or a provider", rows: waiting },
      { key: "done", title: "Ready", rows: done },
    ],
    summary: {
      total: rows.length,
      done: done.length,
      blockedOnTenant: needsYou.length,
      blockedOnPlatform: needsUs.length,
      // ★★ The tenant is USABLE even when incomplete. Saying so, prominently, is the difference
      // between a checklist and an error screen.
      tenantIsUsable: true,
      allDone: done.length === rows.length,
    },
    firstRunFive,
  };
}

function buildRow({ cap, spec, step, capability }) {
  const state = step?.state ?? "missing";
  const done = state === "succeeded";

  // ★ Who has to act. Derived, never guessed.
  let actor;
  if (done) actor = null;
  // ★ S2 TASK 3 — `documenso_team` was the only step this branch ever fired for; it is retired (01
  //   default 9) and nothing produces `awaiting_human` today. Left in place for a future step that
  //   is genuinely human-only — see `classify.mjs`'s note on `Outcome.AWAITING_HUMAN`.
  else if (state === "awaiting_human") actor = Actor.PLATFORM;
  else if (cap === Capability.SEND_EMAIL) actor = Actor.TENANT;     // DNS records are theirs to add
  else if (state === "failed") actor = Actor.PLATFORM;
  else actor = Actor.WAITING;

  return {
    // ★ The OUTCOME is the title. The vendor appears nowhere in what the tenant reads.
    title: spec.label,
    capability: cap,
    status: done ? "done" : state === "failed" ? "attention" : "in_progress",
    actor,
    whatIsBlocked: done ? null : spec.lockedExplanation ?? `${spec.label} isn't ready yet.`,
    whatStillWorks: done ? null : spec.stillWorks,
    whatToDo: done ? null : whatToDo({ cap, state, actor }),
    fixUrl: done ? null : capability?.reason?.fixUrl ?? `/onboarding#step-${spec.dependsOnStep}`,
    // ★★ DIAGNOSTICS ARE INTERNAL-ONLY. The vendor name and the raw error live here, for support —
    // never in the tenant-facing fields above. This keeps "group by outcome" true without
    // throwing away the information an engineer needs.
    diagnostics: {
      step: spec.dependsOnStep,
      state,
      attempts: step?.attempts ?? 0,
      maxAttempts: step?.max_attempts ?? null,
      lastError: step?.last_error ?? null,
      retryable: step?.last_error_retryable ?? null,
    },
  };
}

function whatToDo({ cap, state, actor }) {
  if (actor === Actor.TENANT && cap === Capability.SEND_EMAIL) {
    return "Add the DNS records shown here to your domain, then we'll verify automatically.";
  }
  if (actor === Actor.PLATFORM && state === "awaiting_human") {
    return "Nothing — we're completing this for you. We'll email you when it's ready.";
  }
  if (state === "failed") {
    return "Nothing — we've been alerted and we're looking at it.";
  }
  return "Nothing — this finishes on its own, usually within a few minutes.";
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P5.2 — THE REAL-STATE ROWS. Each is a COUNT the tenant owns, not a step we run.
//
// ★★ THE ACTOR IS ALWAYS `TENANT`. Nobody at Keystone can decide what a practice charges for a
//    session, so these can never be "we're on it" — and a checklist that implied otherwise would
//    park the one group of rows the practice actually has to do under a heading that says wait.
// ★ Ordered the way a practice does the work: you name what you sell, then you price it, then a
//   person exists to sell it to.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const REAL_STATE_ROWS = [
  {
    key: "servicesDefined",
    title: "Add the services you offer",
    blocked: "You have no services yet, so there is nothing to book or invoice for.",
    stillWorks: "You can add people and take notes in the meantime.",
    toDo: "Add at least one service — a session type, a package, or a plan.",
    fixUrl: "/items/services",
  },
  {
    // ★★★ THIS IS KS-9.4 ITSELF: "services priced is TRUE WHEN AN ACTIVE PRICE ROW EXISTS."
    //     Not when someone typed a number into a settings screen, and not when a service was
    //     created — a service with no price is a thing you cannot sell, and the DIFFERENCE between
    //     those two rows is exactly what this one measures.
    key: "servicesPriced",
    title: "Price your services",
    blocked: "Your services have no active price, so an invoice cannot be raised from them.",
    stillWorks: "Bookings still work; you just cannot bill for them yet.",
    toDo: "Set a price on each service. A price change is always a NEW price row, never an edit.",
    fixUrl: "/items/services",
  },
  {
    key: "peopleAdded",
    title: "Add your first client",
    blocked: "Nobody is on your books yet.",
    stillWorks: "Everything else is ready for them when they arrive.",
    toDo: "Add a person, or send an invite from People.",
    fixUrl: "/people/all",
  },
  {
    // ★★★ the maintainer, 29 Sep 2026 — "Add it to the 'Complete your setup' checklist — a step to review the
    //     client invite email before inviting anyone." Done is measured the same honest way every
    //     other real-state row is: a row in the tenant's own table, never a flag anybody can tick
    //     — here, having saved at least one version of the template (any version; activating one
    //     is a separate, later choice). That is a REAL action, not a promise the wording was read
    //     word for word, and the copy below says exactly that rather than overclaiming.
    key: "clientInviteReviewed",
    title: "Review the client invite email",
    blocked: "You haven't opened the client portal invite email yet.",
    stillWorks: "You can still invite clients — they'll get the shipped default wording.",
    toDo: "Open it, check it reads the way you want, and save — even with no changes.",
    fixUrl: "/run/templates/auth.client_invite",
  },
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ S2.3 — THREE MORE ROOTS, ADDED BECAUSE THE EMPTY-STATE SPEC MEASURED THE DEPENDENCY CHAIN
  //     AND THIS LIST WAS MISSING THREE QUARTERS OF IT.
  //
  //   TWELVE of the 45 list screens are `BLOCKED`, and the spec's ruling is that a blocked screen's
  //   primary action **POINTS AT ITS BLOCKER, NOT AT ITSELF** — wired to *"the SAME source the
  //   onboarding checklist already uses. One truth, two surfaces. Do not compute 'is this blocked'
  //   twice."* [MEASURED against that chain] this list covered **one root of four**:
  //       A SERVICE WITH A PRICE  → packages · plans · bookable services · invoices · subscriptions
  //       COACH HOURS             → online booking                        ← WAS MISSING
  //       A TEMPLATE              → contracts · forms · pipeline · executed ← WAS MISSING
  //       A CONNECTED PROPERTY    → the four Build Wire Run screens        ← WAS MISSING
  //
  // ★★★ AND ADDING THEM FIXES THIS FILE'S OWN DEFECT, ONE LAYER ALONG. Its header argues that a
  //     meter reading 100% for a practice with no services *"measures the vendor's homework and
  //     calls it the customer`s."* Exactly the same was true of a practice with no coach hours and`
  //     no document templates: it could not take an online booking or send anything to be signed,
  //     and the checklist called it Ready. **The rows were right; the list was short.**
  //
  // ★★ ABSENT IS STILL NOT ZERO. `buildOnboardingChecklist` skips a key the caller did not supply,
  //    so a caller on the old three-key shape gets the old three rows and is not told this practice
  //    has no templates — a claim it was never asked to make.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  {
    key: "coachHoursSet",
    title: `Set when your coaches are free`,
    blocked: `No coach has any hours, so a client cannot book online.`,
    stillWorks: "You can still book a session yourself from the calendar.",
    toDo: `Add a weekly availability rule for at least one coach.`,
    fixUrl: "/engagements/booking",
  },
  {
    // ★★ A TEMPLATE, NOT A DOCUMENT. Nothing can be SENT until a template exists — the instance is
    //    a copy of one — so the blocker is the template and the fix is the template screen. Sending
    //    somebody to "Documents" when they have no template is the dead end this whole item exists
    //    to remove.
    key: "templatesCreated",
    title: "Create a document template",
    blocked: "You have no templates, so nothing can be sent for signature.",
    stillWorks: "Everything else works; there is simply nothing to send yet.",
    toDo: "Create a contract or form template.",
    fixUrl: "/documents/contracts/templates",
  },
  {
    // ★★★ THIS ONE IS `CONNECT`, NOT `CREATE`, AND THE SPEC IS EXPLICIT THAT **THE DIFFERENCE IS
    //     THE VERB**: *"You do not CREATE a Search Console property in the platform, you CONNECT one."*
    //     Four Build Wire Run screens hang off it and all four are delivery screens, not CRM ones.
    key: "propertiesConnected",
    title: "Connect an account's properties",
    blocked: "No account has a connected property, so there is no search, ads or analytics data.",
    stillWorks: "Accounts, sites and reporting still work without them.",
    toDo: "Connect Search Console, Google Ads, Analytics or a Business Profile on an account.",
    fixUrl: "/accounts/access",
  },
  {
    // ★★ A LIST IS A SAVED FILTER, NOT A SECOND COPY OF THE PEOPLE. `/growth/campaigns` is blocked
    //    on one existing because *"a campaign sends ONE message to ONE list"* — so the blocker is
    //    the list and the destination is Lists, not Campaigns.
    // ★ This root is NOT part of the four-root chain the spec draws; it is a fifth, smaller one,
    //   and it is recorded as such rather than folded into "a service with a price" to make the
    //   diagram tidier. Eleven of the twelve blocked screens trace to services; this is the twelfth.
    // ★★★ F371 — SIX SCREENS BLOCK ON THIS AND THE SPEC ATTRIBUTED THEM TO THE WRONG ROOT. The
    //     four Build-Wire-Run screens plus Monitoring and Access are lists over `account`; they are
    //     empty only while the practice has NO ACCOUNTS. Connecting a property changes a COLUMN on
    //     an existing row, never whether the row exists.
    key: "accountsAdded",
    title: "Add your first account",
    blocked: "You have no accounts, so there is no site, service or reporting to deliver against.",
    stillWorks: "Coaching, documents and money all work without one.",
    toDo: "Add a business you deliver work for.",
    fixUrl: "/accounts",
  },
  {
    // ★★ `/money/subscriptions` blocks on a PLAN, not on a priced service. A plan IS a recurring
    //    price, and putting a client on one is the subscription — so the blocker one step up is the
    //    plan and the destination is Items → Plans. Resolving it to `servicesPriced` would send a
    //    practice that already has priced services to a screen where everything is already done.
    key: "plansCreated",
    title: "Create a recurring plan",
    blocked: "You have no plans, so nobody can be put on a recurring subscription.",
    stillWorks: "One-off invoices and packages work without one.",
    toDo: "Create a plan — a price on a repeating interval.",
    fixUrl: "/items/plans",
  },
  {
    key: "listsCreated",
    title: "Build your first list",
    blocked: "You have no lists, so there is nobody for a campaign to go to.",
    stillWorks: "Everything else works; you simply cannot send a campaign yet.",
    toDo: "Save a list from the people you already have.",
    fixUrl: "/growth/lists",
  },
  {
    key: "connectStripe",
    title: "Connect Stripe",
    blocked: "Stripe Connect is not set up, so you cannot process payments.",
    stillWorks: "You can still create documents, schedule sessions, and manage your practice structure.",
    toDo: "Connect your Stripe account in Money settings.",
    fixUrl: "/settings/money",
  },
  {
    key: "documentsSent",
    title: "Send your first document",
    blocked: "You haven't sent any documents yet.",
    stillWorks: "Everything else works; you can still book sessions and manage clients.",
    toDo: "Create a document template and send it to someone for signature.",
    fixUrl: "/documents/contracts/templates",
  },
];

function buildRealStateRow(spec, count) {
  const done = count > 0;
  return {
    title: spec.title,
    // ★ `capability: null` — these are not capabilities. A capability is something the PLATFORM
    //   either delivers or does not; this is work the practice has or has not done, and conflating
    //   the two is how "your account is broken" gets said to someone who simply has not started.
    capability: null,
    status: done ? "done" : "in_progress",
    // ★ `actor` must be null when done, matching buildRow — the `done` group is filtered by status
    //   but `needsYou` is filtered by actor AND status, and a non-null actor on a done row would
    //   put it in neither group and silently drop it from the total's denominators.
    actor: done ? null : Actor.TENANT,
    whatIsBlocked: done ? null : spec.blocked,
    whatStillWorks: done ? null : spec.stillWorks,
    whatToDo: done ? null : spec.toDo,
    fixUrl: done ? null : spec.fixUrl,
    diagnostics: {
      // ★★ THE COUNT IS THE DIAGNOSTIC, and it is the whole point: "0 active price rows" is a fact
      //    a support engineer can act on, where "setup incomplete" is not.
      source: "real_state",
      key: spec.key,
      count,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 17.35 — FIRST RUN FIVE. Build the five setup steps for a fresh practice.
//
// ★★★ ONE TRUTH, TWO SURFACES — this returns a view of the same rows the grouping uses, reordered
// to the ruled five, with special handling for the first step (Add what you sell).
//
// The five steps, in order:
//   1. Add what you sell → servicesDefined (endowed if questionsAnswered)
//   2. Connect Stripe → connectStripe
//   3. Bring your people over → peopleAdded
//   4. Turn on online booking → coachHoursSet
//   5. Connect Google → propertiesConnected
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function buildFirstRunFive(rows, realState = {}, questionsAnswered = false) {
  const rowsByKey = new Map(
    rows
      .filter((r) => r.diagnostics?.key)
      .map((r) => [r.diagnostics.key, r])
  );

  // Find the specs that match the first-run five
  const servicesDefined = rowsByKey.get("servicesDefined");
  const connectStripe = rowsByKey.get("connectStripe");
  const peopleAdded = rowsByKey.get("peopleAdded");
  const coachHoursSet = rowsByKey.get("coachHoursSet");
  const propertiesConnected = rowsByKey.get("propertiesConnected");

  const five = [];

  // 1. Add what you sell — servicesDefined (endowed if questionsAnswered + services exist)
  if (servicesDefined) {
    if (questionsAnswered && realState.servicesDefined > 0) {
      // Endowed state: services were created from signup answers, so step 1 is done
      five.push({
        ...servicesDefined,
        status: "done",
        actor: null,
        whatIsBlocked: null,
        whatStillWorks: null,
        whatToDo: null,
        fixUrl: null,
        // Mark as endowed so the UI can render the special "See them" link
        endowed: true,
        endowedMessage: "Done — we set these up from your answers. Change them any time.",
      });
    } else {
      // Not endowed, use the regular row as-is
      five.push(servicesDefined);
    }
  }

  // 2. Connect Stripe — connectStripe
  if (connectStripe) {
    five.push(connectStripe);
  }

  // 3. Bring your people over — peopleAdded
  if (peopleAdded) {
    five.push(peopleAdded);
  }

  // 4. Turn on online booking — coachHoursSet
  if (coachHoursSet) {
    // Customize the sub-text for the first-run view
    const bookingStep = { ...coachHoursSet };
    // Replace the todo with the first-run specific sub-text
    if (bookingStep.whatToDo) {
      bookingStep.whatToDo = "Your booking page, ready to share.";
    }
    five.push(bookingStep);
  }

  // 5. Connect Google — propertiesConnected
  if (propertiesConnected) {
    five.push(propertiesConnected);
  }

  return five;
}
