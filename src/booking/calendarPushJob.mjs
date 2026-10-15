// @ts-check
// src/booking/calendarPushJob.mjs — keep the host's Google Calendar in step with a booking (6 Oct 2026).
// ★ STATE-BASED, NOT TOPIC-BASED: the job reads the booking as it is NOW and makes the calendar match, so created→rescheduled→cancelled
//   arriving close together (or a retried job) converges on the same answer. Provider calls: src/booking/googleCalendar.mjs.
// ★ Never blocks or undoes a booking: a calendar that cannot be reached is a status on the person's calendar (`needs_attention`) and a retry,
//   never a refusal to the visitor.
import { pushBookingCreated, pushBookingRescheduled, pushBookingCancelled } from "./calendarPush.mjs";
import { googleConnectionsFor, insertEvent, patchEvent, deleteEvent } from "./googleCalendar.mjs";
import { dependency } from "../http/errors.mjs";

async function connRow(tx, { tenantId, hostId, connectionId }) {
  const rows = await googleConnectionsFor(tx, { tenantId, hostId });
  return rows.find((r) => r.id === connectionId) ?? null;
}

/** @param {{tenantId:string, bookingId:string}} a */
export async function reconcileBookingCalendar(tx, { tenantId, bookingId }, deps = {}) {
  const { rows } = await tx.query(
    `SELECT b.id, b.host_id, b.state, b.location_kind, t.timezone, s.name AS service_name
       FROM keystone.booking b JOIN keystone.tenant t ON t.id = b.tenant_id JOIN keystone.service s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      WHERE b.tenant_id = $1 AND b.id = $2`, [tenantId, bookingId]);
  const b = rows[0];
  if (!b) return { pushed: 0, gone: true };

  /** Provider callbacks: a connection's row is re-read so its sealed token is opened at the moment of use. */
  const host = { hostId: b.host_id };
  const must = async (conn) => {
    if (conn.provider !== "google") throw dependency(`calendar push: ${conn.provider} is not wired — only Google Calendar is`);
    const row = await connRow(tx, { tenantId, hostId: host.hostId, connectionId: conn.id });
    if (!row) throw dependency("calendar push: the connection is not active any more");
    return row;
  };
  const providers = {
    createRemoteEvent: async (conn, d) => {
      const row = await must(conn);
      const r = await insertEvent(tx, { tenantId, conn: row, calendarId: d.calendarId, summary: d.title, description: d.locationDetail ?? "", startsAt: new Date(d.startsAt), endsAt: new Date(d.endsAt), timeZone: b.timezone, video: b.location_kind === "video", requestId: `${bookingId}:${conn.id}` }, deps);
      if (!r.ok) throw dependency(`calendar push: ${r.error ?? "Google did not accept the event"}`);
      return { externalEventId: r.eventId, etag: r.etag ?? null };
    },
    updateRemoteEvent: async (conn, eventId, d) => {
      const row = await must(conn);
      const r = await patchEvent(tx, { tenantId, conn: row, calendarId: row.push_calendar_id, eventId, startsAt: new Date(d.startsAt), endsAt: new Date(d.endsAt), timeZone: b.timezone }, deps);
      if (!r.ok) throw dependency(`calendar push: ${r.error ?? "Google did not accept the change"}`);
      return { etag: r.etag ?? null };
    },
    deleteRemoteEvent: async (conn, eventId) => {
      // the event may belong to a connection of a PREVIOUS host: find it by connection id across this practice's active google connections
      const { rows: c } = await tx.query(
        `SELECT c.id, c.host_id FROM keystone.calendar_connection c WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, conn.id]);
      const row = c[0] ? (await connRow(tx, { tenantId, hostId: c[0].host_id, connectionId: conn.id })) : null;
      if (!row) return; // the connection is gone — nothing to delete from
      const r = await deleteEvent(tx, { tenantId, conn: row, calendarId: row.push_calendar_id, eventId }, deps);
      if (!r.ok) throw dependency(`calendar push: ${r.error ?? "Google did not accept the delete"}`);
    },
  };

  if (b.state === "cancelled") return pushBookingCancelled(tx, { tenantId, bookingId, deleteRemoteEvent: providers.deleteRemoteEvent });

  // events written to a DIFFERENT person's calendar (the booking was reassigned) are removed first
  const { rows: stale } = await tx.query(
    `SELECT m.id, m.connection_id, m.external_event_id, c.provider, c.push_calendar_id
       FROM keystone.calendar_event_map m JOIN keystone.calendar_connection c ON c.id = m.connection_id
      WHERE m.tenant_id = $1 AND m.booking_id = $2 AND c.host_id <> $3`, [tenantId, bookingId, b.host_id]);
  for (const s of stale) {
    await providers.deleteRemoteEvent({ id: s.connection_id, provider: s.provider, pushCalendarId: s.push_calendar_id }, s.external_event_id);
    await tx.query(`DELETE FROM keystone.calendar_event_map WHERE id = $1`, [s.id]);
  }
  const moved = await pushBookingRescheduled(tx, { tenantId, bookingId, updateRemoteEvent: providers.updateRemoteEvent });
  const made = await pushBookingCreated(tx, { tenantId, bookingId, createRemoteEvent: providers.createRemoteEvent });
  return { pushed: moved.pushed + made.pushed, removed: stale.length };
}
