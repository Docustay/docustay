// SlashMenu.jsx — the "/" popup's actual UI, mounted into editorExtensions.js's plain fixed `<div>`
// via `createRoot`. Built on cmdk (the maintainer's own pick for "the '/' menu and template search" — shadcn's
// own choice too), with `shouldFilter={false}`: `items(query)` in DocTemplateEditor.jsx already
// filters by the in-progress `/word`, so cmdk only has to render and handle arrow/enter keys.
// ★ TipTap's `Suggestion` plugin owns the actual keydown listener (the editor has focus, not this
//   popup), so `onKeyDown` in editorExtensions.js re-dispatches the same KeyboardEvent onto this
//   root's own DOM node — the documented way to let cmdk's internal up/down/enter handling react to
//   a key TipTap intercepted first. See `dispatchToMenu` below, called from DocTemplateEditor.jsx.
import { createRoot } from "react-dom/client";
import { Command, CommandGroup, CommandItem, CommandList } from "@/lib/components/ui/command.jsx";

export function mountSlashMenu(container) {
  const root = createRoot(container);
  return {
    render(items, onSelect, coords) {
      if (coords) {
        container.style.left = `${coords.left}px`;
        container.style.top = `${coords.bottom + 6}px`;
      }
      root.render(
        <div className="w-64 overflow-hidden rounded-control border border-line bg-surface shadow-modal" data-testid="tpl-slash-menu">
          <Command shouldFilter={false} loop>
            <CommandList className="max-h-72 overflow-y-auto p-1">
              {items.length === 0 ? (
                <p className="px-3 py-2.5 text-meta text-mute">Nothing matches</p>
              ) : (
                <CommandGroup>
                  {items.map((item, idx) => (
                    <CommandItem
                      key={item.id ?? idx}
                      value={item.id ?? String(idx)}
                      onSelect={() => onSelect(item)}
                      className="flex flex-col items-start gap-0 px-3 py-2"
                      data-testid={`tpl-slash-item-${item.id ?? idx}`}
                    >
                      <span className="text-ui text-ink">{item.label}</span>
                      {item.hint && <span className="text-caption text-mute">{item.hint}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </div>
      );
    },
    destroy() {
      root.unmount();
    },
  };
}

/** Re-fires a KeyboardEvent TipTap's Suggestion plugin caught, so cmdk's own internal Command
 *  component (which listens on its own container, not the editor) can act on it. Returns true for
 *  the three keys cmdk actually owns, so the caller knows to swallow the event from the editor. */
export function dispatchToMenu(container, event) {
  const owned = ["ArrowUp", "ArrowDown", "Enter"].includes(event.key);
  if (!owned || !container) return false;
  const cmdRoot = container.querySelector("[cmdk-root]");
  cmdRoot?.dispatchEvent(new KeyboardEvent("keydown", { key: event.key, bubbles: true, cancelable: true }));
  return true;
}
