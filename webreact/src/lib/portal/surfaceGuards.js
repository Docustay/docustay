// ═══════════════════════════════════════════════════════════════════════════════════════════════
// S5 — THE CLIENT APP'S TWO REFUSALS. PLAIN JS, BECAUSE THEY ARE RULES AND NOT RENDERING.
//
// ★★★ §K: *"The only difference between the client portals is ACCESS. Same surfaces, same
//     components, different visibility. DO NOT FORK A PORTAL TO EXPRESS A PERMISSION DIFFERENCE —
//     that is how four portals became five surfaces and 160 routes last time."*
//
// ★★★ §K3, WHICH THIS FILE MUST NOT BE READ AS CONTRADICTING: *"CLIENT-SIDE ROLE GATING IS NOT A
//     SECURITY BOUNDARY. Hiding a tab renders nothing unreachable. The server decides, every time,
//     on every request."* The nav is a CONVENIENCE. These guards protect a SCREEN; `src/routes/app.mjs`
//     protects the DATA, and it serves only the eight keys. **Either alone is half a guarantee.**
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { HELD_SURFACES, NOT_IN_APP } from "@keystone/app/surfaces.mjs";

/**
 * ★★★ THE HELD SURFACES, REFUSED AT THE RENDERER. Check-in, the library and the guides are HELD.
 * ★★ THE REFUSAL IS LOUD — a thrown error naming the hold, not a blank panel. **A held surface that
 *    renders nothing looks exactly like a broken one, and somebody would "fix" it by building it.**
 */
export function assertNotHeld(surfaceKey) {
  const k = String(surfaceKey ?? "").toLowerCase();
  if (HELD_SURFACES.includes(k)) {
    throw new Error(
      `surface "${surfaceKey}" is HELD (ruled 12 Sep 2026) and must not be rendered. Check-in, the ` +
      `library and the 2,057 guides are parked — and R2 adds: DO NOT DESIGN THE SCHEMA AROUND THEM ` +
      `YET. Building this is a scope change and belongs to the maintainer, not to a renderer.`);
  }
  return true;
}

/**
 * ★★★ AND A CRM SURFACE IS NOT IN THIS APP AT ALL. `NOT_IN_APP` is the eleven CRM sections.
 *     **A client app that renders one has become the CRM.**
 */
export function assertInApp(surfaceKey) {
  const k = String(surfaceKey ?? "").toLowerCase();
  if (NOT_IN_APP.includes(k)) {
    throw new Error(
      `"${surfaceKey}" is a CRM section, not a client-app surface (R5: no org settings, no reports, ` +
      `nothing staff-facing). The client app has eight surfaces; this is not one of them.`);
  }
  return true;
}

/**
 * ★★ THE ONE RESOLVER. Held → refuse; CRM → refuse; otherwise the key is legal to draw.
 * ★★★ IT TAKES ONE ARGUMENT, AND KEEPING IT THAT WAY IS THE POINT: **the moment a role is threaded
 *     through here, the portal fork has begun.**
 */
export function resolveSurface(surfaceKey) {
  assertNotHeld(surfaceKey);
  assertInApp(surfaceKey);
  return String(surfaceKey ?? "").toLowerCase();
}

/** ★★★ SAID OUT LOUD, BESIDE THE CODE THAT HIDES A TAB. The one place a future reader is most likely
 *  to mistake a hidden tab for a permission is here. */
export const NAV_IS_NOT_A_BOUNDARY = true;
