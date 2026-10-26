// THE SHARED DOCUMENT ENGINE — the merge-field resolver port. Pure, no imports of the host. The engine never knows what a "person" or a "practice" is: a skin plugs a
// resolver in. Docustay's is the island's own (signer.*, sender.*, org.*, document.*, custom.*); the platform's adds its 43 CRM names through src/ports/documents.mjs
// (already registered into the live catalogue). A resolver is `{ resolve(name, facts) → string | null }`; null means "no value".

/** The marker the contract view prints when a field has no value, so a hole is visible instead of silently blank. */
export const missingMarker = (label) => `[${label} — not provided]`;

/** A resolver over a plain facts map (the island's own `facts.custom` for custom.*, flat names otherwise). */
export function factsResolver(facts = {}) {
  return {
    resolve(name) {
      if (name.startsWith("custom.")) return facts.custom?.[name.slice(7)] ?? null;
      const v = facts[name] ?? name.split(".").reduce((o, k) => (o == null ? o : o[k]), facts);
      return v == null || typeof v === "object" ? null : String(v);
    },
  };
}
