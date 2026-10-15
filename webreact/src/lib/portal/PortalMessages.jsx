// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.46 — MESSAGES (AppClientMessages): THE THREAD WITH THE COACH
//
// ★★★ ONE THREAD PER CLIENT–COACH PAIR. A thread belongs to one client and one coach. When
//     exactly one thread exists, open it directly; with several (several coaches), the list
//     shows first and the user selects one.
//
// ★★ COACH NAME FROM THE EXISTING PAYLOAD. The coordinator ruled (25 Sep): do NOT add schema
//    or edit read.mjs (not in field 2). Render from what the client already holds — the Home
//    payload (18.34) carries `next.hostName` or `firstSteps.hostFirstName`. When no coach is
//    assigned, show the practice name instead.
//
// ★ HEADER: `‹ {coach}` + "Usually replies within a few hours" (static).
// ★ DAY SEPARATORS; BUBBLES "ME" (RIGHT, ACCENT) AND "THEM" (LEFT, GRAY); READ RECEIPTS.
// ★ COMPOSER: text input "Write something", send button (↑), footer (honesty text).
// ★ FOR TEENS: footer followed by CRISIS_LINE (18.35).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request } from "@/lib/api.js";
// ★ `$keystone/...` is a backend-only alias (src/) — the frontend bundle cannot import across that
//   boundary. Mirrors src/app/crisisLine.mjs's own CRISIS_LINE exactly.
const CRISIS_LINE = "If something's wrong and you need help now, call or text 988. Any time, any day.";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { ChevronLeft, ArrowUp } from "lucide-react";

export default function PortalMessages({ data = null, role = null, terms = {}, onNavigate = null }) {
  // ★ PAYLOAD EXTRACTION: home data (from 18.34) if available; messages data always.
  const payload = data?.data ?? data ?? {};
  const threads = Array.isArray(payload.threads) ? payload.threads : [];
  const homeData = payload.next || payload.firstSteps ? payload : null;

  // ★ STATE
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [messages, setMessages] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);

  // ★ COACH NAME: from home payload if available; inferred from first staff message if needed;
  //   fallback to a placeholder when no coach assigned.
  const coachName = (() => {
    if (homeData?.next?.hostName) return homeData.next.hostName;
    if (homeData?.firstSteps?.hostFirstName) return homeData.firstSteps.hostFirstName;
    if (selectedThreadId && messages[selectedThreadId]) {
      const msgs = messages[selectedThreadId];
      const staffMsg = msgs.find((m) => m.sender_type === "staff");
      if (staffMsg?.sender_name) return staffMsg.sender_name;
    }
    return null;
  })();

  // ★ SCREEN PHASE: loading, error, empty, thread-list, thread-detail
  const phase = (() => {
    if (data?.error) return "error";
    if (!data) return "loading";
    if (selectedThreadId) return "thread-detail";
    if (threads.length === 0) return "empty";
    if (threads.length === 1) return "thread-detail";
    return "thread-list";
  })();

  // ★ INITIALIZE: if exactly one thread, open it directly.
  useEffect(() => {
    if (threads.length === 1 && !selectedThreadId) {
      setSelectedThreadId(threads[0].id);
      setLoading(true);
      loadMessages(threads[0].id);
    }
  }, [threads.length, selectedThreadId]);

  // ★ FETCH MESSAGES WHEN THREAD IS SELECTED
  async function loadMessages(threadId) {
    if (messages[threadId]) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await request(`/api/app/messages/${threadId}`);
      setMessages((prev) => ({
        ...prev,
        [threadId]: Array.isArray(result.messages) ? result.messages : [],
      }));
      setError(null);

      // ★ MARK UNREAD MESSAGES AS READ
      const msgs = Array.isArray(result.messages) ? result.messages : [];
      for (const msg of msgs) {
        if (msg.read_at === null) {
          try {
            await request(`/api/app/messages/${msg.id}/read`, { method: "POST" });
            // Update local state to reflect read status
            setMessages((prev) => ({
              ...prev,
              [threadId]: prev[threadId].map((m) =>
                m.id === msg.id ? { ...m, read_at: new Date().toISOString() } : m
              ),
            }));
          } catch (e) {
            // Silently continue; the message is loaded even if marking failed
          }
        }
      }
    } catch (e) {
      setError(e.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }

  // ★ SEND MESSAGE
  async function sendMessage() {
    // ★ no thread yet is fine: the route starts one when threadId is null (a client's first message)
    if (!messageInput.trim() || sending) return;

    const body = messageInput.trim();
    setSending(true);
    setError(null);

    try {
      const result = await request("/api/app/messages", {
        method: "POST",
        body: { threadId: selectedThreadId, body },
      });

      const tid = result.threadId ?? selectedThreadId;
      setMessages((prev) => ({
        ...prev,
        [tid]: [
          ...(prev[tid] ?? []),
          {
            id: result.id,
            sender_type: "client",
            sender_id: result.senderId,
            body: result.body,
            created_at: result.created_at,
            read_at: null,
          },
        ],
      }));
      setSelectedThreadId(tid);
      setMessageInput("");
    } catch (e) {
      // the typed text stays in the box; the error line says why (it used to print the message itself)
      setError(e.message || "Your message didn't send.");
    } finally {
      setSending(false);
    }
  }

  // ★ FORMATTING HELPERS
  function formatDate(isoString) {
    const d = new Date(isoString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  }

  function formatTime(isoString) {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }

  // ★ GROUP MESSAGES BY DAY
  function groupMessagesByDay(msgs) {
    const groups = [];
    let currentDay = null;
    for (const msg of msgs) {
      const day = formatDate(msg.created_at);
      if (day !== currentDay) {
        currentDay = day;
        groups.push({ type: "day-separator", day });
      }
      groups.push({ type: "message", msg });
    }
    return groups;
  }

  function goBack() {
    if (threads.length > 1) {
      setSelectedThreadId(null);
    }
  }

  // ★ RENDER LOADING PHASE
  if (phase === "loading") {
    return (
      <ScreenState
        phase="loading"
        testIds={{ loading: "messages-loading" }}
      />
    );
  }

  // ★ RENDER ERROR PHASE
  if (phase === "error") {
    return (
      <ErrorPanel
        error={data?.error}
        testId="messages-error"
      />
    );
  }

  // ★ RENDER THREAD LIST VIEW
  if (phase === "thread-list") {
    return (
      <div className="flex flex-col" data-testid="thread-list">
        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className="flex items-center justify-between py-[13px] border-b border-line last:border-b-0 bg-transparent text-left transition-colors duration-200 hover:bg-[var(--color-structure-75)] cursor-pointer w-full"
            data-testid="thread-row"
            data-id={thread.id}
            onClick={() => {
              setSelectedThreadId(thread.id);
              setLoading(true);
              loadMessages(thread.id);
            }}
          >
            <div className="flex flex-col gap-[3px] flex-1">
              <div className="text-sm font-medium text-ink">{thread.person_name || "Unknown"}</div>
              <div className="text-xs text-mute">
                {new Date(thread.updated_at).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </div>
            </div>
            {thread.unread_count > 0 && (
              <div
                className="flex items-center justify-center w-5 h-5 rounded-full bg-brand text-white text-[11px] font-semibold flex-shrink-0"
                data-testid="thread-unread-badge"
              >
                {thread.unread_count}
              </div>
            )}
          </button>
        ))}
      </div>
    );
  }

  // ★ RENDER THREAD DETAIL VIEW (or empty state if no messages yet)
  // ★ the maintainer, 29 Sep 2026 (portal design critique #3) — PhoneShell already draws this tab's header
  //   ("Messages"); this screen used to draw a SECOND header on top of it (the coach's name, in
  //   its own bordered bar with its own px-[18px] gutter — doubling PhoneShell's own gutter too).
  //   The coach's name and reply-time line now open the message body instead, so there is one
  //   header, not two, and one gutter, not two.
  return (
    <div className="relative flex flex-col flex-1" data-testid="thread-detail">
      {threads.length > 1 && (
        <button
          type="button"
          className="flex-shrink-0 w-5 h-5 border-none bg-transparent text-brand cursor-pointer p-0 leading-none mb-2"
          onClick={goBack}
          data-testid="thread-back"
          aria-label="Back to messages"
        >
          <ChevronLeft size={20} strokeWidth={2.25} aria-hidden="true" />
        </button>
      )}
      <div className="text-center mb-3.5 flex-shrink-0" data-testid="thread-coach-name">
        <div className="text-[12.5px]" style={{ color: "var(--color-structure-600)" }}>
          {coachName ? `${coachName} usually replies within a few hours` : "Usually replies within a few hours"}
        </div>
      </div>

      {/* MESSAGES BODY */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-5 py-5 text-center text-sm text-mute" data-testid="messages-loading">
            Loading…
          </div>
        )}
        {error && !loading && (
          <div className="px-5 py-5 text-center text-sm text-red-600" data-testid="messages-error" role="alert">
            {error}
          </div>
        )}
        {!loading && !error && phase === "empty" && (
          <EmptyState
            kind="first-run"
            headline="No messages yet"
            line={`Write to ${coachName || "your coach"} below. Only you and your practice can see it.`}
            testId="messages-empty"
          />
        )}
        {!loading && !error && selectedThreadId && messages[selectedThreadId] && (
          <div className="flex flex-col gap-0" data-testid="message-thread">
            {groupMessagesByDay(messages[selectedThreadId]).map((item, idx) => {
              if (item.type === "day-separator") {
                return (
                  <div key={`sep-${item.day}-${idx}`} className="text-center text-[11px] text-mute my-[14px] px-3">
                    {item.day}
                  </div>
                );
              }
              const msg = item.msg;
              const isClient = msg.sender_type === "client";
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col mb-1 ${isClient ? "items-end" : "items-start"}`}
                  data-testid="message-item"
                  data-id={msg.id}
                >
                  <div
                    className={`max-w-[82%] px-[13px] py-[10px] rounded-2xl text-sm leading-1.5 break-words ${
                      isClient
                        ? "bg-brand text-white rounded-br-[5px]"
                        : "bg-[var(--color-wash-segment)] text-ink rounded-bl-[5px]"
                    }`}
                  >
                    {msg.body}
                  </div>
                  {isClient && msg.read_at ? (
                    <div className="text-[11px] text-mute mt-1 text-right mr-1" data-testid="message-time">
                      {formatTime(msg.created_at)} · Read
                    </div>
                  ) : (
                    <div
                      className={`text-[11px] text-mute mt-1 ${isClient ? "text-right mr-1" : "text-left ml-1"}`}
                      data-testid="message-time"
                    >
                      {formatTime(msg.created_at)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* COMPOSER SHEET (sticky footer) */}
      {(selectedThreadId || phase === "empty") && (
        <div className="sticky bottom-0 mt-auto bg-white rounded-t-[20px] shadow-[0_-16px_44px_rgba(20,20,25,0.2)] px-[18px] py-[10px] pb-7 -mx-[18px]">
          <div className="flex gap-[9px] items-center mb-[10px]">
            <input
              type="text"
              className="flex-1 border border-line rounded-full h-10 px-[15px] text-sm text-ink bg-white focus:outline-none focus:border-brand focus:ring-2 focus:ring-[var(--color-action-50)] disabled:opacity-60 disabled:cursor-not-allowed placeholder:text-[var(--color-placeholder)]"
              placeholder="Write something"
              value={messageInput}
              disabled={sending}
              data-testid="message-input"
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button
              type="button"
              className="flex-shrink-0 w-10 h-10 rounded-full bg-brand text-white border-none cursor-pointer flex items-center justify-center p-0 leading-none hover:enabled:bg-[#4238b0] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={sendMessage}
              disabled={!messageInput.trim() || sending}
              data-testid="message-send"
              aria-label="Send"
            >
              <ArrowUp size={18} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
          <div className="text-[11.5px] text-mute text-center leading-1.5">
            <span>{coachName || `Coach`} can see everything here. It isn't the place for anything urgent.</span>
            {role === "adolescent_client" && <p className="mt-2 text-[11.5px] text-mute leading-1.5 m-0">{CRISIS_LINE}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
