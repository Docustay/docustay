// CreateSheet — the create entry shape; exactly a SideSheet (ported from webui/src/lib/forms/CreateSheet.svelte).
import SideSheet from "./SideSheet.jsx";

export default function CreateSheet({ title = "", onCancel = null, onSave = null, busy = false, saveLabel = "Save", error = null, children = null }) {
  return <SideSheet title={title} onCancel={onCancel} onSave={onSave} busy={busy} saveLabel={saveLabel} error={error}>{children}</SideSheet>;
}
