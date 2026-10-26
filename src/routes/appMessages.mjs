// C2.6 — CLIENT-PORTAL MESSAGES ROUTES
//
// ★★★ THREAD-BASED MESSAGING BETWEEN CLIENTS AND STAFF.
// A client may list their message threads, read messages in a thread, send messages, and mark as read.
// Threads are person-scoped: a client only sees and can interact with their own threads.

import { createThread, sendMessage, markRead } from "../messages/writes.mjs";
import { getThreadsForPerson, getMessagesForThread, getUnreadCount } from "../messages/read.mjs";
import { invalid, forbidden, notFound } from "../http/errors.mjs";

/**
 * ★★★ THE CLIENT ROLES. Same vocabulary as app.mjs.
 * Staff IS DELIBERATELY ABSENT — staff use the CRM surfaces, not the client app.
 */
const CLIENT_ROLES = Object.freeze(["adult_client", "adolescent_client", "parent"]);

/**
 * ★★ ASSERT CLIENT ROLE, FAIL CLOSED. A staff session reading these surfaces would be reading them
 * THROUGH THE CLIENT'S OWN FILTERS — which are narrower than a staff member's — and would then
 * believe they can see less than they actually can.
 */
function assertClientRole(principal) {
  const role = principal?.user?.role ?? null;
  if (!CLIENT_ROLES.includes(role)) {
    throw forbidden(
      `the client app is for ${CLIENT_ROLES.join(", ")}. A staff session belongs in the CRM: reading a ` +
      `client's app surfaces as staff would show you what THEY can see, not what you can, and that is ` +
      `a misleading answer rather than a restricted one.`);
  }
  return role;
}

export function registerAppMessagesRoutes(app, { scoped, get, post, getFor }) {
  // ★ FIX (coordinator, checkpoint, 24 Sep 2026, the maintainer's ruling — messaging is authorized): this whole
  //   module was registered from a second call site (src/http/app.mjs, like C2.3's payments before
  //   it) — invisible to registerAppRoutes's own tracked route set, AND `messages` was never
  //   declared in SURFACES at all, so nothing here was reachable through the nav/route consistency
  //   check either way. Worse: the CLIENT (`PortalMessages.svelte`) called
  //   `/api/app/messages/threads`, `/threads/:id`, `/threads/:id/send` — paths this module never
  //   served (it served bare `/api/app/messages`, `/api/app/messages/:threadId`, and POST to the
  //   bare path). The whole feature was unreachable from either direction, silently, since it was
  //   built. `get`/`post` are now injected (tracked) and `Shell.svelte`'s already-wired "Messages"
  //   button (`onNavigate("/app/messages")`, added in the touch-up round) now has a real surface
  //   behind it (`messages` in src/app/surfaces.mjs) instead of nothing.
  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/app/messages — LIST THREADS FOR THIS PERSON
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ PERSON-SCOPED. A client only sees threads created for them (person_id from session).
  // Returns threads ordered by most recent update first, with unread message counts.
  get("/api/app/messages", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const threads = await getThreadsForPerson(db, {
        tenantId: principal.user.tenant_id,
        personId: principal.appUserId,
      });
      return { threads };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/app/messages/unread-count — UNREAD MESSAGE COUNT FOR THIS PERSON
  // ───────────────────────────────────────────────────────────────────────────
  // ★ RUN-2 T11 (26 Sep 2026): registered BEFORE /:threadId — registered after it, "unread-count" was taken as a
  //   thread id and every client's badge read 500 (invalid input syntax for type uuid).
  // ★★ Used for badge display on the messages icon (total unread across all threads).
  getFor("/api/app/messages/unread-count", "/api/app/messages", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const count = await getUnreadCount(db, {
        tenantId: principal.user.tenant_id,
        personId: principal.appUserId,
      });
      return { unreadCount: count };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/app/messages/:threadId — GET MESSAGES IN A THREAD
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ THREAD-SCOPED AND PERSON-SCOPED. A client can only view messages in threads
  // that belong to them. RLS on the message_thread table ensures visibility.
  get("/api/app/messages/:threadId", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const threadId = c.req.param("threadId");
      if (!threadId) throw invalid("threadId is required");
      if (!/^[0-9a-f-]{36}$/i.test(threadId)) throw notFound("no such thread or you do not have access to it");   // RUN-2: never a uuid-cast 500

      // ★ Verify the thread exists and belongs to this person (RLS will enforce this,
      //   but we check explicitly so we can give a clear error).
      const { rows: [thread] } = await db.query(
        `SELECT id, person_id FROM keystone.message_thread
         WHERE id = $1 AND tenant_id = $2 AND person_id = $3`,
        [threadId, principal.user.tenant_id, principal.appUserId]);
      if (!thread) throw notFound("no such thread or you do not have access to it");

      const messages = await getMessagesForThread(db, {
        tenantId: principal.user.tenant_id,
        threadId,
      });
      return { messages };
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/app/messages — SEND A MESSAGE IN A THREAD
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ CREATE A THREAD IF ONE DOES NOT EXIST, OR SEND TO AN EXISTING THREAD.
  // The threadId is optional: if provided, send to that thread; if not, create one first.
  // The sender is always the calling person (person_id from session), sender_type is 'client'.
  post("/api/app/messages", "/api/app/messages", (c) =>
    scoped(c, async ({ db, principal }) => {
      const role = assertClientRole(principal);
      const { threadId: providedThreadId, body } = await c.req.json();

      if (!body || typeof body !== "string" || !body.trim()) {
        throw invalid("body is required and must be a non-empty string");
      }

      let threadId = providedThreadId;

      // ★ If no threadId provided, create a new thread for this person.
      if (!threadId) {
        const thread = await createThread(db, {
          tenantId: principal.user.tenant_id,
          personId: principal.appUserId,
        });
        threadId = thread.id;
      } else {
        // ★ Verify the thread exists and belongs to this person.
        const { rows: [thread] } = await db.query(
          `SELECT id, person_id FROM keystone.message_thread
           WHERE id = $1 AND tenant_id = $2 AND person_id = $3`,
          [threadId, principal.user.tenant_id, principal.appUserId]);
        if (!thread) throw notFound("no such thread or you do not have access to it");
      }

      // ★ Send the message. The sender is the calling person, sender_type is 'client'.
      // ★ FIX (coordinator, checkpoint, 24 Sep 2026): returned flat, not wrapped in `{ message }` —
      //   `sendMessage()` already returns exactly the shape `PortalMessages.svelte` reads
      //   (`data.id`, `data.senderId`, `data.body`, `data.created_at`), and this was the one field
      //   in the whole client/server pair that didn't already line up (see the note on
      //   `registerAppMessagesRoutes` below for the rest of what was mismatched).
      const message = await sendMessage(db, {
        tenantId: principal.user.tenant_id,
        threadId,
        senderType: "client",
        senderId: principal.appUserId,
        body,
      });

      return message;
    }, { bucket: "app" })
  );

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/app/messages/:messageId/read — MARK A MESSAGE AS READ
  // ───────────────────────────────────────────────────────────────────────────
  // ★★★ PERSON-SCOPED. A client can only mark messages as read in threads they own.
  // The marker is idempotent: marking an already-read message is not an error.
  post("/api/app/messages/:messageId/read", "/api/app/messages", (c) =>
    scoped(c, async ({ db, principal }) => {
      assertClientRole(principal);
      const messageId = c.req.param("messageId");
      if (!messageId) throw invalid("messageId is required");

      // ★ Verify the message exists in a thread that belongs to this person (RLS will enforce).
      const { rows: [msg] } = await db.query(
        `SELECT m.id FROM keystone.message m
         JOIN keystone.message_thread mt ON mt.id = m.thread_id
         WHERE m.id = $1 AND m.tenant_id = $2 AND mt.person_id = $3`,
        [messageId, principal.user.tenant_id, principal.appUserId]);
      if (!msg) throw notFound("no such message or you do not have access to it");

      const result = await markRead(db, {
        tenantId: principal.user.tenant_id,
        messageId,
      });

      return result;
    }, { bucket: "app" })
  );

}
