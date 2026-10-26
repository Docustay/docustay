// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PROGRAMS — the ONE client-side source of the practice's program list (QUEUE §4, the maintainer 2 Oct 2026).
// Every picker, chip, filter and report reads it from here; nothing keeps its own copy or builds its own
// `request("/api/items/programs")`. The list is small (a practice has a handful), fetched once and shared;
// a screen that creates / renames / deletes a program calls `refreshPrograms()` so every other consumer updates.
// A program is { id, name, colour, position, visibility, services_count, packages_count, plans_count, clients_count, team_count }.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useSyncExternalStore } from "react";
import { request } from "@/lib/api.js";

/** The palette the colour picker offers; a program with no colour uses the neutral grey. */
export const PROGRAM_COLOURS = Object.freeze(["#4B7BEC", "#2BA88F", "#E0A030", "#D9534F", "#8E6BCF", "#E27BA3", "#3FA7D6", "#7A8B99"]);
export const NO_PROGRAM_COLOUR = "#9AA3AD";

let cache = null;          // null = not loaded yet
let inflight = null;
// ★ The store SNAPSHOT is an immutable object replaced on every change, and `usePrograms` derives everything from it. (The React Compiler
//   memoises a hook by the values it reads; a module `let` is invisible to it, so reading `cache` directly left `loading` stuck at true.)
let snapshot = { programs: null };
const subs = new Set();
const emit = () => { snapshot = { programs: cache }; subs.forEach((f) => f()); };

export function loadPrograms(force = false) {
  if (!force && cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = request("/api/items/programs")
    .then((res) => { cache = Array.isArray(res?.data) ? res.data : []; })
    .catch(() => { cache = cache ?? []; })
    .finally(() => { inflight = null; emit(); })
    .then(() => cache);
  return inflight;
}
/** Call after any create / rename / reorder / delete / colour change. */
export function refreshPrograms() { return loadPrograms(true); }
export function programsSnapshot() { return cache ?? []; }
function programById(id) { return (cache ?? []).find((p) => p.id === id) ?? null; }
export function programName(id) { return programById(id)?.name ?? null; }
export function programColour(id) { return programById(id)?.colour ?? NO_PROGRAM_COLOUR; }

const subscribe = (cb) => { subs.add(cb); if (!cache && !inflight) loadPrograms(); return () => { subs.delete(cb); }; };
const getSnapshot = () => snapshot;

/** `{ programs, loading, byId, reload }` — loads once, re-renders on every change. */
export function usePrograms() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const programs = snap.programs ?? [];
  return { programs, loading: snap.programs === null, byId: (id) => programs.find((p) => p.id === id) ?? null, reload: refreshPrograms };
}
