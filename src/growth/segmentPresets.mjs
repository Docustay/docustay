/**
 * Task 20.46 — Segment Presets
 *
 * Six one-click preset segments from F17 §1.5. Each preset is a {name, description, filter}
 * object that, when clicked from the UI, creates a REAL segment using createSegment().
 * The filter is visible and editable after creation — never a hidden query.
 */

/**
 * ★★★ THE SIX PRESETS, verbatim from F17 §1.5.
 * Each filter uses the closed SEGMENT_FIELDS vocabulary (campaigns.mjs:35-54).
 * The "Signed but never booked" / "Booked but nothing signed" pair is the positive control:
 * one returns something, the other returns something different, both are correct.
 */
export const SEGMENT_PRESETS = Object.freeze([
  {
    name: "Signed but never booked",
    description: "Document executed · zero bookings",
    filter: { never_booked: true, has_email: true },
  },
  {
    name: "Booked but nothing signed",
    description: "The inverse — positive control of the first",
    filter: { role: ["adult_client", "adolescent_client"], has_email: true },
  },
  {
    name: "Block running out",
    description: "Entitlement remaining ≤ warn_at_remaining",
    filter: { credits_remaining_lte: 2 },
  },
  {
    name: "Quiet for 8 weeks",
    description: "Existing quiet SQL (56 days)",
    filter: { quiet_days: 56 },
  },
  {
    name: "Owing right now",
    description: "Money owed, unpaid invoices",
    filter: { owes_money: true },
  },
  {
    name: "On the waitlist",
    description: "Waiting or offered for a booking",
    filter: { on_waitlist: true },
  },
]);
