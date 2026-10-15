// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TeamRolesScreen — "Roles & access" (/settings/roles/presets). FOUND LIVE, 1 Oct 2026 (owner-access
// audit / Team brief): this screen's own BACKEND has existed, complete, for a while —
// GET /api/settings/roles/presets, POST .../permission, .../action, .../reset, .../create, each with
// its own self-escalation guard (an Admin can never touch the Owner's or their own rank's grants;
// the Owner is exempt) — but the FRONTEND FILE itself was never written, so the route rendered
// "TeamRolesScreen is not built yet" for anyone who opened it. Every write below goes straight
// through the existing, already-guarded routes; this file adds no new server-side logic, only the
// view onto what was already there.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "@/lib/api.js";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";

// ★ Plain-English labels for NAMED_ACTIONS (src/permissions/assertMay.mjs) — the vocabulary itself
//   is the server's closed list; these are display-only and safe to fall back to the raw key for
//   any action added there later without a matching label here.
const ACTION_LABELS = {
  "person.create": "Add new clients",
  "team.invite": "Invite team members",
  "team.remove": "Remove team members",
  "staff_role.change": "Change a team member's role",
  "document.sign": "Sign documents",
  "document.execute": "Fully execute documents",
  "template.author": "Create and edit templates",
  "record.archive": "Archive records",
  "record.restore": "Restore archived records",
  "booking.waive_charge": "Waive a no-show or late-cancel charge",
  "discount.apply": "Apply a discount",
  "invoice.refund": "Issue a refund",
  "setting.billing": "Manage practice billing",
  "loyalty.manage": "Manage loyalty points",
  "gift_card.manage": "Manage gift cards",
};

export default function TeamRolesScreen({ view: initialView = null, onNavigate = null, onDone = null }) {
  const [view, setView] = useState(initialView);
  const [phase, setPhase] = useState(initialView ? "ready" : "loading");
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [newRoleBasedOn, setNewRoleBasedOn] = useState("");

  const load = useCallback(async () => {
    try {
      setPhase("loading");
      const data = await api.teamRolesSettings();
      setView(data);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
      } else {
        setError(err);
        setPhase("error");
      }
    }
  }, []);

  useEffect(() => {
    if (!initialView) load();
  }, [initialView, load]);

  async function handlePermissionChange(roleId, object, verb, scope) {
    setBusyKey(`${roleId}:${object}`);
    setSaveError(null);
    try {
      await api.setRolePermission({ roleId, object, verb, scope });
      await load();
      onDone?.();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleActionToggle(roleId, action, granted) {
    setBusyKey(`${roleId}:${action}`);
    setSaveError(null);
    try {
      await api.setRoleAction({ roleId, action, granted });
      await load();
      onDone?.();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleReset(roleId) {
    setBusyKey(`reset:${roleId}`);
    setSaveError(null);
    try {
      await api.resetRoleToPreset({ roleId });
      await load();
      onDone?.();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCreateRole() {
    if (!newRoleLabel.trim() || !newRoleBasedOn) return;
    setBusyKey("create");
    setSaveError(null);
    try {
      await api.createCustomRole({ label: newRoleLabel.trim(), basedOn: newRoleBasedOn });
      setNewRoleLabel("");
      setNewRoleBasedOn("");
      await load();
      onDone?.();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusyKey(null);
    }
  }

  if (phase === "loading") return <ScreenState phase="loading" />;
  if (phase === "denied") return <ScreenState phase="denied" />;
  if (phase === "error") return <ScreenState phase="error" error={{ message: error?.message ?? String(error) }} onRetry={load} />;
  if (!view) return null;

  const { roles = [], vocabulary = {}, notice } = view;
  const objects = vocabulary.objects ?? [];
  const verbs = vocabulary.verbs ?? ["none", "view", "edit", "delete"];
  const scopes = vocabulary.scopes ?? ["none", "owned", "team", "everything"];
  const ownerless = vocabulary.ownerless ?? [];

  return (
    <div className="flex flex-col gap-6 p-6" data-testid="team-roles-screen">
      <div className="flex items-start justify-between gap-4">
        <div>
          <PageTitle>Roles and access</PageTitle>
          <p className="mt-1 text-sm text-mute">
            Who can do what in this practice. Changes apply immediately and everywhere — this is the
            one place that decides it, not a per-screen setting.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onNavigate?.("/people/team")}>
          Back to Team
        </Button>
      </div>

      {notice && (
        <div className="rounded-lg border border-warn-border bg-warn-soft px-4 py-3 text-sm text-warn" role="status">
          {notice}
        </div>
      )}
      {saveError && (
        <div className="rounded-lg border border-bad-border bg-bad-soft px-4 py-3 text-sm text-bad" role="alert">
          {saveError}
        </div>
      )}

      {roles.map((role) => (
        <section key={role.id} className="rounded-card border border-line bg-surface" data-testid={`role-card-${role.key}`}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="m-0 text-base font-semibold text-ink">{role.label}</h2>
              <p className="m-0 text-xs text-mute">
                {role.member_count ?? role.members ?? 0} {role.member_count === 1 ? "person" : "people"}
                {role.is_builtin ? " · built in" : " · custom"}
              </p>
            </div>
            {role.is_builtin && (
              <Button
                variant="outline" size="sm"
                disabled={busyKey === `reset:${role.id}`}
                onClick={() => handleReset(role.id)}
              >
                {busyKey === `reset:${role.id}` ? "Resetting…" : "Reset to presets"}
              </Button>
            )}
          </div>

          {/* Named actions — plain on/off switches */}
          <div className="border-b border-hair px-4 py-3">
            <h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-mute">What they can do</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
              {Object.keys(ACTION_LABELS).map((action) => {
                const granted = (role.actions ?? []).includes(action);
                return (
                  <label key={action} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={granted}
                      disabled={busyKey === `${role.id}:${action}`}
                      onChange={(e) => handleActionToggle(role.id, action, e.target.checked)}
                    />
                    {ACTION_LABELS[action]}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Per-object grants — view/edit/delete × none/owned/team/everything */}
          <div className="px-4 py-3">
            <h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-mute">What they can see and change</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left text-xs font-medium text-mute">Area</th>
                  <th className="px-2 py-1 text-left text-xs font-medium text-mute">Scope</th>
                </tr>
              </thead>
              <tbody>
                {objects.map((obj) => {
                  const grant = (role.grants ?? []).find((g) => g.object === obj.key);
                  const isOwnerless = ownerless.includes(obj.key) || obj.ownable === false;
                  const legalScopes = isOwnerless ? scopes.filter((s) => s === "none" || s === "everything") : scopes;
                  return (
                    <tr key={obj.key} className="border-t border-hair">
                      <td className="px-2 py-1.5 text-ink">{obj.label ?? obj.key}</td>
                      <td className="px-2 py-1.5">
                        <NativeSelect
                          value={grant ? `${grant.verb}:${grant.scope}` : "none:none"}
                          disabled={busyKey === `${role.id}:${obj.key}`}
                          onChange={(e) => {
                            const [verb, scope] = e.target.value.split(":");
                            handlePermissionChange(role.id, obj.key, verb, scope);
                          }}
                        >
                          <NativeSelectOption value="none:none">No access</NativeSelectOption>
                          {verbs.filter((v) => v !== "none").flatMap((v) =>
                            legalScopes.filter((s) => s !== "none").map((s) => (
                              <NativeSelectOption key={`${v}:${s}`} value={`${v}:${s}`}>
                                {v === "view" ? "View" : v === "edit" ? "Edit" : "Delete"} — {s === "owned" ? "their own" : s === "team" ? "their team's" : "the whole practice"}
                              </NativeSelectOption>
                            ))
                          )}
                        </NativeSelect>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/* Add a custom role */}
      <section className="rounded-card border border-line border-dashed bg-surface p-4" data-testid="add-custom-role">
        <h2 className="m-0 mb-2 text-sm font-semibold text-ink">Add a custom role</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-mute" htmlFor="new-role-label">Name</label>
            <input
              id="new-role-label"
              type="text"
              value={newRoleLabel}
              onChange={(e) => setNewRoleLabel(e.target.value)}
              placeholder="e.g. Front desk"
              className="h-9 rounded-lg border border-line px-3 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-mute" htmlFor="new-role-based-on">Start from</label>
            <NativeSelect id="new-role-based-on" value={newRoleBasedOn} onChange={(e) => setNewRoleBasedOn(e.target.value)}>
              <NativeSelectOption value="">Choose a role…</NativeSelectOption>
              {roles.map((r) => (
                <NativeSelectOption key={r.id} value={r.id}>{r.label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button
            onClick={handleCreateRole}
            disabled={!newRoleLabel.trim() || !newRoleBasedOn || busyKey === "create"}
          >
            {busyKey === "create" ? "Adding…" : "Add role"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-mute">
          The new role starts with exactly the permissions of the one you pick — change them below after.
        </p>
      </section>
    </div>
  );
}
