// Same '/' menu as Docustay's lib/editor/sourceEditor.js (TipTap Suggestion, MIT); items come from the shared flow definition. Keep the two in step.
// ── THE "/" MENU (TipTap Suggestion, MIT). The items come from the flow definition (SLASH_ITEMS); picking one calls onPick(id, { editor, range }) — the page decides what each does (heading and table and page break act in the
//    editor; field and clause open their tab). The popup is plain DOM, so the same extension works in any framework.
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
export function slashExtension({ items, label, onPick }) {
  return Extension.create({
    name: "slashMenu",
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor, char: "/", startOfLine: false, allowSpaces: false,
        items: ({ query }) => items.filter((i) => label(i).toLowerCase().includes(query.toLowerCase())).slice(0, 8),
        command: ({ editor, range, props }) => { editor.chain().focus().deleteRange(range).run(); onPick(props.id, { editor }); },
        render: () => {
          let box = null, list = [], at = 0, cmd = null;
          const draw = () => {
            if (!box) return;
            box.innerHTML = "";
            list.forEach((it, i) => {
              const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "option"); b.dataset.testid = `slash-${it.id}`; b.className = "slash-item" + (i === at ? " on" : "");
              b.innerHTML = `<b></b><span></span>`; b.firstChild.textContent = label(it); b.lastChild.textContent = it.hint ?? "";
              b.onmousedown = (e) => { e.preventDefault(); cmd?.(it); };
              box.appendChild(b);
            });
          };
          const place = (rect) => { if (!box || !rect) return; box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 280))}px`; box.style.top = `${rect.bottom + 6}px`; };
          return {
            onStart: (props) => { list = props.items; at = 0; cmd = (it) => props.command({ id: it.id }); box = document.createElement("div"); box.className = "slash-menu"; box.setAttribute("role", "listbox"); box.dataset.testid = "slash-menu"; document.body.appendChild(box); draw(); place(props.clientRect?.()); },
            onUpdate: (props) => { list = props.items; at = 0; cmd = (it) => props.command({ id: it.id }); draw(); place(props.clientRect?.()); },
            onKeyDown: ({ event }) => {
              if (!box) return false;
              if (event.key === "ArrowDown") { at = (at + 1) % Math.max(1, list.length); draw(); return true; }
              if (event.key === "ArrowUp") { at = (at - 1 + list.length) % Math.max(1, list.length); draw(); return true; }
              if (event.key === "Enter") { if (list[at]) cmd?.(list[at]); return true; }
              if (event.key === "Escape") { box.remove(); box = null; return true; }
              return false;
            },
            onExit: () => { box?.remove(); box = null; },
          };
        },
      })];
    },
  });
}
export const SLASH_CSS = `.slash-menu{position:fixed;z-index:70;min-width:260px;background:var(--card,#fff);border:1px solid var(--line-strong,#cfc5af);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.16);padding:4px;display:flex;flex-direction:column}.slash-item{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-height:44px;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:var(--ink,#1b1a17);text-align:left;cursor:pointer;font:inherit}.slash-item span{font-size:12px;color:var(--mute,#6b655a)}.slash-item.on,.slash-item:hover{background:var(--tint,#ede6d6)}`;
