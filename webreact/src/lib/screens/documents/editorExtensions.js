// ═══════════════════════════════════════════════════════════════════════════════════════════════
// editorExtensions.js — Square Contracts rebuild (29 Sep 2026). Two custom TipTap pieces for
// DocTemplateEditor.jsx's rich editor:
//   · VariableChip — an ATOMIC inline node (never a Mark: a mark decorates existing text a person
//     can still edit character-by-character; a fill-in field must be one indivisible token, the
//     same way run/TemplateEditor.jsx's `{varName}` chip is one visual unit but is, underneath, a
//     Mark over literal `{varName}` text — a different, simpler need than this editor's, which maps
//     a chip to a REAL variable BLOCK in contractBodySchema, not a string pattern).
//   · SlashCommand — a minimal `/`-triggered menu built on `@tiptap/suggestion` directly (no
//     tippy.js in this app; position is computed from `editor.view.coordsAtPos`, a fixed-position
//     div is cheaper than adding a popper dependency for one small menu).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Node, mergeAttributes } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";

export const VariableChip = Node.create({
  name: "variableChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      name: { default: "" },
      label: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-variable-chip]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-variable-chip": node.attrs.name,
        class: "inline-flex items-center rounded-pill bg-brand-soft px-2 py-0.5 text-caption font-medium text-brand align-baseline",
        contenteditable: "false",
      }),
      node.attrs.label || node.attrs.name,
    ];
  },
});

/**
 * SlashCommand — `addOptions().suggestion` is the `@tiptap/suggestion` config; `items(query)` is
 * supplied by the caller (DocTemplateEditor.jsx) so this file stays generic. `render()` owns a
 * plain fixed-position `<div>` (no popper library) whose content is (re)rendered by the caller's
 * own `renderMenu` callback every time the suggestion's state changes — the caller (a React
 * component) owns the ACTUAL menu UI; this extension only owns positioning + keyboard routing.
 */
export function createSlashCommand({ items, renderMenu, destroyMenu, onKeyDown }) {
  return Node.create({
    name: "slashCommand",
    addOptions() {
      return {
        suggestion: {
          char: "/",
          startOfLine: false,
          command: ({ editor, range, props }) => {
            props.command({ editor, range });
          },
        },
      };
    },
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
          items,
          render: () => {
            let el = null;
            return {
              onStart: (props) => {
                el = document.createElement("div");
                el.style.position = "fixed";
                el.style.zIndex = "60";
                document.body.appendChild(el);
                const coords = props.clientRect ? props.clientRect() : null;
                renderMenu(el, props, coords);
              },
              onUpdate: (props) => {
                const coords = props.clientRect ? props.clientRect() : null;
                renderMenu(el, props, coords);
              },
              onKeyDown: (props) => onKeyDown?.(props) ?? false,
              onExit: () => {
                destroyMenu?.(el);
                el?.remove();
                el = null;
              },
            };
          },
        }),
      ];
    },
  });
}
