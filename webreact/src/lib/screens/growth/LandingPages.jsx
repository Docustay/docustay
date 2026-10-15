// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LandingPages — landing pages list screen. Ported from
// webui/src/lib/screens/growth/LandingPages.svelte (397 lines).
// Props: onNavigate. Loads landing pages data via api, creates/edits/publishes/deletes pages.
// Archetype: SideSheet (for create/edit).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useContext, useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import LandingPagesLandingPagesTable from "./LandingPagesLandingPagesTable.jsx";
import LandingPagesSheet from "./LandingPagesSheet.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Plus } from "lucide-react";
import { ICON_STROKE } from "@/lib/empty/icons.js";
import { toast } from "sonner";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { AppStateContext } from "@/lib/app/useAppState.js";

export default function LandingPages({ onNavigate = null }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [editingPageId, setEditingPageId] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [createBusy, setCreateBusy] = useState(false);
  const app = useContext(AppStateContext);
  const [formData, setFormData] = useState({
    slug: "",
    title: "",
    body: "",
  });

  async function fetchPages() {
    try {
      setLoading(true);
      setError(null);
      const res = await request("/api/list/growth/pages");
      setPages(res.rows || []);
    } catch (err) {
      console.error("Error fetching landing pages:", err);
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      setPages([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDraft(e) {
    e.preventDefault();
    if (createBusy) return;

    setCreateBusy(true);
    setCreateError(null);

    try {
      if (editingPageId) {
        // Update existing page
        const res = await request("/api/growth/pages/update", {
          method: "POST",
          body: {
            landingPageId: editingPageId,
            slug: formData.slug.trim(),
            title: formData.title.trim(),
            body: formData.body.trim(),
          },
        });

        if (res.ok || res.id) {
          toast.success("Page saved", { description: formData.title });
          setFormData({ slug: "", title: "", body: "" });
          setEditingPageId(null);
          setShowCreateSheet(false);
          await fetchPages();
        } else {
          setCreateError(res.error ?? "Failed to save page");
        }
      } else {
        // Create new page
        const res = await request("/api/growth/pages", {
          method: "POST",
          body: {
            slug: formData.slug.trim(),
            title: formData.title.trim(),
            body: formData.body.trim(),
          },
        });

        if (res.ok || res.id) {
          toast.success("Page created", { description: formData.title });
          setFormData({ slug: "", title: "", body: "" });
          setShowCreateSheet(false);
          await fetchPages();
        } else {
          setCreateError(res.error ?? "Failed to create page");
        }
      }
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setCreateBusy(false);
    }
  }

  async function publishPage(pageId, title) {
    try {
      const res = await request("/api/growth/pages/publish", {
        method: "POST",
        body: {
          landingPageId: pageId,
          aiRequestId: null,
        },
      });

      if (res.ok || res.id) {
        toast.success("Page published", { description: title });
        await fetchPages();
      } else {
        toast.error("Failed to publish", { description: res.error ?? "Unknown error" });
      }
    } catch (err) {
      toast.error("Error publishing page", { description: err instanceof ApiError ? err.message : String(err?.message ?? err) });
    }
  }

  function editPage(page) {
    setFormData({
      slug: page.slug,
      title: page.title,
      body: page.body || "",
    });
    setEditingPageId(page.id);
    setShowCreateSheet(true);
  }

  function resetForm() {
    setFormData({ slug: "", title: "", body: "" });
    setCreateError(null);
    setEditingPageId(null);
  }

  function rowActions(page) {
    const actions = [];

    actions.push({
      id: "edit",
      label: "Edit",
      onRun: () => editPage(page),
    });

    if (!page.is_published) {
      actions.push({
        id: "publish",
        label: "Publish",
        onRun: () => publishPage(page.id, page.title),
      });
    }

    return actions;
  }

  useEffect(() => {
    fetchPages();
  }, []);

  // §13.3 — selection + bulk Delete come from the shared hook; the row Delete is added by RowActions. This screen writes no delete code.
  const bulk = useListBulk({ app, path: "/run/pages", rank: app?.nav?.rank ?? null, rows: pages, onChanged: fetchPages });

  if (loading) {
    return <ScreenState phase="loading" />;
  }

  if (error) {
    return (
      <ScreenState
        phase="error"
        error={{ message: error }}
        subject="landing pages"
        onRetry={fetchPages}
      />
    );
  }

  if (pages.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-page-title font-medium text-ink">Landing pages</h1>
              <p className="mt-1 text-ui text-mute">Two live. The evenings one is doing four times better than the other.</p>
            </div>
            <Button
              variant="default"
              onClick={() => {
                resetForm();
                setShowCreateSheet(true);
              }}
            >
              <Plus size={16} strokeWidth={ICON_STROKE} />
              New page
            </Button>
          </div>
        </div>
        <EmptyState
          kind="first-run"
          headline="Create your first landing page"
          line="A publishable marketing page where potential clients learn about your practice."
          action={{ label: "New page", href: "" }}
          onNavigate={() => {
            resetForm();
            setShowCreateSheet(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-page-title font-medium text-ink">Landing pages</h1>
          <p className="mt-1 text-ui text-mute">Two live. The evenings one is doing four times better than the other.</p>
        </div>
        <Button
          variant="default"
          onClick={() => {
            resetForm();
            setShowCreateSheet(true);
          }}
        >
          <Plus size={16} strokeWidth={ICON_STROKE} />
          New page
        </Button>
      </div>
      {bulk.bulkBar}
      <LandingPagesLandingPagesTable
        pages={pages}
        rowActions={rowActions}
        bulk={bulk}
      />
      {showCreateSheet && (
        <LandingPagesSheet
          open={showCreateSheet}
          onOpenChange={setShowCreateSheet}
          error={createError}
          showCreateSheet={showCreateSheet}
          editingPageId={editingPageId}
          createError={createError}
          createBusy={createBusy}
          formData={formData}
          handleSaveDraft={handleSaveDraft}
          resetForm={resetForm}
          onCancel={() => {
            resetForm();
            setShowCreateSheet(false);
          }}
          onFormChange={(field, value) => {
            setFormData(prev => ({ ...prev, [field]: value }));
          }}
        />
      )}
    </div>
  );
}
