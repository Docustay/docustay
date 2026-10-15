import { useContext, useEffect, useState } from "react";
import { request, api, ApiError } from "@/lib/api.js";
import { AppStateContext } from "@/lib/app/useAppState.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import BookingLinksScreenTable1Table from "./BookingLinksScreenTable1Table.jsx";
import BookingLinksScreenBookingLinkSheet from "./BookingLinksScreenBookingLinkSheet.jsx";

export default function BookingLinksScreen({ onNavigate = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [links, setLinks] = useState([]);
  const [practicePage, setPracticePage] = useState({ url: null, categoryIds: [] });
  const [options, setOptions] = useState({ categories: [], staff: [], locations: [] });

  // sheet: null | { mode: "new"|"edit"|"page", draft, id? }
  const [sheet, setSheet] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const r = await request("/api/engagements/links");
      setLinks(r.links ?? []);
      setPracticePage(r.practicePage ?? { url: null, categoryIds: [] });
      setOptions(r.options ?? { categories: [], staff: [], locations: [] });
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(
          err instanceof ApiError
            ? { message: err.message, requestId: err.requestId }
            : { message: String(err?.message ?? err) }
        );
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  const nameOf = (list, id) =>
    list.find((x) => x.id === id)?.name ??
    list.find((x) => x.id === id)?.displayName ??
    "—";

  function scopeText(ids, list, all) {
    if (!ids || ids.length === 0) return all;
    return ids.map((id) => nameOf(list, id)).join(" · ");
  }

  const practicePageText =
    practicePage.categoryIds.length === 0
      ? "Everything you've made public"
      : `${scopeText(practicePage.categoryIds, options.categories, "")} only`;

  const liveCount = links.filter((l) => l.active).length;

  const app = useContext(AppStateContext);
  const bulk = useListBulk({ app, path: "/engagements/booking/links", rank: app?.nav?.rank, rows: links, onChanged: load });

  function openNew() {
    setSheetError(null);
    setSheet({
      mode: "new",
      draft: {
        name: "",
        slug: "",
        categoryIds: [],
        staffIds: [],
        locationIds: [],
        active: true,
      },
    });
  }

  function openEdit(link) {
    setSheetError(null);
    setSheet({
      mode: "edit",
      id: link.id,
      draft: {
        name: link.name,
        slug: link.slug,
        categoryIds: [...link.categoryIds],
        staffIds: [...link.staffIds],
        locationIds: [...link.locationIds],
        active: link.active,
      },
    });
  }

  function openPage() {
    setSheetError(null);
    setSheet({
      mode: "page",
      draft: { categoryIds: [...practicePage.categoryIds] },
    });
  }

  function toggle(axis, idOrValue) {
    const cur = sheet.draft[axis];

    // For array fields, toggle the id membership
    if (Array.isArray(cur)) {
      setSheet({
        ...sheet,
        draft: {
          ...sheet.draft,
          [axis]: cur.includes(idOrValue)
            ? cur.filter((x) => x !== idOrValue)
            : [...cur, idOrValue],
        },
      });
    }
    // For text fields (name, slug)
    else if (typeof cur === "string") {
      setSheet({
        ...sheet,
        draft: {
          ...sheet.draft,
          [axis]: idOrValue,
        },
      });
    }
    // For boolean fields (active)
    else if (typeof cur === "boolean") {
      setSheet({
        ...sheet,
        draft: {
          ...sheet.draft,
          [axis]: idOrValue,
        },
      });
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setSheetError(null);
    try {
      if (sheet.mode === "page") {
        await api.setSetting({
          key: "booking.public_page_categories",
          value: sheet.draft.categoryIds,
        });
      } else if (sheet.mode === "new") {
        await request("/api/engagements/links", {
          method: "POST",
          body: sheet.draft,
        });
      } else {
        await request(
          `/api/engagements/links/${encodeURIComponent(sheet.id)}`,
          { method: "POST", body: sheet.draft }
        );
      }
      setSheet(null);
      await load();
    } catch (err) {
      // ★ The server's own words — never re-worded.
      setSheetError(
        err instanceof ApiError ? err.message : String(err?.message ?? err)
      );
    } finally {
      setSaving(false);
    }
  }

  async function archive(link) {
    if (
      !confirm(
        `Archive "${link.name}"? Its link stops working straight away.`
      )
    )
      return;
    try {
      await request(
        `/api/engagements/links/${encodeURIComponent(link.id)}/archive`,
        { method: "POST", body: {} }
      );
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err) }
      );
      setPhase("error");
    }
  }

  async function copy(link) {
    if (!link.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  }

  return (
    <div className="flex w-full flex-col" data-testid="booking-links-page">
      <div className="flex items-end gap-4 mb-4.5">
        <div className="flex-1">
          <h1 className="m-0 text-title font-medium leading-tight">
            Booking links
          </h1>
          <p className="m-0 text-sm text-mute mt-1.25">
            Each link is its own booking page, showing only what you choose.
            Nobody booking recovery coaching ever sees life coaching.
          </p>
        </div>
        <button
          type="button"
          className="h-(--size-control) gap-2 px-[17px] rounded-control border border-transparent bg-primary text-primary-foreground font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 inline-flex items-center justify-center"
          data-testid="booking-links-new"
          onClick={openNew}
          disabled={phase !== "ready"}
        >
          New link
        </button>
      </div>

      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? error?.message ?? null : null}
        onNavigate={go}
        testIds={{
          loading: "booking-links-loading",
          error: "booking-links-error",
          denied: "booking-links-denied",
        }}
      >
        <div
          className="flex bg-surface border border-line rounded-control mb-4.5"
          data-testid="booking-links-strip"
        >
          <div className="flex-1 p-3 border-l border-hair first:border-l-0">
            <div className="text-xs text-mute">Your practice page shows</div>
            <div className="text-sm font-medium text-ink mt-1">
              <span data-testid="booking-links-page-default">
                {practicePageText}
              </span>
              <button
                type="button"
                className="bg-none border-0 p-0 text-primary font: inherit text-xs font-normal cursor-pointer ml-2"
                data-testid="booking-links-page-change"
                onClick={openPage}
              >
                Change
              </button>
            </div>
          </div>
          <div className="flex-1 p-3 border-l border-hair">
            <div className="text-xs text-mute">Links</div>
            <div className="text-sm font-medium text-ink mt-1">
              {links.length === 0 ? "None yet" : `${links.length} · ${liveCount} live`}
            </div>
          </div>
          <div className="flex-1 p-3 border-l border-hair">
            <div className="text-xs text-mute">Team member links</div>
            <div className="text-sm font-medium text-ink mt-1">
              Each team member's own page
              <button
                type="button"
                className="bg-none border-0 p-0 text-primary font: inherit text-xs font-normal cursor-pointer ml-2"
                onClick={() => go("/settings/booking-link")}
              >
                My link
              </button>
            </div>
          </div>
        </div>

        <div
          className="bg-surface border border-line rounded-control overflow-hidden"
          data-testid="booking-links-table"
        >
          {links.length > 0 ? (
            <>
            {bulk.bulkBar}
            <BookingLinksScreenTable1Table
              bulk={bulk}
              links={links}
              options={options}
              copiedId={copiedId}
              scopeText={scopeText}
              openEdit={openEdit}
              archive={archive}
              copy={copy}
            />
            </>
          ) : (
            <div
              className="p-10 text-center border-t border-hair"
              data-testid="booking-links-empty"
            >
              <div className="text-base font-medium mb-1.5">
                No booking links yet
              </div>
              <p className="m-0 text-sm text-mute max-w-52ch mb-3.5 leading-1.6 mx-auto">
                Make one when two kinds of client should never land on the same
                page — recovery and life coaching, or one location and another.
              </p>
              <button
                type="button"
                className="h-(--size-control) gap-2 px-[17px] rounded-control border border-transparent bg-primary text-primary-foreground font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 inline-flex items-center justify-center"
                onClick={openNew}
              >
                New link
              </button>
            </div>
          )}
        </div>
      </ScreenState>

      {sheet && (
        <BookingLinksScreenBookingLinkSheet
          error={sheetError}
          options={options}
          sheet={sheet}
          saving={saving}
          sheetError={sheetError}
          toggle={toggle}
          save={save}
          onCancel={() => setSheet(null)}
        />
      )}
    </div>
  );
}
