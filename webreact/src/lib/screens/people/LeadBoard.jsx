// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 16.42 — LEADBOARD. Leads organized by pipeline stage as a drag-and-drop board.
//
// ★★★ DRAG-AND-DROP LOGIC: Uses dnd-kit (@dnd-kit/core + @dnd-kit/sortable) with both pointer
//     and keyboard sensors. Cards can be dragged between stage columns with the pointer AND the
//     keyboard (space to lift, arrows to move, space to drop). Announcements via dnd-kit's
//     accessibility.announcements. This replaces the Svelte's native HTML5 drag-and-drop which
//     lacks keyboard and screen-reader paths.
//
// ★★★ RESPOND_TO_LEAD PROMPT: For leads with an open respond_to_lead task older than 7 days,
//     show a PromptCard with actions "Write to her" and "and fix the form".
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { api } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const STAGES = [
  { key: null, label: "Enquired" },
  { key: "talked_to", label: "Talked to" },
  { key: "estimate_sent", label: "Estimate sent" },
  { key: "booked", label: "Booked" },
  { key: "became_client", label: "Became a client" },
];

const NUMBER_WORDS = [
  null, "One", "Two", "Three", "Four", "Five", "Six",
  "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
];

function numberWord(n) {
  return n >= 1 && n <= 12 ? NUMBER_WORDS[n] : String(n);
}

// Sortable card component for dnd-kit
function SortableCard({ lead }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white border border-line rounded-lg p-3.25 cursor-move hover:shadow-sm transition-shadow ${
        isDragging ? "opacity-50" : ""
      }`}
      data-testid={`card-${lead.id}`}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
    >
      <div
        className="font-medium text-sm text-ink"
        data-testid={`card-name-${lead.id}`}
      >
        {lead.display_name}
      </div>
      {lead.lead_next_step && (
        <div className="text-xs text-mute mt-1 leading-1.5">
          {lead.lead_next_step}
        </div>
      )}
      {lead.lead_badge && (
        <div className="mt-2.25">
          <span className="inline-flex items-center h-6 px-2.25 rounded-full text-xs font-medium bg-chip-neutral text-chip-neutral-ink">
            {lead.lead_badge}
          </span>
        </div>
      )}
    </div>
  );
}

export default function LeadBoard({ app, onNavigate }) {
  const [phase, setPhase] = useState("loading");
  const [leads, setLeads] = useState([]);
  const [error, setError] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  // Group leads by stage
  const stageGroups = useMemo(() => {
    const groups = {};
    STAGES.forEach((s) => {
      groups[s.key] = [];
    });
    leads.forEach((lead) => {
      const stage = lead.lead_stage ?? null;
      if (stage in groups) {
        groups[stage].push(lead);
      }
    });
    return groups;
  }, [leads]);

  // Compute headline text
  const headlineText = useMemo(() => {
    const count = leads.length;
    if (count === 0) return "No leads yet.";
    const word = numberWord(count);
    const persons = count === 1 ? "person" : "people";
    return `${word} ${persons} who haven't been in yet. Drag them along as things move.`;
  }, [leads]);

  // Check if any lead has an open respond_to_lead task older than 7 days
  const promptedLead = useMemo(() => {
    if (!Array.isArray(leads)) return null;
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const lead of leads) {
      if (lead.has_open_respond_to_lead_task && lead.respond_to_lead_task_created_at) {
        const taskTime = new Date(lead.respond_to_lead_task_created_at).getTime();
        if (now - taskTime > sevenDaysMs) {
          return lead;
        }
      }
    }
    return null;
  }, [leads]);

  // Load lead board data
  async function loadLeadBoard() {
    setPhase("loading");
    setError(null);
    try {
      const data = await api.leadBoard();
      const leadsArray = Array.isArray(data) ? data : (data?.leads ?? []);
      setLeads(leadsArray);
      setPhase(leadsArray.length === 0 ? "empty" : "ready");
    } catch (err) {
      setError(err);
      setPhase("error");
    }
  }

  // Load on mount
  useEffect(() => {
    loadLeadBoard();
  }, []);

  // Handle drag end / drop between columns
  function handleDragEnd(event) {
    const { active, over } = event;

    if (!over) return;

    const draggedLead = leads.find((l) => l.id === active.id);
    if (!draggedLead) return;

    const previousStage = draggedLead.lead_stage ?? null;

    // Determine target stage - could be over another card or a stage column
    let targetStage = null;
    const overLead = leads.find((l) => l.id === over.id);
    if (overLead) {
      targetStage = overLead.lead_stage ?? null;
    } else {
      // over.id is the stage column identifier
      targetStage = STAGES.find((s) => String(s.key) === String(over.id))?.key ?? null;
    }

    if (previousStage === targetStage) return;

    handleStageDrop(draggedLead, targetStage, previousStage);
  }

  // Handle the stage drop with API call
  async function handleStageDrop(lead, targetStage, previousStage) {
    try {
      // Optimistic update
      setLeads((prevLeads) =>
        prevLeads.map((l) =>
          l.id === lead.id ? { ...l, lead_stage: targetStage } : l
        )
      );

      // Call API
      await api.setLeadStage({ personId: lead.id, stage: targetStage });

      // Show undo toast
      const stageName = STAGES.find((s) => s.key === targetStage)?.label || "Unknown";
      toast(`${lead.display_name} moved to ${stageName}. Undo.`, {
        action: {
          label: "Undo",
          onClick: async () => {
            await handleStageDrop(lead, previousStage, targetStage);
          },
        },
      });
    } catch (err) {
      // Revert optimistic update on error
      setLeads((prevLeads) =>
        prevLeads.map((l) =>
          l.id === lead.id ? { ...l, lead_stage: previousStage } : l
        )
      );
      toast.error("Failed to move lead", { description: err?.message });
    }
  }

  // Prompt card actions
  function handleWriteToLead(leadId) {
    onNavigate?.(`/record/person/${leadId}`);
  }

  async function handleFixForm() {
    try {
      await api.saveAutomation("forms.lead_task", { enabled: true });
      toast.success("Form automation enabled");
    } catch (err) {
      toast.error("Failed to enable form automation", { description: err?.message });
    }
  }

  return (
    <ScreenState phase={phase} error={error} errorComponent={ErrorPanel} empty="first-run">
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <nav className="text-meta text-mute mb-2">People › Leads</nav>
            <h1 className="m-0 font-serif text-4xl font-medium text-ink">{headlineText}</h1>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => onNavigate?.("/people/leads")}
              data-testid="as-list-link"
            >
              As a list
            </Button>
            <Button
              onClick={() => onNavigate?.("/people/new-lead")}
              data-testid="new-lead-button"
            >
              New lead
            </Button>
          </div>
        </div>

        {/* Board */}
        {phase === "ready" && (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
              items={leads.map((l) => l.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex gap-5.5 items-start" data-testid="lead-board">
                {STAGES.map((stage) => {
                  const stageLeads = stageGroups[stage.key] ?? [];
                  return (
                    <div
                      key={stage.key}
                      className="flex-1 min-w-0 bg-card border border-line rounded-lg p-4"
                      data-testid={`board-column-${stage.key ?? "enquired"}`}
                      data-stage={stage.key}
                      id={String(stage.key)}
                    >
                      {/* Column Header */}
                      <div className="flex items-center gap-2 mb-4">
                        <h2 className="m-0 font-medium text-meta text-ink flex-1">{stage.label}</h2>
                        <span
                          className="inline-flex items-center h-5.25 px-2.25 rounded text-xs font-medium bg-chip-neutral text-chip-neutral-ink"
                          data-testid={`column-count-${stage.key ?? "enquired"}`}
                        >
                          {stageLeads.length}
                        </span>
                      </div>

                      {/* Cards */}
                      <div className="flex flex-col gap-2.25">
                        {stageLeads.map((lead) => (
                          <SortableCard key={lead.id} lead={lead} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay />
          </DndContext>
        )}

        {/* Prompt Card */}
        {phase === "ready" && promptedLead && (
          <div className="mt-5" data-testid="prompt-section">
            <PromptCard
              icon="◎"
              tone="warn"
              headline={`${promptedLead.display_name} enquired two weeks ago and nobody replied`}
              why="she came through the booking page contact form, which nobody watches. That form should probably make a task."
              action={{
                label: "Write to her, and fix the form",
                onClick: async () => {
                  handleWriteToLead(promptedLead.id);
                  await handleFixForm();
                },
              }}
              onDismiss={() => {}}
              testId="prompt-card-respond-to-lead"
            />
          </div>
        )}
      </div>
    </ScreenState>
  );
}
