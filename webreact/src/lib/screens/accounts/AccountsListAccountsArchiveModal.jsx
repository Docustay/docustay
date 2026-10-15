// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.016.M1 — AccountsListAccountsArchiveModal: modal to archive an account. Ported from
// webui/src/lib/screens/accounts/AccountsList.svelte:340-353 (DecisionModal element).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function AccountsListAccountsArchiveModal({
  open = false, onOpenChange = null, error = null, archiveTarget = null, archiveBusy = false,
  archiveError = null, confirmArchive = null,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={archiveTarget ? `Archive ${archiveTarget.name}?` : ""}
      rows={[
        {
          headline: "This account will stop appearing in Accounts",
          detail: "Members keep their own records — only the account is archived.",
        },
      ]}
      cancelLabel="Don't archive"
      confirmLabel="Archive"
      danger={true}
      busy={archiveBusy}
      error={archiveError}
      onCancel={() => { onOpenChange?.(false); }}
      onConfirm={confirmArchive}
      testId="accounts-archive-modal"
    />
  );
}
