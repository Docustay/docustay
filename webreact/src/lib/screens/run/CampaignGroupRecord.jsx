// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CampaignGroupRecord — Campaign group record screen. Ported from
// webui/src/lib/screens/run/CampaignGroupRecord.svelte: same props, testids, data-* hooks and copy.
// Layout from specs/mockups/CampaignGroupRecord.frame.html and CampaignGroupRecordEmpty.frame.html;
// behaviour from Svelte source. No archetype — custom screen layout.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";

export default function CampaignGroupRecord({}) {
  const [groupId, setGroupId] = useState(null);
  const [group, setGroup] = useState(null);
  const [results, setResults] = useState(null);
  const [sends, setSends] = useState([]);
  const [pages, setPages] = useState([]);
  const [forms, setForms] = useState([]);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sendError, setSendError] = useState(null);
  const [pageError, setPageError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [listError, setListError] = useState(null);
  const [bookedError, setBookedError] = useState(null);

  useEffect(() => {
    const pathMatch = window.location.pathname.match(/campaign-group\/([^/]+)/);
    if (pathMatch) {
      setGroupId(pathMatch[1]);
    } else {
      setError("No campaign group ID provided");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!groupId) return;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch group details
        const groupResult = await request(`/api/growth/campaign-groups/${groupId}`, { method: "GET" });
        setGroup(groupResult.group);

        // Fetch results
        const resultsResult = await request(`/api/growth/campaign-groups/${groupId}/results`, { method: "GET" });
        setResults(resultsResult);

        // Fetch related items (sends, pages, forms, lists)
        try {
          const sendsResult = await request(`/api/growth/campaign-groups/${groupId}/sends`, { method: "GET" });
          setSends(sendsResult.sends || []);
        } catch (e) {
          setSendError(e instanceof ApiError ? e.message : String(e));
        }

        try {
          const pagesResult = await request(`/api/growth/campaign-groups/${groupId}/pages`, { method: "GET" });
          setPages(pagesResult.pages || []);
        } catch (e) {
          setPageError(e instanceof ApiError ? e.message : String(e));
        }

        try {
          const formsResult = await request(`/api/growth/campaign-groups/${groupId}/forms`, { method: "GET" });
          setForms(formsResult.forms || []);
        } catch (e) {
          setFormError(e instanceof ApiError ? e.message : String(e));
        }

        try {
          const listsResult = await request(`/api/growth/campaign-groups/${groupId}/lists`, { method: "GET" });
          setLists(listsResult.lists || []);
        } catch (e) {
          setListError(e instanceof ApiError ? e.message : String(e));
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [groupId]);

  const getStatusTag = (status) => {
    if (status === "live") {
      return { text: "Live", textColor: "text-ok", bgColor: "bg-ok-soft", borderColor: "border-ok-soft" };
    }
    if (status === "planning") {
      return { text: "Planning", textColor: "text-warn", bgColor: "bg-warn-soft", borderColor: "border-warn-soft" };
    }
    return { text: "Done", textColor: "text-mute", bgColor: "bg-mute-bg", borderColor: "border-mute-bg" };
  };

  const handlePause = async () => {
    if (!groupId) return;
    try {
      await request(`/api/growth/campaign-groups/${groupId}/pause`, { method: "POST" });
      setGroup({ ...group, status: "paused" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const isFirstRun = group && !results?.sent && !sends.length && !pages.length && !forms.length && !lists.length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-0 flex flex-col gap-4 border-b border-hair px-7.5 py-6.5">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <h1 className="m-0 text-page-title font-medium text-ink" style={{ letterSpacing: "-0.01em" }}>
              {group?.name || "Loading..."}
            </h1>
            {group && (
              <div className="mt-1.25 text-sm text-mute">
                <span>{getStatusTag(group.status).text}</span>
                {group.starts_on && <span> · started {group.starts_on}</span>}
                {group.goal && <span> · goal: {group.goal}</span>}
              </div>
            )}
          </div>
          {!isFirstRun && (
            <button
              className="inline-flex h-9.5 items-center justify-center gap-2 rounded-control border border-line bg-surface px-4.25 text-ui font-medium text-ink-2 hover:bg-gray-50"
              onClick={handlePause}
            >
              Pause
            </button>
          )}
          <button
            className="inline-flex h-9.5 items-center justify-center gap-2 rounded-control border border-brand bg-brand px-4.25 text-ui font-medium text-white hover:bg-blue-700"
          >
            Add to campaign
          </button>
        </div>
      </div>

      {/* Main scrollable content */}
      <div className="flex-1 overflow-auto px-7.5 pb-17.5">
        {loading && (
          <div className="py-10 text-center text-mute">Loading campaign...</div>
        )}

        {error && (
          <div className="py-10 text-center text-bad">Error: {error}</div>
        )}

        {!loading && !error && isFirstRun && (
          <>
            {/* FIRST-RUN EMPTY STATE */}
            <div className="mb-1.5 text-center text-xs font-semibold uppercase tracking-widest text-mute">
              Nothing attached yet — the campaign exists, its pieces don't
            </div>

            {[
              {
                title: "No sends yet",
                desc: "Write the announcement email — pick a template, the list fills in when you attach one.",
                buttonText: "New send",
              },
              {
                title: "No landing page yet",
                desc: "Where the email points. Attach one you have, or draft a new one.",
                buttonText: "Attach a page",
              },
              {
                title: "No form yet",
                desc: "Captures interest from people who aren't clients yet.",
                buttonText: "Attach a form",
              },
              {
                title: "No list yet",
                desc: "Who this goes to. \"Signed but never booked\" is one click away.",
                buttonText: "Pick a list",
              },
            ].map((item, idx) => (
              <div
                key={idx}
                className="mb-3.5 flex items-center gap-3 rounded-lg border border-dashed border-line bg-paper p-4"
              >
                <div className="flex-1">
                  <b className="block text-sm font-semibold text-ink">{item.title}</b>
                  <span className="mt-0.5 block text-xs text-mute">{item.desc}</span>
                </div>
                <button className="flex-0 inline-flex h-8 items-center justify-center rounded-control border border-line bg-surface px-3.25 text-xs font-medium text-ink-2 hover:bg-gray-50">
                  {item.buttonText}
                </button>
              </div>
            ))}

            <p className="mt-1.5 text-xs text-mute">
              Results appear once the first send goes out. Nothing counts until then — not enough data is a state, not an error.
            </p>
          </>
        )}

        {!loading && !error && !isFirstRun && (
          <>
            {/* RESULTS STRIP: dense labeled numbers with thin dividers */}
            {results && (
              <div className="mb-4 flex rounded-lg border border-line bg-white">
                {[
                  { label: "Sent", value: results.sent },
                  { label: "Delivered", value: `${results.deliveredPct || 0}%` },
                  { label: "Opened", value: results.openedPct !== null ? `${results.openedPct}%` : "—" },
                  { label: "Clicked", value: results.clickedPct !== null ? `${results.clickedPct}%` : "—" },
                  { label: "Unsubscribed", value: results.unsubscribed || 0 },
                  { label: "Leads", value: results.leads || 0 },
                  { label: "Booked", value: results.booked || 0 },
                ].map((item, idx) => (
                  <span key={idx} className={`flex flex-1 flex-col gap-0.5 px-4 py-3 ${idx > 0 ? "border-l border-hair" : ""}`}>
                    <div className="text-lg font-semibold tracking-widest text-ink">
                      {item.value}
                    </div>
                    <div className="text-xs text-mute">{item.label}</div>
                  </span>
                ))}
              </div>
            )}

            {/* SENDS BAND */}
            <div className="mb-4 rounded-lg border border-line bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-hair px-4 py-3">
                <b className="text-sm font-semibold text-ink">Sends ({sends.length})</b>
                <button className="inline-flex h-8 items-center justify-center rounded-control border border-line bg-surface px-3.25 text-xs font-medium text-ink-2 hover:bg-gray-50">
                  New send
                </button>
              </div>
              {sendError && (
                <div className="px-4 py-3 text-sm text-bad">Error loading sends: {sendError}</div>
              )}
              {!sendError && sends.length === 0 && (
                <div className="px-4 py-3 text-sm text-mute">No sends yet</div>
              )}
              {!sendError && sends.length > 0 && (
                <ul className="divide-y divide-hair">
                  {sends.map((send) => (
                    <li key={send.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex-1">
                        <span className="block text-sm font-medium text-ink">{send.name}</span>
                        <span className="mt-0.5 block text-xs text-mute">
                          Sent {send.sentAt} · {send.recipientCount} recipients
                        </span>
                      </span>
                      <span className="inline-flex h-5 items-center rounded-full border border-ok-soft bg-ok-soft px-2 text-xs font-medium text-ok">
                        {send.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* PAGES BAND */}
            <div className="mb-4 rounded-lg border border-line bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-hair px-4 py-3">
                <b className="text-sm font-semibold text-ink">Landing page ({pages.length})</b>
                <button className="inline-flex h-8 items-center justify-center rounded-control border border-line bg-surface px-3.25 text-xs font-medium text-ink-2 hover:bg-gray-50">
                  Attach a page
                </button>
              </div>
              {pageError && (
                <div className="px-4 py-3 text-sm text-bad">Error loading pages: {pageError}</div>
              )}
              {!pageError && pages.length === 0 && (
                <div className="px-4 py-3 text-sm text-mute">No landing page yet</div>
              )}
              {!pageError && pages.length > 0 && (
                <ul className="divide-y divide-hair">
                  {pages.map((page) => (
                    <li key={page.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex-1">
                        <span className="block text-sm font-medium text-ink">{page.url}</span>
                        <span className="mt-0.5 block text-xs text-mute">
                          {page.published ? "Published" : "Draft"} · {page.visits || 0} visits · {page.leads || 0} leads
                        </span>
                      </span>
                      <span className="inline-flex h-5 items-center rounded-full border border-ok-soft bg-ok-soft px-2 text-xs font-medium text-ok">
                        {page.published ? "Published" : "Draft"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* FORMS BAND */}
            <div className="mb-4 rounded-lg border border-line bg-white overflow-hidden">
              <div className="border-b border-hair px-4 py-3">
                <b className="text-sm font-semibold text-ink">Form ({forms.length})</b>
              </div>
              {formError && (
                <div className="px-4 py-3 text-sm text-bad">Error loading forms: {formError}</div>
              )}
              {!formError && forms.length === 0 && (
                <div className="px-4 py-3 text-sm text-mute">No form yet</div>
              )}
              {!formError && forms.length > 0 && (
                <ul className="divide-y divide-hair">
                  {forms.map((form) => (
                    <li key={form.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex-1">
                        <span className="block text-sm font-medium text-ink">{form.name}</span>
                        <span className="mt-0.5 block text-xs text-mute">
                          {form.submissions} submissions · feeds the {form.listName} list
                        </span>
                      </span>
                      <span className="inline-flex h-5 items-center rounded-full border border-ok-soft bg-ok-soft px-2 text-xs font-medium text-ok">
                        {form.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* LISTS BAND */}
            <div className="mb-4 rounded-lg border border-line bg-white overflow-hidden">
              <div className="border-b border-hair px-4 py-3">
                <b className="text-sm font-semibold text-ink">List ({lists.length})</b>
              </div>
              {listError && (
                <div className="px-4 py-3 text-sm text-bad">Error loading lists: {listError}</div>
              )}
              {!listError && lists.length === 0 && (
                <div className="px-4 py-3 text-sm text-mute">No list yet</div>
              )}
              {!listError && lists.length > 0 && (
                <ul className="divide-y divide-hair">
                  {lists.map((list) => (
                    <li key={list.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex-1">
                        <span className="block text-sm font-medium text-ink">{list.name}</span>
                        <span className="mt-0.5 block text-xs text-mute">
                          {list.type} · {list.memberCount} people when the first send went
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* BOOKED BAND */}
            <div className="mb-4 rounded-lg border border-line bg-white overflow-hidden">
              <div className="border-b border-hair px-4 py-3">
                <b className="text-sm font-semibold text-ink">Booked — the number the others can't show</b>
              </div>
              {bookedError && (
                <div className="px-4 py-3 text-sm text-bad">Error loading booked data: {bookedError}</div>
              )}
              {!bookedError && results && (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">
                      {results.booked} people in this campaign booked after first touch
                    </span>
                    <span className="mt-0.75 block text-xs text-mute">
                      Joined across bookings — subscribers here are your clients, not an import.
                    </span>
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
