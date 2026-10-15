// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TASK R4.012 — TeamListScreen. Ported from webui/src/lib/screens/people/TeamListScreen.svelte
// (444 lines, 46 in <style>). Built on LedgerPage archetype. Layout from frames, behaviour from
// Svelte source.
//
// ★★★ SCREEN STATES: loading/error/denied are handled by Screen.svelte's outer machine
// (Screen.svelte:784-792) — this component only renders once real data has arrived. Solo state
// renders the "What changes when someone else joins" layout IN PLACE OF the table (Svelte line 258).
//
// ★★★ INDEPENDENT BAND FETCH: "Worth knowing" prompts (api.prompts("team")) is an independent
//     client fetch, not part of the outer composite Screen.svelte already resolved (bands fail
//     independently per F01 §7). This band's own failure must not take the whole screen down.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import { Avatar, AvatarFallback } from "@/lib/components/ui/avatar.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { RANK_LABEL } from "@/lib/permissions/rank.js";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function formatInvitedDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Invited ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "?";
}

function pl(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function TeamListScreen({ data = null, rank = null, onNavigate = null, onDone = null, onSeeAs = null, myAppUserId = null }) {
  const roster = useMemo(() => data?.roster ?? { rows: [], emptyState: null }, [data?.roster]);
  const invites = useMemo(() => data?.invites ?? { rows: [], emptyState: null }, [data?.invites]);
  const seats = useMemo(() => data?.seats ?? { used: 0, limit: null, planKey: null }, [data?.seats]);

  // TeamSolo — signed-in staff member always sees at least themselves, so "solo" is ≤ 1, not === 0
  const solo = useMemo(() => roster.rows.length <= 1, [roster.rows.length]);

  // Only pending invites (status === "pending")
  const pendingInvites = useMemo(() => invites.rows.filter((r) => r.status === "pending"), [invites.rows]);

  // ONE TABLE: roster rows and pending-invite rows normalized to same shape, roster first
  const combinedRows = useMemo(() => [
    ...roster.rows.map((r) => ({ kind: "staff", ...r })),
    ...pendingInvites.map((r) => ({ kind: "invite", ...r })),
  ], [roster.rows, pendingInvites]);

  // "Worth knowing" prompts — independent fetch
  const [prompts, setPrompts] = useState([]);
  const [promptsPhase, setPromptsPhase] = useState("loading");
  const [promptsError, setPromptsError] = useState(null);
  const [dismissingKey, setDismissingKey] = useState(null);

  async function loadPrompts() {
    setPromptsPhase("loading");
    setPromptsError(null);
    try {
      const res = await api.prompts("team");
      setPrompts(res?.prompts ?? []);
      setPromptsPhase("ready");
    } catch (err) {
      setPromptsError(err instanceof ApiError ? { message: err.message, requestId: err.requestId }
        : { message: String(err?.message ?? err) });
      setPromptsPhase("error");
    }
  }

  useEffect(() => {
    loadPrompts();
  }, []);

  async function dismiss(p) {
    if (dismissingKey) return;
    setDismissingKey(p.dismissKey);
    try {
      await api.dismissPrompt(p.kind, p.subjectId);
      setPrompts((prev) => prev.filter((x) => x.dismissKey !== p.dismissKey));
    } catch {
      // Left on screen on failure — a prompt that vanished on a failed dismiss would hide
      // a dismiss that silently didn't happen.
    } finally {
      setDismissingKey(null);
    }
  }

  // Summary sentence
  const summary = useMemo(() => {
    if (solo) return "Just you, which is how most practices run.";
    const n = roster.rows.length;
    const k = pendingInvites.length;
    let s = `${n} people and ${pl(k, "invitation")}.`;
    if (seats.limit !== null) {
      const left = Math.max(0, seats.limit - seats.used);
      s += ` ${pl(left, "seat")} left before it costs more.`;
    }
    return s;
  }, [solo, roster.rows.length, pendingInvites.length, seats.limit, seats.used]);

  // State for a row (staff or invite)
  function stateFor(row) {
    if (row.kind === "invite") return { tone: "mute", text: "Hasn't accepted" };
    if (row.away) return { tone: "warn", text: row.away };
    return { tone: "ok", text: "Active" };
  }

  // Role label
  function inviteRoleLabel(role) {
    return RANK_LABEL[role] ??
      String(role ?? "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }

  function roleLabel(row) {
    return row.kind === "invite" ? inviteRoleLabel(row.invited_role) : (RANK_LABEL[row.staff_role] ?? row.staff_role);
  }

  // Email column
  function emailColumn(row) {
    return row.kind === "invite" ? formatInvitedDate(row.sent_at) : row.email;
  }

  // Sessions text
  function sessionsText(row) {
    if (row.kind === "invite") return "—";
    const n = row.sessions_this_year ?? 0;
    return pl(n, "session");
  }

  // Where text
  function whereText(row) {
    return row.kind === "invite" ? "—" : (row.where_they_work || "—");
  }

  // Find person ID for an invite row
  function personIdForInvite(inviteRow) {
    const email = (inviteRow.email ?? "").toLowerCase();
    return roster.rows.find((r) => (r.email ?? "").toLowerCase() === email)?.id ?? null;
  }

  // Actions
  async function seeAs(row) {
    await onSeeAs?.(row.id);
    onNavigate?.("/home");
  }

  async function resend(personId) {
    await api.resendInvitePerson({ personId });
    onDone?.();
  }

  async function cancelInvite(inviteRow) {
    await api.cancelInvite({ inviteId: inviteRow.id });
    onDone?.();
  }

  function actionsFor(row) {
    if (row.kind === "invite") {
      const actions = [];
      const personId = personIdForInvite(row);
      if (personId) actions.push({ id: "resend", label: "Resend", onRun: () => resend(personId) });
      actions.push({ id: "cancel", label: "Cancel invite", destructive: true, onRun: () => cancelInvite(row) });
      return actions;
    }
    if (row.staff_role === "owner" || row.id === myAppUserId) return [];
    const actions = [];
    if (onSeeAs) actions.push({ id: "see-as", label: "See as", onRun: () => seeAs(row) });
    actions.push({
      id: "remove", label: "Remove", destructive: true,
      onRun: () => { onNavigate?.(`/people/team/${row.id}/remove`); },
    });
    return actions;
  }

  const STATE_CHIP_CLASS = { ok: "bg-chip-ok text-chip-ok-ink", warn: "bg-chip-warn text-chip-warn-ink", mute: "bg-chip-neutral text-chip-neutral-ink" };

  return (
    <LedgerPage
      title="Your team"
      summary={summary}
      primary={{ label: "Invite someone", onClick: () => onNavigate?.("/people/team?invite=1") }}
      headerAction={solo ? null : { label: "Who can do what", onClick: () => onNavigate?.("/settings/roles/presets") }}
      testId="team-list"
    >
      {solo ? (
        /* TeamSolo state */
        <div className="flex flex-col" data-testid="team-solo">
          <div className="flex gap-5.5 items-start" data-testid="team-solo-cols">
            <div className="flex-1 min-w-0">
              <div className="bg-surface border border-line rounded-card" data-testid="team-solo-changes">
                <div className="px-4.25 py-3.5 border-b border-hair font-medium text-sm"><b>What changes when someone else joins</b></div>
                <div className="px-4.25 py-1.5 flex flex-col">
                  <div className="flex items-start py-2.75 border-b border-hair text-sm">
                    <span className="flex-1 flex flex-col gap-0.5">
                      <span>Clients get asked who they want to see</span>
                      <span className="text-xs text-mute">Right now every booking comes to you, so that step is skipped entirely.</span>
                    </span>
                  </div>
                  <div className="flex items-start py-2.75 border-b border-hair text-sm">
                    <span className="flex-1 flex flex-col gap-0.5">
                      <span>Notes get a visibility setting</span>
                      <span className="text-xs text-mute">Yours only, or the team's.</span>
                    </span>
                  </div>
                  <div className="flex items-start py-2.75 border-b border-hair text-sm">
                    <span className="flex-1 flex flex-col gap-0.5">
                      <span>Money can be hidden</span>
                      <span className="text-xs text-mute">Staff see clients and sessions with no money anywhere.</span>
                    </span>
                  </div>
                  <div className="flex items-start py-2.75 text-sm">
                    <span className="flex-1 flex flex-col gap-0.5">
                      <span>Shifts start to matter</span>
                      <span className="text-xs text-mute">With one person, availability is enough.</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="w-80 flex-0">
              <div className="bg-surface border border-line rounded-card" data-testid="team-solo-seats">
                <div className="px-4.25 py-3.5 border-b border-hair font-medium text-sm"><b>Seats</b></div>
                <div className="px-4.25 py-1.5 flex flex-col">
                  <div className="flex items-start py-2.75 border-b border-hair text-sm">
                    <span className="flex-1 flex flex-col gap-0.5">
                      <span>{seats.used} of {seats.limit ?? "—"} used</span>
                      <span className="text-xs text-mute">{seats.limit !== null ? `${Math.max(0, seats.limit - seats.used)} more at no extra cost` : "No seat limit set yet"}</span>
                    </span>
                  </div>
                  <div className="flex items-start py-2.75 text-sm">
                    <span className="flex-1 flex flex-col gap-0.5">
                      <span>$12 a month each after that</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Non-solo state with table and bands */
        <>
          {/* Table */}
          <div className="overflow-auto rounded-card border border-line bg-surface" data-testid="team-roster-scroll">
            <table className="w-full border-collapse" data-testid="team-roster">
              <thead>
                <tr>
                  <th scope="col" className="h-9.5 px-4 text-left text-caption font-medium text-mute border-b border-line bg-surface-2">Name</th>
                  <th scope="col" className="h-9.5 px-4 text-left text-caption font-medium text-mute border-b border-line bg-surface-2">Role</th>
                  <th scope="col" className="h-9.5 px-4 text-left text-caption font-medium text-mute border-b border-line bg-surface-2">Email</th>
                  <th scope="col" className="h-9.5 px-4 text-left text-caption font-medium text-mute border-b border-line bg-surface-2">This year</th>
                  <th scope="col" className="h-9.5 px-4 text-left text-caption font-medium text-mute border-b border-line bg-surface-2">Where they work</th>
                  <th scope="col" className="h-9.5 px-4 text-left text-caption font-medium text-mute border-b border-line bg-surface-2">State</th>
                  <th scope="col" className="h-9.5 px-4 text-left text-caption font-medium text-mute border-b border-line bg-surface-2"></th>
                </tr>
              </thead>
              <tbody>
                {combinedRows.map((row) => {
                  const st = stateFor(row);
                  return (
                    <tr key={`${row.kind}:${row.id}`} data-testid={`team-row-${row.kind}-${row.id}`} className="last:[&>td]:border-b-0">
                      <td className="h-11.5 px-4 border-b border-hair text-ui text-ink">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar className="w-7 h-7 flex-shrink-0 bg-chip-neutral text-chip-neutral-ink">
                            <AvatarFallback className="text-xs font-medium">{row.kind === "invite" ? "??" : initials(row.display_name)}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-ink overflow-wrap break-words" title={row.kind === "invite" ? row.email : row.display_name}>{row.kind === "invite" ? row.email : row.display_name}</span>
                        </div>
                      </td>
                      <td className="h-11.5 px-4 border-b border-hair text-ui text-ink">
                        <Badge variant="default" className={`bg-chip-neutral text-chip-neutral-ink`} data-testid={`team-role-${row.id}`}>{roleLabel(row)}</Badge>
                      </td>
                      <td className="h-11.5 px-4 border-b border-hair text-ui text-ink" data-testid={`team-email-${row.id}`}>{emailColumn(row)}</td>
                      <td className="h-11.5 px-4 border-b border-hair text-ui text-ink font-variant-numeric" data-testid={`team-sessions-${row.id}`}>{sessionsText(row)}</td>
                      <td className="h-11.5 px-4 border-b border-hair text-ui text-ink" data-testid={`team-where-${row.id}`}>{whereText(row)}</td>
                      <td className="h-11.5 px-4 border-b border-hair text-ui">
                        <Badge className={`${STATE_CHIP_CLASS[st.tone] ?? "bg-chip-neutral text-chip-neutral-ink"}`} data-testid={`team-state-${row.id}`}>{st.text}</Badge>
                      </td>
                      <td className="h-11.5 px-4 border-b border-hair text-ui text-right">
                        <RowActions actions={actionsFor(row)} row={row} noDelete={row.kind === "invite" || row.staff_role === "owner" || row.id === myAppUserId} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Two-column bands below table */}
          <div className="flex gap-5.5 items-start mt-5" data-testid="team-cols">
            <div className="flex-1 min-w-0">
              <div className="bg-surface border border-line rounded-card" data-testid="team-worth-knowing">
                <div className="px-4.25 py-3.5 border-b border-hair font-medium text-sm"><b>Worth knowing</b></div>
                <div className="px-4.25 py-1.5 flex flex-col gap-1.5">
                  {promptsPhase === "loading" && (
                    <p className="text-xs text-mute m-0 py-2" data-testid="team-prompts-loading">Loading…</p>
                  )}
                  {promptsPhase === "error" && (
                    <ErrorPanel error={promptsError} subject="Worth knowing" onRetry={loadPrompts} testId="team-prompts-error" />
                  )}
                  {promptsPhase === "ready" && prompts.length === 0 && (
                    <p className="text-xs text-mute m-0 py-2" data-testid="team-prompts-empty">Nothing needs you here right now.</p>
                  )}
                  {promptsPhase === "ready" && prompts.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {prompts.map((p) => (
                        <PromptCard
                          key={p.dismissKey}
                          icon={p.icon}
                          tone={p.tone}
                          headline={p.headline}
                          why={p.why}
                          action={p.action}
                          kind={p.kind}
                          busy={dismissingKey === p.dismissKey}
                          onDismiss={() => dismiss(p)}
                          testId={`team-prompt-${p.dismissKey}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="w-80 flex-0">
              <div className="bg-surface border border-line rounded-card" data-testid="team-seats">
                <div className="px-4.25 py-3.5 border-b border-hair font-medium text-sm"><b>Seats</b></div>
                <div className="px-4.25 py-1.5 flex flex-col">
                  <div className="flex items-start py-2.75 border-b border-hair text-sm">
                    <span className="flex-1 flex flex-col gap-0.5">
                      <span>{seats.limit !== null ? `${seats.used} of ${seats.limit} used` : `${seats.used} used`}</span>
                      <span className="text-xs text-mute">{seats.limit !== null ? "$12 a month for each one after that" : "No seat limit set yet"}</span>
                    </span>
                  </div>
                  <div className="flex items-start py-2.75 text-sm">
                    <span className="flex-1 flex flex-col gap-0.5">
                      <span>An invitation uses a seat</span>
                      <span className="text-xs text-mute">Even before it's accepted</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </LedgerPage>
  );
}
