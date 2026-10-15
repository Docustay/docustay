// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CampaignGroupActions — P3.U25 (S5). Built FROM specs/mockups/CampaignGroupActions.frame.html's
// table row (Group · Campaigns · Status · actions: "Add a campaign" · "Rename" · "Delete") and its
// header's "New group" primary button, ported verbatim: same order, same labels, same text runs.
// There is no drawn frame for the sheets/dialogs these buttons open — the frame stops at the list —
// so their body fields follow CONTRACTS §4's request shapes and this codebase's own SideSheet /
// ActionSurface / DecisionModal house style (RefundRequestRow.jsx).
// ★ Five writes, one permission check each (campaign.edit, WIRING-MAP §3.3/§3.4 · S5), five error
//   bands — `write.error`, never re-worded (api.js's own rule):
//     · New group   → `createCampaignGroup` — SideSheet (name · status · goal · starts on · ends on).
//     · Rename      → `updateCampaignGroup` — a small ActionSurface dialog, name only; every other
//       field is resent unchanged from `group` (CONTRACTS §4 `{ groupId, name, status, goal, startsOn,
//       endsOn }` — a partial rename is not a partial wire body).
//     · Delete      → `deleteCampaignGroup` — DecisionModal, `danger` (destructive, per the frame).
//     · Add a campaign / Remove → `attachCampaignGroup` / `detachCampaignGroup` — one SideSheet drawer
//       listing the group's own attached campaigns (each with a "Remove" write) plus a Combobox of the
//       rest, read from the existing `api.campaigns()` list (api.js:2210, `/api/list/growth/campaigns`
//       — the "view" read named in DISPATCH.md; its response is normalised defensively below since no
//       other file names its exact shape). `kind` is always `"send"` — "Add a campaign" attaches a
//       campaign send, the only kind this control offers (attachCampaignGroup also accepts `"page"` /
//       `"segment"`, not exposed here — the frame draws only campaigns).
// ★ `useWrite`'s `hidden` decides ALL FIVE identically for a viewer without `campaign.edit`: every
//   WriteButton below renders NOTHING and the group's own figures (name, campaigns count, status)
//   still render — the positive control CLAUDE.md's rule requires.
// ★ A missing prerequisite is `write.blocked`, carried on `group.blockedReason` exactly like
//   RefundRequestRow/PauseDialog/AdjustCreditSheet: DISABLED WITH THE REASON, never hidden.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api.js";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/lib/components/ui/dropdown-menu.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import DatePicker from "@/lib/components/kit/DatePicker.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

const TD = "h-(--size-row) border-b border-hair px-4 text-ui text-ink";

const STATUS = {
  planning: { label: "Planning", tone: "neutral" },
  running: { label: "Running", tone: "ok" },
  paused: { label: "Paused", tone: "warn" },
  done: { label: "Done", tone: "act" },
};
const STATUS_OPTIONS = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }));

function ErrorText({ error, testId }) {
  if (!error) return null;
  return (
    <>
      <span data-testid={`${testId}-message`}>{error.message}</span>
      {error.requestId && (
        <>
          <br />
          <span className="text-meta text-mute" data-testid={`${testId}-reference`}>Reference: {error.requestId}</span>
        </>
      )}
    </>
  );
}

/**
 * @param group — `null`/`undefined` renders the "New group" control (the frame's header button).
 *   Otherwise `{ id, name, status, goal?, startsOn?, endsOn?, campaignsCount, campaigns?: [{id, name}],
 *   blockedReason? }` renders the frame's row (name · campaigns count · status · actions).
 *   `blockedReason` is the missing prerequisite, if any — the permission itself (`campaign.edit`) is
 *   decided by `useWrite`, never by this prop.
 * @param onChanged — called after any successful write, so the host screen refetches.
 */
export default function CampaignGroupActions({ group, onChanged }) {
  const create = useWrite("createCampaignGroup");
  const update = useWrite("updateCampaignGroup", { blockedReason: group?.blockedReason ?? null });
  const del = useWrite("deleteCampaignGroup", { blockedReason: group?.blockedReason ?? null });
  const attach = useWrite("attachCampaignGroup", { blockedReason: group?.blockedReason ?? null });
  const detach = useWrite("detachCampaignGroup", { blockedReason: group?.blockedReason ?? null });

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStatus, setNewStatus] = useState("planning");
  const [newGoal, setNewGoal] = useState("");
  const [newStartsOn, setNewStartsOn] = useState(null);
  const [newEndsOn, setNewEndsOn] = useState(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState(group?.name ?? "");

  const [deleteOpen, setDeleteOpen] = useState(false);

  const [campaignsOpen, setCampaignsOpen] = useState(false);
  const [available, setAvailable] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [pickValue, setPickValue] = useState("");

  async function loadCampaigns() {
    setLoadError(null);
    try {
      const res = await api.campaigns();
      const list = Array.isArray(res) ? res : (res?.campaigns ?? res?.items ?? []);
      setAvailable(list);
    } catch (err) {
      setLoadError(err);
    }
  }
  useEffect(() => { if (campaignsOpen) loadCampaigns(); }, [campaignsOpen]);

  const newNameInvalid = newName.trim().length === 0;

  async function handleCreate() {
    if (newNameInvalid) return;
    try {
      await create.run({
        name: newName.trim(), status: newStatus, goal: newGoal.trim() || null,
        startsOn: newStartsOn, endsOn: newEndsOn,
      });
      setNewOpen(false);
      setNewName(""); setNewStatus("planning"); setNewGoal(""); setNewStartsOn(null); setNewEndsOn(null);
      onChanged?.();
    } catch {
      // create.error is already set — the sheet stays open and shows it (below).
    }
  }

  const renameNameInvalid = renameName.trim().length === 0;

  async function handleRename() {
    if (renameNameInvalid) return;
    try {
      await update.run({
        groupId: group.id, name: renameName.trim(), status: group.status,
        goal: group.goal ?? null, startsOn: group.startsOn ?? null, endsOn: group.endsOn ?? null,
      });
      setRenameOpen(false);
      onChanged?.();
    } catch {
      // update.error is already set — the dialog stays open and shows it (below).
    }
  }

  async function handleDelete() {
    try {
      await del.run({ groupId: group.id });
      setDeleteOpen(false);
      onChanged?.();
    } catch {
      // del.error is already set — the modal stays open and shows it (below).
    }
  }

  async function handleAttach(campaignId) {
    if (!campaignId) return;
    try {
      await attach.run({ groupId: group.id, kind: "send", id: campaignId });
      setPickValue("");
      onChanged?.();
    } catch {
      // attach.error is already set — the drawer stays open and shows it (below).
    }
  }

  async function handleDetach(campaignId) {
    try {
      await detach.run({ groupId: group.id, kind: "send", id: campaignId });
      onChanged?.();
    } catch {
      // detach.error is already set — the drawer stays open and shows it (below).
    }
  }

  // ── header state: no group yet — the frame's "New group" primary button ─────────────────────────
  if (!group) {
    return (
      <>
        <WriteButton write={create} testId="campaign-group-new" onClick={() => setNewOpen(true)}>
          New group
        </WriteButton>
        {newOpen && (
          <SideSheet
            testId="campaign-group-new-sheet"
            title="New campaign group"
            cancelLabel="Cancel"
            saveLabel="Create group"
            busy={create.busy}
            error={create.error ? <ErrorText error={create.error} testId="campaign-group-new-sheet-error" /> : null}
            onCancel={() => setNewOpen(false)}
            onSave={handleCreate}
          >
            <SheetRow label="Name" required htmlFor="campaign-group-new-name">
              <Input id="campaign-group-new-name" data-testid="campaign-group-new-name"
                     placeholder="Autumn re-engagement" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </SheetRow>
            <SheetRow label="Status">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" data-testid="campaign-group-new-status">
                    {STATUS[newStatus]?.label ?? "Planning"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {STATUS_OPTIONS.map((o) => (
                    <DropdownMenuItem key={o.value} data-testid={`campaign-group-new-status-${o.value}`}
                                      onSelect={() => setNewStatus(o.value)}>
                      {o.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SheetRow>
            <SheetRow label="Goal" optional htmlFor="campaign-group-new-goal">
              <Input id="campaign-group-new-goal" data-testid="campaign-group-new-goal"
                     placeholder="What this group is for" value={newGoal} onChange={(e) => setNewGoal(e.target.value)} />
            </SheetRow>
            <SheetRow label="Starts on" optional>
              <DatePicker testId="campaign-group-new-starts" value={newStartsOn} onValueChange={setNewStartsOn} />
            </SheetRow>
            <SheetRow label="Ends on" optional>
              <DatePicker testId="campaign-group-new-ends" value={newEndsOn} onValueChange={setNewEndsOn} />
            </SheetRow>
          </SideSheet>
        )}
      </>
    );
  }

  // ── row state: the frame's table row for one existing group ─────────────────────────────────────
  const statusInfo = STATUS[group.status] ?? STATUS.planning;
  const attachedCampaigns = group.campaigns ?? [];
  const attachedIds = new Set(attachedCampaigns.map((c) => c.id));
  const pickerOptions = available.filter((c) => !attachedIds.has(c.id)).map((c) => ({ value: c.id, label: c.name }));

  return (
    <tr data-testid="campaign-group-row">
      <td className={TD}>{group.name}</td>
      <td className={`${TD} text-right`}>
        <Figure size="sm" testId="campaign-group-count">{group.campaignsCount ?? attachedCampaigns.length}</Figure>
      </td>
      <td className={TD}>
        <StatusBadge label={statusInfo.label} tone={statusInfo.tone} testId="campaign-group-status" />
      </td>
      <td className={`${TD} text-right`}>
        <div className="flex items-center justify-end gap-2">
          <WriteButton write={attach} testId="campaign-group-attach" variant="outline"
                       onClick={() => setCampaignsOpen(true)}>
            Add a campaign
          </WriteButton>
          <WriteButton write={update} testId="campaign-group-rename" variant="outline"
                       onClick={() => { setRenameName(group.name); setRenameOpen(true); }}>
            Rename
          </WriteButton>
          <WriteButton write={del} testId="campaign-group-delete" variant="destructive"
                       onClick={() => setDeleteOpen(true)}>
            Delete
          </WriteButton>
        </div>
      </td>

      {renameOpen && createPortal(
        // ★ Portalled to document.body ourselves — ActionSurface renders inline, and this component's
        //   own root is a `<tr>`: a `<div>` sibling of `<td>` inside `<tr>` is invalid table content
        //   (RefundRequestRow.jsx's own rule, same reason).
        <ActionSurface
          kind="dialog"
          testId="campaign-group-rename-dialog"
          title={`Rename ${group.name}`}
          busy={update.busy}
          submitLabel="Save"
          cancelLabel="Cancel"
          submitDisabled={renameNameInvalid || !!update.blocked}
          error={update.error ? <ErrorText error={update.error} testId="campaign-group-rename-dialog-error" /> : null}
          onCancel={() => setRenameOpen(false)}
          onSubmit={handleRename}
        >
          <SheetRow label="Name" htmlFor="campaign-group-rename-name">
            <Input id="campaign-group-rename-name" data-testid="campaign-group-rename-name"
                   value={renameName} onChange={(e) => setRenameName(e.target.value)} />
          </SheetRow>
        </ActionSurface>,
        document.body,
      )}

      {deleteOpen && (
        <DecisionModal
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          testId="campaign-group-delete-modal"
          title={`Delete ${group.name}?`}
          subtitle="Its campaigns are removed from this group; nothing else changes."
          danger
          cancelLabel="Keep it"
          confirmLabel="Delete group"
          busy={del.busy}
          confirmDisabled={!!del.blocked}
          error={del.error ? <ErrorText error={del.error} testId="campaign-group-delete-modal-error" /> : null}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDelete}
        />
      )}

      {campaignsOpen && createPortal(
        <SideSheet
          testId="campaign-group-attach-sheet"
          title={`Campaigns in ${group.name}`}
          cancelLabel="Close"
          onCancel={() => setCampaignsOpen(false)}
          onSave={null}
          error={(attach.error || detach.error)
            ? <ErrorText error={attach.error || detach.error} testId="campaign-group-attach-sheet-error" />
            : null}
        >
          {loadError ? (
            <ErrorPanel error={loadError} subject="Campaigns" onRetry={loadCampaigns} testId="campaign-group-attach-error-panel" />
          ) : (
            <>
              <SheetRow label="Add">
                <Combobox testId="campaign-group-attach-picker" value={pickValue} options={pickerOptions}
                          placeholder="Search campaigns…" onValueChange={handleAttach} disabled={!!attach.blocked} />
              </SheetRow>
              <div data-testid="campaign-group-attached-list">
                {attachedCampaigns.length === 0 ? (
                  <p className="m-0 text-meta text-mute" data-testid="campaign-group-attached-empty">
                    No campaigns in this group yet.
                  </p>
                ) : attachedCampaigns.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-ui text-ink">{c.name}</span>
                    <WriteButton write={detach} testId="campaign-group-detach" variant="outline"
                                 onClick={() => handleDetach(c.id)}>
                      Remove
                    </WriteButton>
                  </div>
                ))}
              </div>
            </>
          )}
        </SideSheet>,
        document.body,
      )}
    </tr>
  );
}
