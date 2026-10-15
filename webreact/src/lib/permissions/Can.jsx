// <Can object verb ownerId> / <Can action> — renders its children, or NOTHING (REACT-PLAN §4.5).
// ★ A permission renders nothing. A missing prerequisite is a different thing: that is
//   <DisabledWithReason>, and it is WriteButton's `blocked`, not this.
// ★ For chrome only (a column, a tab, a section). Money that a viewer may not see is the payload's job —
//   the server does not send it; <Can> never hides a figure the server sent.
import { useAppState } from "@/lib/app/useAppState.js";
import { can, canAct } from "./can.js";

export default function Can({ object, verb, action, ownerId, children, fallback = null }) {
  const app = useAppState();
  const permissions = app.permissions;
  const ok = action ? canAct(permissions, action) : can(permissions, object, verb, { ownerId, viewerId: app.me?.appUserId ?? null });
  return ok ? children : fallback;
}
