// Tiptap (core, MIT) setup for Docustay's rich-text templates: headings, bold, italic, lists, links and merge-field chips.
import { Editor, Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

export const MergeField = Node.create({
  name: "variableChip", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() { return { name: { default: "" }, label: { default: "" }, kind: { default: null }, default: { default: null }, help: { default: null } }; },
  parseHTML() { return [{ tag: "span[data-variable-chip]" }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-variable-chip": node.attrs.name, class: "merge-chip", contenteditable: "false" }), node.attrs.label || node.attrs.name];
  },
});

export function makeEditor(element, { content, onUpdate }) {
  return new Editor({
    element,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: false }), Link.configure({ openOnClick: false, autolink: false }), MergeField],
    content,
    editorProps: { attributes: { class: "rich-body", "aria-label": "Template body", role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => onUpdate?.(editor.getJSON()),
  });
}
