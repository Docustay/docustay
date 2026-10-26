// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A11.2 — `/settings/developer/api-keys`. **THE LIST. `DeveloperActions` IS THE CONTROLS.**
//
// ★★★ THIS SCREEN DOES NOT RE-IMPLEMENT MINT OR REVOKE. `DeveloperActions.jsx` already owns
//     both, with the rules that matter: the secret is returned exactly ONCE and the drawer
//     refuses to close on success because closing would destroy the only copy; revoke is an
//     alert-dialog naming what stops working; the scope list is IMPORTED from the server's closed
//     set rather than retyped. ★★ It was built at A8 and mounted by NOTHING until now (F424) —
//     this screen is the missing half, not a second implementation.
//
// ★★★ FROM HERE ON A KEY IS ITS FINGERPRINT. The row stores a fingerprint and there is no route
//     in this product that can produce the plaintext again. The fingerprint exists so two parties
//     can confirm they hold the same secret without either revealing it — which is the whole
//     reason the column is worth the width.
//
// ★★ A REVOKED KEY IS SHOWN, STRUCK THROUGH, NOT REMOVED. "This key was revoked on the 4th" is
//    the answer somebody is looking for when a integration breaks; a disappeared row answers
//    nothing and reads as data loss.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import PageHeader from "@/lib/lists/PageHeader.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import DeveloperActions from "@/lib/screens/DeveloperActions.jsx";
import ApiKeysScreenTable1Table from "@/lib/screens/ApiKeysScreenTable1Table.jsx";

export default function ApiKeysScreen({ view = null, rank = null, onDone = null }) {
  const keys = view?.keys ?? [];
  const live = keys.filter((k) => !k.revoked_at);

  const when = (t) => {
    if (!t) return "—";
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleDateString(undefined, { dateStyle: "medium" });
  };

  // Revoked keys stay in the list, so the header says how many are in use rather than "0 of 1 key".
  const n = (c) => `${c} ${c === 1 ? "key" : "keys"}`;
  const summary =
    keys.length === 0 ? null
      : live.length === keys.length ? n(keys.length)
        : live.length === 0 ? `${n(keys.length)}, ${keys.length === 1 ? "revoked" : "all revoked"}`
          : `${live.length} active, ${keys.length - live.length} revoked`;

  return (
    <>
      <PageHeader title="API keys" count={live.length} noun="key" summary={summary}>
        {/* ★ The controls live in the header, beside the count they change. `DeveloperActions` draws
             its own "New API key" button and applies its own admin floor. */}
        <DeveloperActions rank={rank} keys={keys} onDone={() => onDone?.()} />
      </PageHeader>

      {keys.length === 0 ? (
        <EmptyState
          kind="first-run"
          headline="No API keys yet"
          line="An API key lets another system read and write this practice's data without a person signing in. Create one when you have something to connect."
          testId="apikeys-empty"
        />
      ) : (
        <ApiKeysScreenTable1Table rank={rank} onDone={onDone} keys={keys} live={live} when={when} />
      )}
    </>
  );
}
