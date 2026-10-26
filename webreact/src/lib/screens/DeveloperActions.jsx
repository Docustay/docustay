// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DeveloperActions — API key create and revoke controls.
// Ported from webui/src/lib/screens/DeveloperActions.svelte — same props, testids and copy.
//
// ★★★ TWO PLACEMENTS, ONE COMPONENT, BECAUSE THE RULES ARE ONE SET OF RULES. `row = null` renders
//     the CREATE trigger (and its drawer); `row = <a key>` renders THAT key's Revoke (and its
//     confirm). Until A11.2 this file rendered a flat list of every key's Revoke button with no
//     row to sit in — which is what a component mounted only by a gate looks like: it never had
//     to be placeable.
//   ★★ Splitting by PROP rather than into two files keeps the one-time-secret rule, the admin
//      floor and the idempotent-revoke predicate in a single place. Two files would be two
//      answers to "may this person mint a key".
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError, request } from "@/lib/api.js";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import DeveloperActionsApikeySheet from "./DeveloperActionsApikeySheet.jsx";
import DeveloperActionsApikeyRevokeConfirm from "./DeveloperActionsApikeyRevokeConfirm.jsx";

export default function DeveloperActions({ rank = null, keys = [], row = null, onDone = null }) {
  const isAdmin = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");

  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(new Set());
  const [environment, setEnvironment] = useState("test");
  const [tokenClass, setTokenClass] = useState("secret");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  // ★ the maintainer, 28 Sep 2026 — the full grantable-scope list, from the EXISTING `GET /api/developer/
  //   scopes` route (src/routes/developer.mjs:241, already re-exporting src/developer/scopes.mjs's
  //   own GRANTABLE_SCOPES for this exact purpose). Not a static import: the frontend bundle
  //   cannot import backend `src/` modules.
  const [grantableScopes, setGrantableScopes] = useState([]);
  useEffect(() => { request("/api/developer/scopes").then((r) => setGrantableScopes(r.scopes ?? [])).catch(() => {}); }, []);

  const toggle = (s) => {
    const next = new Set(scopes);
    next.has(s) ? next.delete(s) : next.add(s);
    setScopes(next);
  };

  // ★★ A KEY WITH NO SCOPES CAN DO NOTHING. It would be created, listed, look configured and be
  //    refused by every call — the same shape as the webhook endpoint subscribed to no topics. The
  //    refusal is a disabled button with a visible reason, never an invented error after the fact.
  const ready = name.trim().length > 0 && scopes.size > 0;

  async function mint() {
    if (busy || !ready) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await api.createApiKey({
        name: name.trim(),
        scopes: [...scopes],
        environment,
        class: tokenClass,
      });
      setCreated(result);
      // ★★★ NOT `onDone()` YET — see the header. The secret is on screen and nowhere else.
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.key ?? created.secret);
      setCopied(true);
    } catch {
      setCopied(false);
      setProblem("Could not reach the clipboard. Select the key above and copy it manually.");
    }
  }

  function finish() {
    setCreated(null);
    setOpen(false);
    setName("");
    setScopes(new Set());
    onDone?.();
  }

  async function revoke() {
    if (busy || !revoking) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.revokeApiKey(revoking.id);
      setRevoking(null);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  // ★★ THE ROW'S OWN CONTROL, IN THE ROW. A revoked key is not offered a revoke — the route is
  //     idempotent by predicate (`revoked_at IS NULL`), so a second press would match zero rows and
  //     return 200 having done nothing: a control that reports success and does not act.
  if (isAdmin && row && !row.revoked_at) {
    return (
      <>
        <button
          type="button"
          className="inline-flex items-center justify-center h-8 px-3 text-meta font-medium rounded-sm border border-line bg-surface hover:bg-paper text-ink-2"
          data-testid={`apikey-revoke-${row.id}`}
          onClick={() => {
            setProblem(null);
            setRevoking(row);
          }}
        >
          Revoke
        </button>

        <DeveloperActionsApikeyRevokeConfirm
          open={!!revoking}
          onOpenChange={(val) => !val && setRevoking(null)}
          revoking={revoking}
          created={created}
          busy={busy}
          problem={problem}
          revoke={revoke}
        />
      </>
    );
  }

  // ★★★ CREATE MODE: button + drawer + confirm
  if (isAdmin && !row) {
    return (
      <>
        <button
          type="button"
          className="inline-flex items-center justify-center h-8 px-3 text-meta font-medium rounded-sm border border-line bg-surface hover:bg-paper text-ink-2"
          data-testid="apikey-create-trigger"
          onClick={() => {
            setProblem(null);
            setCreated(null);
            setOpen(true);
          }}
        >
          New API key
        </button>

        <DeveloperActionsApikeySheet
          open={open}
          onOpenChange={setOpen}
          name={name}
          onNameChange={setName}
          scopes={scopes}
          grantableScopes={grantableScopes}
          onScopeToggle={toggle}
          environment={environment}
          onEnvironmentChange={setEnvironment}
          tokenClass={tokenClass}
          onTokenClassChange={setTokenClass}
          created={created}
          copied={copied}
          busy={busy}
          problem={problem}
          toggle={toggle}
          ready={ready}
          mint={mint}
          copy={copy}
          finish={finish}
        />
      </>
    );
  }

  // Not admin
  return null;
}
