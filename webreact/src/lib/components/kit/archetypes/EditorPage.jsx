// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EditorPage — the EDITOR archetype (COMPONENTS.md §2, rule 4: every editor is EditorHeader + EditorColumn
// + EditorRail). One object you're building: full page, header with verbs, the blocker banner when saving
// is blocked, a single main column of sections, the meta rail. kit2 editor(). R-41: `loading` shows the
// one full-screen spinner in place of the body.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import EditorHeader from "@/lib/components/editor/EditorHeader.jsx";
import EditorColumn from "@/lib/components/editor/EditorColumn.jsx";
import BlockerBanner from "@/lib/components/editor/BlockerBanner.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";

// ★ CANVAS = SURFACE [the maintainer, 29 Sep] — see Shell.jsx's own note; this was the editor's own
//   "whole screen" canvas, not a muted micro-state, so it moves to bg-surface with it.
export default function EditorPage({ header, blocker = null, rail = null, loading = false, children, testId = "editor-page" }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" data-testid={testId}>
      <EditorHeader {...header} />
      {blocker && blocker.count > 0 && <div className="px-11 pt-4"><BlockerBanner {...blocker} /></div>}
      {loading ? <AppSpinner /> : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <main className="min-w-0 flex-1 overflow-auto"><EditorColumn>{children}</EditorColumn></main>
          {rail}
        </div>
      )}
    </div>
  );
}
