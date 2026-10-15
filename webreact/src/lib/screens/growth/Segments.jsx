// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Segments — the segments/lists screen. Display saved segments with create/edit functionality.
// ★ Two groups of rows: the six self-updating seed rows (seed_key IS NOT NULL — these show live
//   counts, computed server-side) and made-by-hand rows (seed_key IS NULL, created manually).
// ★ "New list" button opens a SideSheet with filter fields matching SEGMENT_FIELDS from
//   src/growth/campaigns.mjs: role, has_email, quiet_days, credits_remaining_lte, owes_money,
//   never_booked, on_waitlist.
// Ported from webui/src/lib/screens/growth/Segments.svelte (562 lines).
// Props: onNavigate (optional), rows (optional for testing).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { savedToast } from "@/lib/hooks/savedToast.js";
import { request, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import SegmentsListsTable from "./SegmentsListsTable.jsx";
import SegmentsNewListSheet from "./SegmentsNewListSheet.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { AppStateContext } from "@/lib/app/useAppState.js";

const ROLE_OPTIONS = [
  { value: "staff", label: "Staff" },
  { value: "adult_client", label: "Adult Client" },
  { value: "adolescent_client", label: "Adolescent Client" },
  { value: "parent", label: "Parent" },
];

export default function Segments({ onNavigate = null, rows = null }) {
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [counts, setCounts] = useState({});
  const app = useContext(AppStateContext);

  const [formData, setFormData] = useState({
    name: "",
    filter: {
      role: [],
      has_email: false,
      quiet_days: "",
      credits_remaining_lte: "",
      owes_money: false,
      never_booked: false,
      on_waitlist: false,
    },
  });

  const updateFormField = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateFilterField = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      filter: {
        ...prev.filter,
        [field]: value,
      },
    }));
  };

  // ★ Optional prop for testing — if provided, skips the fetch
  useEffect(() => {
    if (rows !== null && rows !== undefined) {
      setSegments(rows);
      setLoading(false);
      setPhase(rows.length === 0 ? "empty" : "ready");
      return;
    }

    const loadSegments = async () => {
      try {
        setLoading(true);
        setError(null);
        setPhase("loading");
        const res = await request("/api/list/growth/lists");
        const segmentsList = res.rows || [];
        setSegments(segmentsList);
        setPhase(segmentsList.length === 0 ? "empty" : "ready");
        loadCounts(segmentsList);
      } catch (err) {
        console.error("Error fetching segments:", err);
        if (err instanceof ApiError && err.status === 403) {
          setPhase("denied");
          setError("You do not have access to segments");
        } else {
          setPhase("error");
          setError(err instanceof ApiError ? err.message : "Failed to load segments");
        }
        setSegments([]);
      } finally {
        setLoading(false);
      }
    };

    loadSegments();
  }, [rows]);

  const loadCounts = async (list) => {
    const next = {};
    await Promise.all(
      list.map(async (seg) => {
        try {
          const r = await request(`/api/growth/audience?segmentId=${encodeURIComponent(seg.id)}`);
          next[seg.id] = r?.audience?.count ?? null;
        } catch {
          next[seg.id] = null;
        }
      })
    );
    setCounts(next);
  };

  const countFor = (seg) => {
    const count = counts[seg.id];
    return typeof count === "number" ? count.toLocaleString() : "—";
  };

  const handleCreateSegment = async (e) => {
    e.preventDefault();
    if (createBusy) return;

    setCreateBusy(true);
    setCreateError(null);

    try {
      // ★ Build filter object from form data, omitting empty/falsy values
      const filter = {};
      if (formData.filter.role && formData.filter.role.length > 0) {
        filter.role = formData.filter.role;
      }
      if (formData.filter.has_email) {
        filter.has_email = true;
      }
      if (formData.filter.quiet_days !== null && formData.filter.quiet_days !== "") {
        filter.quiet_days = parseInt(formData.filter.quiet_days, 10);
      }
      if (formData.filter.credits_remaining_lte !== null && formData.filter.credits_remaining_lte !== "") {
        filter.credits_remaining_lte = parseInt(formData.filter.credits_remaining_lte, 10);
      }
      if (formData.filter.owes_money) {
        filter.owes_money = true;
      }
      if (formData.filter.never_booked) {
        filter.never_booked = true;
      }
      if (formData.filter.on_waitlist) {
        filter.on_waitlist = true;
      }

      const res = await request("/api/growth/segments", {
        method: "POST",
        body: {
          name: formData.name.trim(),
          filter,
        },
      });

      if (res.ok || res.id) {
        savedToast("Segment created");
        setFormData({
          name: "",
          filter: {
            role: [],
            has_email: false,
            quiet_days: "",
            credits_remaining_lte: "",
            owes_money: false,
            never_booked: false,
            on_waitlist: false,
          },
        });
        setShowCreateSheet(false);
        // Reload segments
        const resReload = await request("/api/list/growth/lists");
        const segmentsList = resReload.rows || [];
        setSegments(segmentsList);
        setPhase(segmentsList.length === 0 ? "empty" : "ready");
        loadCounts(segmentsList);
      } else {
        setCreateError(res.error ?? "Failed to create segment");
      }
    } catch (err) {
      // ★ 400 responses have field-specific errors that should display inline
      if (err instanceof ApiError && err.status === 400 && err.body?.error?.field) {
        setCreateError(err.body.error.message);
      } else {
        setCreateError(err instanceof ApiError ? err.message : "An error occurred");
      }
    } finally {
      setCreateBusy(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      filter: {
        role: [],
        has_email: false,
        quiet_days: "",
        credits_remaining_lte: "",
        owes_money: false,
        never_booked: false,
        on_waitlist: false,
      },
    });
    setCreateError(null);
  };

  const toggleRole = (roleValue) => {
    setFormData((prev) => ({
      ...prev,
      filter: {
        ...prev.filter,
        role: prev.filter.role.includes(roleValue)
          ? prev.filter.role.filter((r) => r !== roleValue)
          : [...prev.filter.role, roleValue],
      },
    }));
  };

  const handleUseSegment = (segmentId) => {
    if (onNavigate) {
      onNavigate(`/run/campaigns/new?segment=${segmentId}`);
    } else {
      window.location.href = `/run/campaigns/new?segment=${segmentId}`;
    }
  };

  // reload after a bulk/row Delete (the screen has no refetch signal of its own)
  const reloadSegments = async () => {
    try {
      const res = await request("/api/list/growth/lists");
      const segmentsList = res.rows || [];
      setSegments(segmentsList);
      setPhase(segmentsList.length === 0 ? "empty" : "ready");
      loadCounts(segmentsList);
    } catch (err) {
      console.error("Error reloading segments:", err);
    }
  };

  // §13.3 — selection + bulk Delete come from the shared hook; the row Delete is added by RowActions. This screen writes no delete code.
  const bulk = useListBulk({ app, path: "/run/lists", rank: app?.nav?.rank ?? null, rows: segments, onChanged: reloadSegments });

  const seedSegments = segments.filter((s) => s.seed_key !== null && s.seed_key !== undefined);
  const handmadeSegments = segments.filter((s) => !s.seed_key);

  // ★ RUN-2 C3 — was the literal "Six that keep themselves up to date, and two you made by hand."
  const listsSummary = (() => {
    const n = seedSegments.length;
    const h = handmadeSegments.length;
    const auto = n === 1 ? "One keeps itself up to date" : `${n} keep themselves up to date`;
    return `${auto}, and ${h === 0 ? "none" : h} you made by hand.`;
  })();

  return (
    <>
      <LedgerPage
        title="Lists"
        summary={listsSummary}
        primary={{
          label: "New list",
          onClick: () => {
            resetForm();
            setShowCreateSheet(true);
          },
        }}
      >
        {bulk.bulkBar}
        <SegmentsListsTable
          seedSegments={seedSegments}
          handmadeSegments={handmadeSegments}
          segments={segments}
          error={error}
          phase={phase}
          countFor={countFor}
          handleUseSegment={handleUseSegment}
          bulk={bulk}
          showCreateSheet={showCreateSheet}
          listsSummary={listsSummary}
        />
      </LedgerPage>

      {showCreateSheet && (
        <SegmentsNewListSheet
          open={showCreateSheet}
          onOpenChange={setShowCreateSheet}
          error={error}
          showCreateSheet={showCreateSheet}
          createError={createError}
          createBusy={createBusy}
          formData={formData}
          handleCreateSegment={handleCreateSegment}
          resetForm={resetForm}
          toggleRole={toggleRole}
          ROLE_OPTIONS={ROLE_OPTIONS}
          onFormFieldChange={updateFormField}
          onFormFilterChange={updateFilterField}
        />
      )}
    </>
  );
}
