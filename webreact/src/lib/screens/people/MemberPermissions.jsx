// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RP.6 — MemberPermissions. Section showing a team member's permissions, to be mounted on the
// person record. Props: { person, rank, onChanged }
//
// ★★★ the maintainer's brief, 1 Oct 2026 — the status block below (suspend/reactivate) is the real,
//     previously-missing mechanism for "suspend a team member": POST /api/people/team/:id/suspend
//     and /reactivate (src/people/offboard.mjs, src/routes/index.mjs), gated server-side on
//     `staff_role.change` and refused outright for the Owner — the button here just mirrors that
//     with `rank`, the same way every other admin-only control in this codebase hides rather than
//     lets the server answer 403 for something the UI could have simply not offered.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";

export default function MemberPermissions({ person = null, rank = null, onChanged = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [overrideCount, setOverrideCount] = useState(0);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState(null);

  const firstName = person?.display_name?.split(" ")[0] ?? "this person";
  const canChangeStatus = rank === "owner" || rank === "admin";
  const isOwnerRow = person?.staff_role === "owner";
  const lifecycleStatus = person?.lifecycle_status ?? "active";
  const isSuspended = lifecycleStatus === "paused";
  const isFormer = lifecycleStatus === "former";

  async function handleSuspend() {
    if (!person?.id) return;
    setStatusBusy(true);
    setStatusError(null);
    try {
      await api.suspendTeamMember({ personId: person.id });
      onChanged?.({ action: "suspend" });
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleReactivate() {
    if (!person?.id) return;
    setStatusBusy(true);
    setStatusError(null);
    try {
      await api.reactivateTeamMember({ personId: person.id });
      onChanged?.({ action: "reactivate" });
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setStatusBusy(false);
    }
  }

  // In a real implementation, this would fetch the member's permissions from an API.
  // For now, we're setting up the structure.
  useEffect(() => {
    if (!person?.id) return;

    const fetchPermissions = async () => {
      try {
        setLoading(true);
        setError(null);
        // Note: This is a placeholder. The actual endpoint would be determined by the
        // RP.2 task which provides the member routes.
        // For now, we just initialize with empty state.
        setData({
          role: person.role || `coach`,
          overrides: [],
        });
        setOverrideCount(0);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      } finally {
        setLoading(false);
      }
    };

    fetchPermissions();
  }, [person?.id]);

  if (!person) {
    return null;
  }

  const roleLabel = data?.role ?? person.role ?? "Team member";
  const hasChanges = overrideCount > 0;
  const statusLine =
    hasChanges
      ? `${roleLabel}, with ${overrideCount} change${overrideCount === 1 ? "" : "s"}`
      : roleLabel;

  return (
    <section data-testid="member-permissions" className="mt-4.5 rounded-card border border-line bg-surface px-4.25 py-3.5">
      {!isFormer && (
        <div
          data-testid="member-status"
          className="mb-3.5 flex items-center justify-between gap-3 border-b border-hair pb-3.5"
        >
          <div>
            <h3 className="m-0 text-heading font-medium text-ink">Access</h3>
            <p className="m-0 mt-0.5 text-ui text-ink-2">
              {isSuspended
                ? `${firstName}'s access is suspended — they cannot sign in until this is reversed.`
                : `${firstName} can sign in and work normally.`}
            </p>
          </div>
          {canChangeStatus && !isOwnerRow && (
            <Button
              variant={isSuspended ? "default" : "outline"}
              onClick={isSuspended ? handleReactivate : handleSuspend}
              disabled={statusBusy}
              data-testid={isSuspended ? "member-reactivate" : "member-suspend"}
            >
              {statusBusy ? "Working…" : isSuspended ? "Reactivate" : "Suspend"}
            </Button>
          )}
        </div>
      )}
      {statusError && (
        <p className="mb-3.5 -mt-1 text-meta text-bad" role="alert" data-testid="member-status-error">
          {statusError}
        </p>
      )}

      <h3 className="m-0 text-heading font-medium text-ink">What {firstName} can do</h3>

      <div className="mt-1.5">
        <span
          data-testid={hasChanges ? "member-permissions-changes" : undefined}
          className="text-ui text-ink-2"
        >
          {statusLine}
        </span>
      </div>

      {error && (
        <p className="mt-1.5 text-meta text-bad" role="alert">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          variant="outline"
          onClick={() => onChanged?.({ action: "edit" })}
          disabled={loading}
          data-testid="member-permissions-edit"
        >
          Change for {firstName}
        </Button>

        {hasChanges && (
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                setLoading(true);
                await api.post("/api/settings/members/reset", {
                  userId: person.id,
                });
                setOverrideCount(0);
                onChanged?.({ action: "reset" });
              } catch (err) {
                setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            data-testid="member-permissions-reset"
          >
            Back to {roleLabel}
          </Button>
        )}
      </div>
    </section>
  );
}
