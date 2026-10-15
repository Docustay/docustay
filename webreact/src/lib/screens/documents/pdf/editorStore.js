// editorStore.js — the field editor's state: fields + seats, with undo/redo (zustand + zundo). One store per editor, made fresh for each document.
// ★ Changes are IMMUTABLE snapshots (never mutated in place) — the React Compiler and zundo both depend on that.
import { create } from "zustand";
import { temporal } from "zundo";

export const FIELD_DEFAULTS = {
  signature: { w: 0.28, h: 0.055, label: "Signature" }, initials: { w: 0.08, h: 0.04, label: "Initials" }, date_signed: { w: 0.16, h: 0.03, label: "Date signed" },
  text: { w: 0.28, h: 0.03, label: "Text" }, checkbox: { w: 0.03, h: 0.022, label: "Checkbox" }, dropdown: { w: 0.22, h: 0.03, label: "Choice", options: ["Option 1", "Option 2"] },
  image: { w: 0.2, h: 0.1, label: "Picture" }, multiselect: { w: 0.28, h: 0.045, label: "Pick any", options: ["Option 1", "Option 2", "Option 3"] }, stamp: { w: 0.2, h: 0.09, label: "Stamp" }, file: { w: 0.3, h: 0.03, label: "File upload" },
  payment: { w: 0.26, h: 0.045, label: "Payment", amount_minor: 5000, currency: "usd" },
};
export const SEAT_COLOURS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f"];
export const seatColour = (key) => SEAT_COLOURS[(Number(String(key).split("_")[1]) - 1 + SEAT_COLOURS.length) % SEAT_COLOURS.length];

const rid = () => `f${Math.random().toString(36).slice(2, 9)}`;
const clamp = (f) => ({ ...f, x: Math.min(Math.max(0, f.x), 1 - f.w), y: Math.min(Math.max(0, f.y), 1 - f.h) });

export function makeEditorStore({ fields = [], roles = [{ key: "signer_1", label: "Signer 1" }], suggestions = [] }) {
  return create(temporal((set, get) => ({
    fields, roles, suggestions, selected: null, seat: roles[0]?.key ?? "signer_1",
    select: (id) => set({ selected: id }),
    setSeat: (seat) => set({ seat }),
    setRoles: (next) => set({ roles: next }),
    add: (type, page, x, y) => {
      const d = FIELD_DEFAULTS[type]; const f = clamp({ id: rid(), type, role: get().seat, page, x, y, w: d.w, h: d.h, required: true, label: d.label, ...(d.options ? { options: [...d.options] } : {}), ...(d.amount_minor ? { amount_minor: d.amount_minor, currency: d.currency } : {}) });
      set({ fields: [...get().fields, f], selected: f.id }); return f.id;
    },
    update: (id, patch) => set({ fields: get().fields.map((f) => (f.id === id ? clamp({ ...f, ...patch }) : f)) }),
    remove: (id) => set({ fields: get().fields.filter((f) => f.id !== id), selected: get().selected === id ? null : get().selected }),
    duplicate: (id, toPage = null) => {
      const f = get().fields.find((x) => x.id === id); if (!f) return;
      const copy = clamp({ ...f, id: rid(), page: toPage ?? f.page, ...(toPage ? {} : { x: f.x + 0.02, y: f.y + 0.02 }) });
      set({ fields: [...get().fields, copy], selected: copy.id });
    },
    acceptSuggestion: (sid) => {
      const s = get().suggestions.find((x) => x.id === sid); if (!s) return;
      const d = FIELD_DEFAULTS[s.type] ?? FIELD_DEFAULTS.text;
      const f = clamp({ id: rid(), type: s.type, role: get().seat, page: s.page, x: s.x, y: s.y, w: s.w, h: s.h, required: true, label: d.label, ...(d.options ? { options: [...d.options] } : {}), ...(d.amount_minor ? { amount_minor: d.amount_minor, currency: d.currency } : {}) });
      set({ fields: [...get().fields, f], suggestions: get().suggestions.filter((x) => x.id !== sid) });
    },
    acceptAll: () => { for (const s of [...get().suggestions]) get().acceptSuggestion(s.id); },
    dismissSuggestion: (sid) => set({ suggestions: get().suggestions.filter((x) => x.id !== sid) }),
    nudge: (id, dx, dy) => { const f = get().fields.find((x) => x.id === id); if (f) get().update(id, { x: f.x + dx, y: f.y + dy }); },
    /** Line the chosen fields up on the first one's left edge (align) — a quick tidy. */
    alignLeft: (ids) => { const [first, ...rest] = ids.map((i) => get().fields.find((f) => f.id === i)).filter(Boolean); if (!first) return; for (const f of rest) get().update(f.id, { x: first.x }); },
  }), { limit: 100, partialize: (s) => ({ fields: s.fields, suggestions: s.suggestions }) }));
}

/** Snap a fraction to a grid of `step` (a quarter of a percent by default) unless `off`. */
export const snap = (v, off = false, step = 0.0025) => (off ? v : Math.round(v / step) * step);
