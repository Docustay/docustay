// SettingsAtAGlance — A rail component showing practice-default settings relevant to the current
// money document, with each row able to show an override note when the document's value differs
// from practice default. Ported from webui/src/lib/money/SettingsAtAGlance.svelte.
// ★ the maintainer, 29 Sep 2026 — every row used to pass RailSection `expanded={false}, onToggle={null}`
//   unconditionally: Radix's Collapsible fired a real open event on click, the callback did
//   nothing, and the controlled `open` prop snapped straight back to false on the next render —
//   a row that visibly invited a click and did nothing when clicked.
//   `expandedKey`/`onToggleKey` are now real, single-row-at-a-time state the caller owns. A row's
//   `value` is always visible (RailSection's own `summary`, inline with the label) — the thing "at
//   a glance" names. A row's `content` (a node), when present, is what a click reveals BELOW it;
//   when absent, RailSection renders that row as a plain static line with no chevron and nothing to
//   click — its own built-in behaviour for `children == null`. ★ `body` below is built as ONE
//   value, not written as multiple JSX child expressions — React always boxes multiple children
//   into an array, and an array of [null, false] is still a TRUTHY array, which would have made
//   every row look like it "has content" to RailSection's own `!children` check regardless.
import RailSection from "@/lib/components/editor/RailSection.jsx";

export default function SettingsAtAGlance({ rows = [], expandedKey = null, onToggleKey = null, testId = "money-settings-at-a-glance" }) {
  return (
    <div className="w-full" data-testid={testId}>
      {rows.map((row) => {
        const overrideNode = row.hasOverride && row.overrideNote
          ? <div className="mt-1.5 text-meta text-ink-2">{row.overrideNote}</div>
          : null;
        const body = row.content || overrideNode
          ? <>{row.content}{overrideNode}</>
          : null;
        return (
          <RailSection
            key={row.key}
            label={row.title}
            summary={row.value}
            expanded={expandedKey === row.key}
            onToggle={body ? (next) => onToggleKey?.(next ? row.key : null) : null}
            testId={`${testId}-${row.key}`}
          >
            {body}
          </RailSection>
        );
      })}
    </div>
  );
}
