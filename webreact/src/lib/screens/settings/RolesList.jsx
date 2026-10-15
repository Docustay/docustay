// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RP.3 — RolesList screen. Displays roles from GET /api/settings/roles with "New role" button
// enabled, calling onNavigate to NewRoleSheet. Follows LedgerPage archetype.
// Props: { onNavigate }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function RolesList({ onNavigate = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.get("/api/settings/roles");
        setData(response);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      } finally {
        setLoading(false);
      }
    };

    fetchRoles();
  }, []);

  const phase = (() => {
    if (loading) return "loading";
    if (error) return "error";
    return "ready";
  })();

  const roles = data?.roles ?? [];

  const emptyPropFor = () => {
    if (error) {
      return {
        kind: "error",
        headline: "Couldn't load roles",
        line: error,
        action: null,
      };
    }
    return {
      kind: "empty",
      headline: "No roles",
      line: "",
      action: null,
    };
  };

  return (
    <LedgerPage
      title="Roles"
      summary={roles.length === 1 ? "One role" : `${roles.length} roles`}
      primary={{
        label: "New role",
        onClick: () => onNavigate?.("/settings/roles/new"),
      }}
      testId="roles-list"
    >
      {phase === "ready" ? (
        <ul data-testid="roles-list" className="m-0 list-none rounded-card border border-line bg-surface p-0">
          {roles.map((role) => (
            <li
              key={role.key}
              data-testid={`roles-list-row-${role.key}`}
              className="flex items-center gap-2.5 border-b border-hair px-4.25 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <h3 className="m-0 text-ui font-medium text-ink">{role.label}</h3>
                <span className="text-caption text-mute">
                  {role.member_count ?? role.members} {(role.member_count ?? role.members) === 1 ? "person" : "people"}
                </span>
              </div>
              {role.is_custom && (
                <span className="inline-flex h-(--size-chip) items-center rounded-chip bg-mute-bg px-2 text-caption font-medium text-mute">Custom</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <ScreenState
          phase={phase}
          empty={emptyPropFor()}
          testIds={{ loading: "roles-list-loading", error: "roles-list-error" }}
          onRetry={() => window.location.reload()}
        />
      )}
    </LedgerPage>
  );
}
