// Messages — read functions for client portal and app routes.
//
// Functions: getThreadsForPerson, getMessagesForThread, getUnreadCount.
// These are called by app routes to return thread lists and message history to clients.

/**
 * Get all threads for a person (client).
 *
 * ★ Returns threads ordered by most recent update first, with an unread message count.
 */
export async function getThreadsForPerson(db, { tenantId, personId }) {
  const { rows } = await db.query(
    `SELECT
       mt.id,
       mt.person_id,
       mt.created_at,
       mt.updated_at,
       p.display_name AS person_name,
       (SELECT COUNT(*) FROM keystone.message WHERE thread_id = mt.id AND read_at IS NULL) AS unread_count
     FROM keystone.message_thread mt
     LEFT JOIN keystone.app_user p ON p.id = mt.person_id
     WHERE mt.tenant_id = $1 AND mt.person_id = $2
     ORDER BY mt.updated_at DESC
     LIMIT 100`,
    [tenantId, personId]);
  return rows;
}

/**
 * Get all messages in a thread.
 *
 * ★ Returns messages ordered by creation time, with sender info if available.
 */
export async function getMessagesForThread(db, { tenantId, threadId }) {
  const { rows } = await db.query(
    `SELECT
       m.id,
       m.thread_id,
       m.sender_type,
       m.sender_id,
       m.body,
       m.created_at,
       m.read_at
     FROM keystone.message m
     WHERE m.tenant_id = $1 AND m.thread_id = $2
     ORDER BY m.created_at ASC
     LIMIT 500`,
    [tenantId, threadId]);
  return rows;
}

/**
 * Get unread message count for a person across all threads.
 *
 * ★ Used for badge display on the messages icon.
 */
export async function getUnreadCount(db, { tenantId, personId }) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS count
     FROM keystone.message m
     JOIN keystone.message_thread mt ON mt.id = m.thread_id
     WHERE m.tenant_id = $1 AND mt.person_id = $2 AND m.read_at IS NULL`,
    [tenantId, personId]);
  return Number(rows[0]?.count ?? 0);   // RUN-2: COUNT is bigint → pg returns a string; the badge wants a number
}
