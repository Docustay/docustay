// ★ the maintainer, 23 Oct 2026 — the release switches the server sends on GET /api/nav (`features`, src/nav/features.mjs).
// Held here so the route table can read them without the app object. Off until the server says otherwise.
let current = Object.freeze({ runScreens: false });
export function setFeatures(f) { current = Object.freeze({ runScreens: f?.runScreens === true }); }
export function features() { return current; }
