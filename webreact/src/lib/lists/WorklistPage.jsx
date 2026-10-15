// WorklistPage — the WORKLIST archetype (things waiting on you): a LedgerPage with no primary action.
// Ported from webui/src/lib/lists/WorklistPage.svelte.
import LedgerPage from "./LedgerPage.jsx";

export default function WorklistPage({ title, summary = null, headerAction = null, views = null, activeView = null, onView = null, controls = null, children = null, testId = "worklist-page", loading = false }) {
  return <LedgerPage archetype="worklist" title={title} summary={summary} primary={null} headerAction={headerAction} views={views} activeView={activeView} onView={onView} controls={controls} testId={testId} loading={loading}>{children}</LedgerPage>;
}
