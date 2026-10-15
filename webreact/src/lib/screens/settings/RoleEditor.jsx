// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RP.4 — RoleEditor screen. Shows role permissions in three sections:
// 1. 20 plain-English rows (from RolesScreen.svelte)
// 2. Object/access/reach table (NEW)
// 3. 15 action switches (NEW)
// Props: { roleKey, onNavigate }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import { VERBS, SCOPES, verbRank, scopeRank } from "@keystone/permissions/objects.mjs";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import PageHeader from "@/lib/lists/PageHeader.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import RoleGrid from "./RoleGrid.jsx";

export default function RoleEditor({ roleKey, onNavigate = null }) {
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rank, setRank] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [draftGrants, setDraftGrants] = useState({});
  const [draftActions, setDraftActions] = useState(new Set());
  const [loadedForRoleId, setLoadedForRoleId] = useState(null);

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.roleSettings();
        setView(response);
        // Note: In a full app, rank would come from the session/permissions
        // For now, we assume admin access (this is managed server-side)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      } finally {
        setLoading(false);
      }
    };

    fetchRoles();
  }, []);

  if (loading) {
    return <ScreenState phase="loading" testIds={{ loading: "role-editor-loading" }} />;
  }

  if (error) {
    return (
      <ScreenState
        phase="error"
        empty={{
          kind: "error",
          headline: "Couldn't load roles",
          line: error,
        }}
        testIds={{ error: "role-editor-error" }}
        onRetry={() => window.location.reload()}
      />
    );
  }

  const roles = view?.roles ?? [];
  const role = roles.find((r) => r.key === roleKey) ?? roles[0];

  // Sync draft state when role changes
  useEffect(() => {
    if (role && role.id !== loadedForRoleId) {
      setDraftGrants(
        Object.fromEntries((role.grants ?? []).map((g) => [g.object, { verb: g.verb, scope: g.scope }]))
      );
      setDraftActions(new Set(role.actions ?? []));
      setLoadedForRoleId(role.id);
      setSaveError(null);
    }
  }, [role, loadedForRoleId]);

  if (!role) {
    return (
      <ScreenState
        phase="ready"
        empty={{
          kind: "empty",
          headline: "Role not found",
          line: "No role could be loaded.",
        }}
        testIds={{ empty: "role-editor-no-role" }}
      />
    );
  }

  const canEdit = true; // TODO: Check against actual rank once integrated
  const isBuiltIn = role.is_builtin;

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);

      // Save all changed grants
      const currentGrants = Object.fromEntries(
        (role.grants ?? []).map((g) => [g.object, { verb: g.verb, scope: g.scope }])
      );

      for (const [object, grant] of Object.entries(draftGrants)) {
        const current = currentGrants[object];
        if (!current || current.verb !== grant.verb || current.scope !== grant.scope) {
          await api.setRolePermission({
            roleId: role.id,
            object,
            verb: grant.verb,
            scope: grant.scope,
          });
        }
      }

      // Save all changed actions
      const currentActions = new Set(role.actions ?? []);
      for (const action of draftActions) {
        if (!currentActions.has(action)) {
          await api.setRoleAction({
            roleId: role.id,
            action,
            granted: true,
          });
        }
      }
      for (const action of currentActions) {
        if (!draftActions.has(action)) {
          await api.setRoleAction({
            roleId: role.id,
            action,
            granted: false,
          });
        }
      }

      // Refresh the view to confirm changes
      const response = await api.roleSettings();
      setView(response);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="role-editor">
      <PageHeader title={`${role.label} — what they can do`}>
        {/* snippet actions() */}
        {isBuiltIn ? (
          <button
            type="button"
            className="inline-flex h-(--size-control-sm) items-center justify-center gap-2 rounded-sm border border-line bg-surface px-3.25 text-control font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
            data-testid="roles-advanced-back-to-preset"
            disabled={!canEdit || !role}
            onClick={() => {
              // TODO: Implement reset logic
            }}
          >
            Back to the preset
          </button>
        ) : (
          <>
            <button
              type="button"
              className="inline-flex h-(--size-control-sm) items-center justify-center gap-2 rounded-sm border border-line bg-surface px-3.25 text-control font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
              data-testid="role-rename"
              disabled={!canEdit || !role}
              onClick={() => {
                // TODO: Implement rename logic
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="inline-flex h-(--size-control-sm) items-center justify-center gap-2 rounded-sm border border-line bg-surface px-3.25 text-control font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
              data-testid="role-delete"
              disabled={!canEdit || !role}
              onClick={() => {
                // TODO: Implement delete logic
              }}
            >
              Delete role
            </button>
          </>
        )}
        <button
          type="button"
          className="inline-flex h-(--size-control-sm) items-center justify-center gap-2 rounded-sm border border-brand bg-brand px-3.25 text-control font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          data-testid="roles-advanced-save"
          disabled={!canEdit || !role || saving}
          onClick={handleSave}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {/* /snippet */}
      </PageHeader>

      <p className="mt-1.5 text-control text-mute" data-testid="roles-advanced-subtitle">
        Change anything here and it applies to everyone on that role.
      </p>

      <LastChanged at={null} by={null} label="Last changed" testId="roles-advanced-last-changed" />

      {view?.notice && (
        <p className="mt-3 rounded-card border border-line bg-surface-2 px-3.5 py-2.5 text-ui text-ink-2" data-testid="roles-advanced-notice" role="status">
          {view.notice}
        </p>
      )}

      {!canEdit && (
        <p className="mt-1.5 text-control text-mute" data-testid="role-editor-readonly">
          You can see this but not change it. Changing a permission is an admin action.
        </p>
      )}

      {saveError && (
        <p className="mt-3 rounded-card border border-bad-border bg-bad-bg px-3.5 py-2.5 text-ui text-bad" data-testid="role-editor-save-error" role="status">
          {saveError}
        </p>
      )}

      {/* Section 1: Plain-English rows */}
      <section className="mb-4.5 rounded-card border border-line bg-surface px-4.25 py-3.5" data-testid="role-editor-common">
        <h2 className="m-0 mb-3 text-heading font-medium text-ink">Permissions</h2>
        <RoleCommonSection role={role} canEdit={canEdit} draftGrants={draftGrants} draftActions={draftActions} setDraftGrants={setDraftGrants} setDraftActions={setDraftActions} />
      </section>

      {/* Sections 2 & 3: Grid and Actions */}
      <RoleGrid role={role} view={view} canEdit={canEdit} draftGrants={draftGrants} draftActions={draftActions} setDraftGrants={setDraftGrants} setDraftActions={setDraftActions} />
    </div>
  );
}

function RoleCommonSection({ role, canEdit, draftGrants, draftActions, setDraftGrants, setDraftActions }) {
  function readGrant(object) {
    return draftGrants[object] ?? { verb: "none", scope: "none" };
  }

  function updateGrant(object, updates) {
    const grant = readGrant(object);
    setDraftGrants({
      ...draftGrants,
      [object]: { ...grant, ...updates },
    });
  }

  function rowChecked(row) {
    if (row.kind === "verb") {
      return verbRank(readGrant(row.object).verb) >= verbRank(row.atLeast);
    }
    if (row.kind === "scope") {
      return scopeRank(readGrant(row.object).scope) >= scopeRank(row.atLeast);
    }
    if (row.kind === "action") {
      return draftActions.has(row.action);
    }
    if (row.kind === "actions2") {
      return row.actions.every((a) => draftActions.has(a));
    }
    return Boolean(row.fixedChecked);
  }

  function handleToggle(row, checked) {
    if (row.kind === "verb") {
      const current = readGrant(row.object);
      updateGrant(row.object, {
        verb: checked ? row.atLeast : "none",
        scope: checked ? (current.scope === "none" ? row.scopeDefault : current.scope) : "none",
      });
    } else if (row.kind === "scope") {
      const current = readGrant(row.object);
      updateGrant(row.object, {
        verb: checked ? (current.verb === "none" ? row.verbDefault : current.verb) : "none",
        scope: checked ? row.atLeast : "none",
      });
    } else if (row.kind === "action") {
      const next = new Set(draftActions);
      if (checked) {
        next.add(row.action);
      } else {
        next.delete(row.action);
      }
      setDraftActions(next);
    } else if (row.kind === "actions2") {
      const next = new Set(draftActions);
      for (const a of row.actions) {
        if (checked) {
          next.add(a);
        } else {
          next.delete(a);
        }
      }
      setDraftActions(next);
    }
  }

  return (
    <>
      {GROUPS.map((group) => (
        <div key={group.key}>
          {group.rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 border-b border-hair py-2.5 last:border-b-0" data-testid={`roles-advanced-row-${row.id}`}>
              <span className="flex flex-col">
                <span className="text-ui text-ink">{row.label}</span>
                {row.detail && <span className="mt-0.5 text-caption text-mute">{row.detail}</span>}
              </span>
              {row.kind === "unsupported" ? (
                <DisabledWithReason disabled={true} reason={row.reason} testId={`roles-advanced-switch-${row.id}`}>
                  <Switch
                    data-testid={`roles-advanced-switch-${row.id}-control`}
                    checked={rowChecked(row)}
                    disabled={true}
                    aria-label={row.label}
                    onCheckedChange={() => {}}
                  />
                </DisabledWithReason>
              ) : (
                <Switch
                  data-testid={`roles-advanced-switch-${row.id}`}
                  checked={rowChecked(row)}
                  disabled={!canEdit}
                  aria-label={row.label}
                  onCheckedChange={(checked) => handleToggle(row, checked)}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// The 20 plain-English rows (ported from RolesScreen.svelte)
const GROUPS = [
  {
    key: "clients",
    title: "Clients",
    rows: [
      {
        id: "person-own",
        label: "See their own clients",
        detail: "People booked with them",
        kind: "verb",
        object: "person",
        atLeast: "view",
        scopeDefault: "owned",
      },
      {
        id: "person-everyone",
        label: "See everyone's clients",
        detail: "The whole book",
        kind: "scope",
        object: "person",
        atLeast: "everything",
        verbDefault: "view",
      },
      {
        id: "person-edit",
        label: "Add and edit clients",
        detail: "Including contact details",
        kind: "verb",
        object: "person",
        atLeast: "edit",
        scopeDefault: "owned",
      },
      {
        id: "person-archive",
        label: "Archive a client",
        detail: "Hide someone from the lists",
        kind: "action",
        action: "record.archive",
      },
      {
        id: "person-delete",
        label: "Delete a client for good",
        detail: "Nobody but an owner should have this",
        kind: "verb",
        object: "person",
        atLeast: "delete",
        scopeDefault: "everything",
      },
    ],
  },
  {
    key: "money",
    title: "Money",
    rows: [
      {
        id: "invoice-view",
        label: "See any money at all",
        detail: "Invoices, payments, prices, reports",
        kind: "verb",
        object: "invoice",
        atLeast: "view",
        scopeDefault: "everything",
      },
      {
        id: "invoice-send",
        label: "Send an invoice",
        detail: "",
        kind: "verb",
        object: "invoice",
        atLeast: "edit",
        scopeDefault: "everything",
      },
      {
        id: "invoice-payment",
        label: "Take a payment in person",
        detail: "Tap to Pay and the card reader",
        kind: "unsupported",
        fixedChecked: false,
        reason: 'There\'s no separate permission for this yet — it follows "send an invoice".',
      },
      {
        id: "invoice-refund",
        label: "Refund",
        detail: "",
        kind: "action",
        action: "invoice.refund",
      },
    ],
  },
  {
    key: "sessions",
    title: "Sessions and notes",
    rows: [
      {
        id: "engagement-own",
        label: "Book and move sessions",
        detail: "Their own calendar",
        kind: "verb",
        object: "engagement",
        atLeast: "edit",
        scopeDefault: "owned",
      },
      {
        id: "engagement-others",
        label: "Book for someone else",
        detail: `On another coach's calendar`,
        kind: "scope",
        object: "engagement",
        atLeast: "everything",
        verbDefault: "edit",
      },
      {
        id: "note-write",
        label: "Write notes",
        detail: "On their own clients",
        kind: "verb",
        object: "note",
        atLeast: "edit",
        scopeDefault: "owned",
      },
      {
        id: "note-read-others",
        label: `Read other coaches' notes`,
        detail: "",
        kind: "scope",
        object: "note",
        atLeast: "everything",
        verbDefault: "view",
      },
    ],
  },
  {
    key: "documents",
    title: "Documents",
    rows: [
      {
        id: "document-send",
        label: "Send a document",
        detail: "",
        kind: "verb",
        object: "document",
        atLeast: "edit",
        scopeDefault: "owned",
      },
      {
        id: "document-status",
        label: "See whether it's signed",
        detail: "",
        kind: "verb",
        object: "document",
        atLeast: "view",
        scopeDefault: "owned",
      },
      {
        id: "document-template",
        label: "Change a template",
        detail: "",
        kind: "action",
        action: "template.author",
      },
    ],
  },
  {
    key: "settings",
    title: "Settings",
    rows: [
      {
        id: "settings-own-profile",
        label: "Change their own profile and hours",
        detail: "",
        kind: "unsupported",
        fixedChecked: true,
        reason: "Everyone can always do this — there's no separate permission for their own profile.",
      },
      {
        id: "settings-practice",
        label: "Change practice settings",
        detail: "",
        kind: "verb",
        object: "setting",
        atLeast: "edit",
        scopeDefault: "everything",
      },
      {
        id: "settings-invite-remove",
        label: "Invite or remove people",
        detail: "",
        kind: "actions2",
        actions: ["team.invite", "team.remove"],
      },
    ],
  },
];
