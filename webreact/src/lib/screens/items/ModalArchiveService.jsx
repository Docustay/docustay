// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalArchiveService — multi-subject archive modal with counts, ported from
// `webui/src/lib/screens/items/ModalArchiveService.svelte` (245 lines)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { request, ApiError } from "@/lib/api.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import ModalArchiveServiceModal1Modal from "./ModalArchiveServiceModal1Modal.jsx";
import ModalArchiveServiceModal2Modal from "./ModalArchiveServiceModal2Modal.jsx";
import ModalArchiveServiceModal from "./ModalArchiveServiceModal.jsx";

const HAS_WHAT_KEEPS_WORKING = Object.freeze(["service", "plan"]);

function labelFor(object, n) {
  const word = String(object ?? "service").replace(/_/g, " ");
  return n === 1 ? word : `${word}s`;
}

export default function ModalArchiveService({
  open = false,
  onOpenChange = null,
  object = "service",
  items = [],
  onClose = null,
  onArchived = null,
  testId = "modal-archive-service",
}) {
  // Validate required prop
  useEffect(() => {
    if (open && typeof onArchived !== "function") {
      throw new Error(
        "ModalArchiveService: onArchived is required — a successful archive must always be handed " +
        "back to the caller, never drawn with nothing behind it."
      );
    }
  }, [open, onArchived]);

  const n = items.length;
  const single = n === 1 ? items[0] : null;
  const countsAvailable = HAS_WHAT_KEEPS_WORKING.includes(object);

  // ── COUNTS-FIRST DATA ────────────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState(countsAvailable ? "loading" : "ready");
  const [loadError, setLoadError] = useState(null);
  const [totals, setTotals] = useState({ activePackages: 0, livePlanSubscribers: 0, futureBookings: 0 });

  async function loadCounts() {
    setPhase("loading");
    setLoadError(null);
    try {
      const reads = await Promise.all(
        items.map((it) => request(`/api/records/${object}/${encodeURIComponent(it.id)}`))
      );
      const newTotals = reads.reduce((acc, r) => {
        const wk = r.whatKeepsWorking ?? {};
        acc.activePackages += wk.activePackages ?? 0;
        acc.livePlanSubscribers += wk.livePlanSubscribers ?? 0;
        acc.futureBookings += wk.futureBookings ?? 0;
        return acc;
      }, { activePackages: 0, livePlanSubscribers: 0, futureBookings: 0 });
      setTotals(newTotals);
      setPhase("ready");
    } catch (err) {
      setPhase("error");
      setLoadError(err instanceof ApiError ? err : String(err?.message ?? err));
    }
  }

  useEffect(() => {
    if (open && countsAvailable && phase === "loading") {
      loadCounts();
    }
  }, [open, countsAvailable, phase]);

  // ── COPY ─────────────────────────────────────────────────────────────────────────────────────
  const title = useMemo(
    () => single ? `Archive ${single.name}?` : `Archive ${n} ${labelFor(object, n)}?`,
    [single, n, object]
  );

  const subtitle = "It stops being bookable straight away. Everything already arranged carries on.";

  const rows = useMemo(() => {
    if (!countsAvailable || phase !== "ready") return [];
    const out = [];
    const fb = totals.futureBookings;
    out.push({
      headline: `${fb} session${fb === 1 ? "" : "s"} already booked`,
      detail: "They go ahead as normal.",
    });
    if (object === "service") {
      const pk = totals.activePackages;
      out.push({
        headline: `${pk} package${pk === 1 ? "" : "s"} that include it`,
        detail: "They can still be booked against.",
      });
    }
    const pl = totals.livePlanSubscribers;
    out.push({
      headline: `${pl} plan subscriber${pl === 1 ? "" : "s"}`,
      detail: "Nothing changes for them.",
    });
    out.push({
      headline: "Your booking page",
      detail: "It disappears from there within a minute.",
    });
    return out;
  }, [countsAvailable, phase, totals, object]);

  // ── SUBMIT ───────────────────────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  function cancel() {
    if (busy) return;
    onOpenChange?.(false);
    onClose?.();
  }

  async function submit() {
    if (busy) return;
    setSubmitError(null);
    setBusy(true);
    try {
      for (const it of items) {
        await request("/api/records/archive", {
          method: "POST",
          body: { object, id: it.id },
          idempotencyKey: newIdempotencyKey(),
        });
      }
      onOpenChange?.(false);
      const ids = items.map((it) => it.id);
      const text = single ? `${single.name} archived.` : `${n} ${labelFor(object, n)} archived.`;
      toast.success(text, {
        duration: 10000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              for (const id of ids) {
                await request("/api/records/restore", {
                  method: "POST",
                  body: { object, id },
                  idempotencyKey: newIdempotencyKey(),
                });
              }
              toast.success("Undone");
            } catch (e) {
              toast.error("Undo failed", { description: e?.message ?? "Could not undo." });
            }
          },
        },
      });
      onArchived?.({ ids });
      onClose?.();
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
          : String(err?.message ?? err)
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && countsAvailable && phase === "loading" && (
        <ModalArchiveServiceModal1Modal
          open={true}
          onOpenChange={onOpenChange}
          testId={testId}
        />
      )}
      {open && countsAvailable && phase === "error" && (
        <ModalArchiveServiceModal2Modal
          open={true}
          onOpenChange={onOpenChange}
          testId={testId}
          loadError={loadError}
          loadCounts={loadCounts}
        />
      )}
      {open && (!countsAvailable || phase === "ready") && (
        <ModalArchiveServiceModal
          open={true}
          onOpenChange={onOpenChange}
          testId={testId}
          title={title}
          subtitle={subtitle}
          rows={rows}
          busy={busy}
          submitError={submitError}
          cancel={cancel}
          submit={submit}
        />
      )}
    </>
  );
}
