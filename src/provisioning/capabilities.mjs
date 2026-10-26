// P2.10 — CAPABILITY FLAGS PER STEP · P2.11 (M4.6) — A BLOCKED CAPABILITY IS VISIBLE.
//
// ★★★ A CAPABILITY IS AN OUTCOME, NOT A VENDOR. "stripe_customer is pending" means nothing to a
// practice manager. "You cannot take payments yet" means something. This mapping
// is the difference between an onboarding checklist that gets finished and one that gets ignored,
// and it is why P2.12 says group by OUTCOME, never by vendor.
//
// ★★ M4.6: A BLOCKED CAPABILITY MUST BE VISIBLE, AND IT MUST SAY WHERE TO FIX IT.
// The failure this prevents is not a crash — it is silence. A surface that simply omits a
// disabled feature teaches the tenant the product cannot do it. They stop looking, and nobody
// ever finishes the step. The surface must therefore RENDER the capability, in a locked state,
// deep-linked to the exact row that unlocks it.

export const Capability = Object.freeze({
  SIGN_DOCUMENTS: "sign_documents",
  SEND_EMAIL: "send_email",
  TAKE_PAYMENTS: "take_payments",
  COLLECT_FORMS: "collect_forms",
  BOOK_APPOINTMENTS: "book_appointments",
});

/**
 * Which step each capability depends on, and — in the tenant's words — what they lose without it.
 * ★ `stillWorks` is not padding: without it a locked capability reads as a broken product.
 */
export const CAPABILITY_MAP = {
  // ★★★ S2 TASK 3 — NEVER BLOCKED (01 default 9: Documenso retired). This used to depend on the
  //     `documenso_team` provisioning step, which never actually gated the signing FEATURE at all —
  //     signing has been in-app since ADD6-1/P15C.0, using this deployment's own signing certificate
  //     (`KEYSTONE_SIGNING_CERT_PEM`, checked by `/readyz`). The step only ever sat `awaiting_human`
  //     and blocked a capability nothing downstream of it actually needed. Same shape as
  //     `BOOK_APPOINTMENTS` below: delivered by the critical prefix, nothing to chase.
  [Capability.SIGN_DOCUMENTS]: {
    label: "Send documents for signature",
    dependsOnStep: null,
    neverBlocks: true,
    lockedExplanation: null,
    stillWorks: null,
  },
  [Capability.SEND_EMAIL]: {
    label: "Send email to clients",
    dependsOnStep: "resend_domain",
    // ★ NEVER LOCKED. P2.13 — the platform-domain fallback means email always works.
    neverBlocks: true,
    lockedExplanation: null,
    stillWorks: "Email is working now, sending from our domain until yours is verified.",
  },
  [Capability.TAKE_PAYMENTS]: {
    label: "Take payments",
    dependsOnStep: "stripe_customer",
    lockedExplanation: "We're still connecting your billing account.",
    stillWorks: "You can add clients and book sessions; invoicing turns on once billing is connected.",
  },
  [Capability.COLLECT_FORMS]: {
    label: "Collect intake forms",
    dependsOnStep: "form_workspace",
    lockedExplanation: "We're still creating your forms workspace.",
    stillWorks: "Client records work now; intake forms turn on shortly.",
  },
  [Capability.BOOK_APPOINTMENTS]: {
    label: "Book appointments",
    dependsOnStep: null, // depends on the critical prefix only
    lockedExplanation: null,
    stillWorks: null,
  },
};

/**
 * Derive capabilities from the provisioning step rows.
 * @param steps [{name, state}]
 */
export function deriveCapabilities(steps = []) {
  const byName = new Map(steps.map((s) => [s.name, s]));
  const out = {};

  for (const [cap, spec] of Object.entries(CAPABILITY_MAP)) {
    if (spec.neverBlocks) {
      out[cap] = { capability: cap, label: spec.label, available: true, degraded: isDegraded(spec, byName), reason: null };
      continue;
    }
    if (!spec.dependsOnStep) {
      out[cap] = { capability: cap, label: spec.label, available: true, degraded: false, reason: null };
      continue;
    }
    const step = byName.get(spec.dependsOnStep);
    const ok = step?.state === "succeeded";
    out[cap] = {
      capability: cap,
      label: spec.label,
      available: ok,
      degraded: false,
      // ★★ EVERYTHING THE SURFACE NEEDS TO RENDER A LOCKED STATE. If any of this were missing the
      // surface would have nothing to show but an absence — which is the defect M4.6 names.
      reason: ok ? null : {
        explanation: spec.lockedExplanation,
        stillWorks: spec.stillWorks,
        blockingStep: spec.dependsOnStep,
        stepState: step?.state ?? "missing",
        needsHuman: step?.state === "awaiting_human",
        // ★ The DEEP LINK to the exact row that unlocks it — P2.10's requirement.
        fixUrl: `/onboarding#step-${spec.dependsOnStep}`,
      },
    };
  }
  return out;
}

function isDegraded(spec, byName) {
  if (!spec.dependsOnStep) return false;
  const s = byName.get(spec.dependsOnStep);
  return s?.state !== "succeeded";
}

/**
 * ★★ M4.6 — what the surface must render. A locked capability is RETURNED, not filtered out.
 * A surface that receives only available capabilities cannot show a locked one, so the visibility
 * requirement has to be satisfied HERE, in the data, not hoped for in the component.
 */
export function renderableCapabilities(steps = []) {
  const derived = deriveCapabilities(steps);
  return Object.values(derived).map((c) => ({
    ...c,
    // Explicit render instruction, so "it wasn't in the list" can never be the reason it is absent.
    render: c.available ? (c.degraded ? "enabled_with_notice" : "enabled") : "locked_with_reason",
  }));
}

export class CapabilityLocked extends Error {
  constructor(capability, reason) {
    super(`${capability} is not available yet: ${reason?.explanation ?? "provisioning incomplete"}`);
    this.name = "CapabilityLocked";
    this.statusCode = 409;
    this.capability = capability;
    this.reason = reason;
    // ★ The deep link travels with the ERROR too, so even an API caller is told where to fix it.
    this.fixUrl = reason?.fixUrl ?? null;
  }
}

export function assertCapability(capability, steps) {
  const c = deriveCapabilities(steps)[capability];
  if (!c) throw new Error(`unknown capability: ${capability}`);
  if (!c.available) throw new CapabilityLocked(capability, c.reason);
  return true;
}
