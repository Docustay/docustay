// EditorColumn — the editor's single main column (kit2 .edcol, 0 44px). Ported from EditorColumn.svelte.
export default function EditorColumn({ children }) {
  return <div className="px-11 pb-20" data-testid="editor-column">{children}</div>;
}
