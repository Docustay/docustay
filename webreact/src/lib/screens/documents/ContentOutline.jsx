// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ContentOutline.jsx — ITEM 8, 30 Sep 2026. The Content step's Square-style block list: one row per
// section (tick box · title · "…" menu · drag handle), sitting above the shared TipTap editor. It
// never edits prose itself — a row's title/checkbox/menu act on the editor's doc via the pure
// content-array helpers in contractDoc.js (docSectionRanges / reorderDocSections / deleteDocSection /
// cloneDocSection); "Edit" just scrolls the shared editor to that section and focuses it, since the
// rebuild ruling keeps ONE continuous document with the Fields·Clauses·Settings panel and "/" insert
// unchanged — this outline is a navigation/organisation layer on top, not a second editor.
//
// The signature row at the bottom is never one of these sections — it is DERIVED, read-only, and
// carries no checkbox/menu/handle: `contractDoc.js`'s own rule is that signatures are never authored
// content (see its header), so there is nothing here to include/exclude/reorder/delete.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Ellipsis } from "lucide-react";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/lib/components/ui/dropdown-menu.jsx";
import { docSectionRanges, reorderDocSections, deleteDocSection, cloneDocSection } from "./contractDoc.js";

function SectionRow({ id, index, title, included, onToggle, onEdit, onClone, onDelete, canEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <motion.li
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.16 }}
      className="flex items-center gap-2 border-b border-line-soft bg-surface px-2 py-2 last:border-b-0"
      data-testid={`tpl-outline-row-${index}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-mute hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canEdit}
        aria-label={`Reorder ${title}`}
        data-testid={`tpl-outline-drag-${index}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <Checkbox
        checked={included}
        onCheckedChange={onToggle}
        disabled={!canEdit}
        aria-label={`Include ${title} in the sent document`}
        data-testid={`tpl-outline-include-${index}`}
      />
      <button
        type="button"
        onClick={onEdit}
        className={`flex-1 truncate text-left text-ui ${included ? "text-ink" : "text-mute line-through"}`}
        data-testid={`tpl-outline-title-${index}`}
      >
        {title}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="rounded-sm p-1 text-mute hover:bg-paper hover:text-ink" aria-label={`${title} options`} data-testid={`tpl-outline-menu-${index}`}>
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit} data-testid={`tpl-outline-menu-edit-${index}`}>Edit</DropdownMenuItem>
          <DropdownMenuItem onClick={onClone} disabled={!canEdit} data-testid={`tpl-outline-menu-clone-${index}`}>Clone & edit</DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} disabled={!canEdit} variant="destructive" data-testid={`tpl-outline-menu-delete-${index}`}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.li>
  );
}

export default function ContentOutline({ editor, canEdit, excludedIndexes, setExcludedIndexes, signers }) {
  // ★ Re-derive the outline from the editor's live doc on every transaction — cheap (a handful of
  //   sections) and keeps this in lockstep with typing a heading's text without a second source of
  //   truth for section titles.
  const [sections, setSections] = useState([]);
  const refresh = useCallback(() => {
    if (!editor) return;
    setSections(docSectionRanges(editor.getJSON()).map((r, i) => ({ ...r, id: `s${i}` })));
  }, [editor]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!editor) return;
    editor.on("update", refresh);
    return () => editor.off("update", refresh);
  }, [editor, refresh]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function scrollToSection(index) {
    if (!editor) return;
    // node index (top-level content array) → ProseMirror doc position, via the heading's own node.
    let pos = 0;
    const ranges = docSectionRanges(editor.getJSON());
    const target = ranges[index];
    if (!target) return;
    editor.state.doc.forEach((node, offset, i) => { if (i === target.start) pos = offset; });
    editor.chain().focus(pos + 1).run();
    const dom = editor.view.domAtPos(pos + 1)?.node;
    (dom instanceof Element ? dom : dom?.parentElement)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sections.findIndex((s) => s.id === active.id);
    const newIndex = sections.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const order = arrayMove(sections.map((_, i) => i), oldIndex, newIndex);
    editor.commands.setContent(reorderDocSections(editor.getJSON(), order));
    // excluded indexes are positional — remap them the same way the sections just moved.
    setExcludedIndexes((prev) => {
      const next = new Set();
      order.forEach((fromIdx, toIdx) => { if (prev.has(fromIdx)) next.add(toIdx); });
      return next;
    });
  }

  function toggleIncluded(index) {
    setExcludedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  function cloneSection(index) {
    editor.commands.setContent(cloneDocSection(editor.getJSON(), index));
    // the clone lands right after the original — every excluded index at or above it shifts up one.
    setExcludedIndexes((prev) => new Set([...prev].map((i) => (i > index ? i + 1 : i))));
  }

  function deleteSection(index) {
    editor.commands.setContent(deleteDocSection(editor.getJSON(), index));
    setExcludedIndexes((prev) => {
      const next = new Set();
      prev.forEach((i) => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
  }

  if (!editor) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-card border border-line" data-testid="tpl-content-outline">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="m-0 list-none p-0">
            <AnimatePresence initial={false}>
              {sections.map((s, i) => (
                <SectionRow
                  key={s.id}
                  id={s.id}
                  index={i}
                  title={s.title}
                  included={!excludedIndexes.has(i)}
                  onToggle={() => toggleIncluded(i)}
                  onEdit={() => scrollToSection(i)}
                  onClone={() => cloneSection(i)}
                  onDelete={() => deleteSection(i)}
                  canEdit={canEdit}
                />
              ))}
            </AnimatePresence>
          </ul>
        </SortableContext>
      </DndContext>
      {signers.length > 0 && (
        <div className="flex items-center gap-2 border-t border-line-soft bg-surface-sunken px-2 py-2 text-meta text-mute" data-testid="tpl-outline-signatures-row">
          <span className="size-4" />
          <span className="size-4" />
          <span className="flex-1">Signatures — {signers.map((s) => s.label).join(", ")} (from Settings, added automatically)</span>
        </div>
      )}
    </div>
  );
}
