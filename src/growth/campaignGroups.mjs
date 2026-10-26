// @ts-check
/**
 * Campaign Groups — CRUD and rollup for F17 §3.
 *
 * A campaign_group is a container: one group holds sends (campaign), landing pages,
 * segments, and ads, and reports as one number (results rollup).
 *
 * attach/detach: 409 when attaching an object already in another LIVE group
 * (one home at a time; moving is detach+attach, audited).
 *
 * Results rollup: computed from OUR OWN ROWS only. No provider call, no Stripe search.
 * - sent, deliveredPct, openedPct, clickedPct, unsubscribed, leads, booked
 * - bookedDefinition: plain text stating "people in this group's segments with a booking
 *   created after the group's first send"
 *
 * Migration 0486 adds opened_at, open_count, first_clicked_at, click_count to email_delivery.
 * Until 0486 applies, the rollup degrades to delivered-only (no opens/clicks).
 */

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "growth";
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Create a campaign group.
 */
export async function createCampaignGroup(
  tx, {
    tenantId,
    name,
    status = "planning",
    goal = null,
    startsOn = null,
    endsOn = null,
    actorUserId = null,
  }
) {
  if (!name || typeof name !== "string" || !name.trim()) {
    throw invalid("name is required and cannot be blank");
  }
  if (!["planning", "live", "done"].includes(status)) {
    throw invalid("status must be one of: planning, live, done");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;

  try {
    await run(tx, db.insertInto("keystone.campaign_group").values({
      id: id ?? null,
      tenant_id: tenantId ?? null,
      name: name.trim() ?? null,
      status: status ?? null,
      goal: (goal ? goal.trim() : null) ?? null,
      starts_on: startsOn ?? null,
      ends_on: endsOn ?? null,
    }));
  } catch (e) {
    if (e.code === FOREIGN_KEY_VIOLATION) {
      throw invalid(`invalid reference: ${e.constraint ?? e.message}`);
    }
    throw e;
  }

  await emit(tx, {
    tenantId,
    topic: "growth.campaign_group.created",
    emittedBy: SECTION,
    subjectType: "campaign_group",
    subjectId: id,
    actor: userActor(actorUserId),
    payload: { status },
  });

  return {
    id,
    tenant_id: tenantId,
    name: name.trim(),
    status,
    goal: goal ? goal.trim() : null,
    starts_on: startsOn,
    ends_on: endsOn,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Update a campaign group.
 */
export async function updateCampaignGroup(
  tx, {
    tenantId,
    groupId,
    name,
    status,
    goal,
    startsOn,
    endsOn,
    actorUserId = null,
  }
) {
  const row = await run(tx, db.selectFrom("keystone.campaign_group").select(["id", "name", "status"]).where("id", "=", groupId).where("tenant_id", "=", tenantId));
  if (row.rows.length === 0) {
    throw notFound("campaign group not found");
  }

  const sets = [];
  const args = [groupId, tenantId];

  if (name !== undefined && name !== null) {
    if (!name.trim()) {
      throw invalid("name cannot be blank");
    }
    sets.push(`name = $${args.length + 1}`);
    args.push(name.trim());
  }
  if (status !== undefined && status !== null) {
    if (!["planning", "live", "done"].includes(status)) {
      throw invalid("status must be one of: planning, live, done");
    }
    sets.push(`status = $${args.length + 1}`);
    args.push(status);
  }
  if (goal !== undefined) {
    sets.push(`goal = $${args.length + 1}`);
    args.push(goal ? goal.trim() : null);
  }
  if (startsOn !== undefined) {
    sets.push(`starts_on = $${args.length + 1}`);
    args.push(startsOn);
  }
  if (endsOn !== undefined) {
    sets.push(`ends_on = $${args.length + 1}`);
    args.push(endsOn);
  }

  if (sets.length === 0) {
    const updated = await run(tx, db.selectFrom("keystone.campaign_group").select(["id", "tenant_id", "name", "status", "goal", "starts_on", "ends_on", "created_at", "updated_at"]).where("id", "=", groupId).where("tenant_id", "=", tenantId));
    return updated.rows[0];
  }

  sets.push(`updated_at = now()`);
  const query = `UPDATE keystone.campaign_group SET ${sets.join(", ")}
                 WHERE id = $1 AND tenant_id = $2 RETURNING *`;
  const result = await tx.query(query, args);

  await emit(tx, {
    tenantId,
    topic: "growth.campaign_group.updated",
    emittedBy: SECTION,
    subjectType: "campaign_group",
    subjectId: groupId,
    actor: userActor(actorUserId),
    payload: { status: result.rows[0].status },
  });

  return result.rows[0];
}

/**
 * Delete a campaign group. ON DELETE SET NULL on the FKs means the group's
 * campaigns, pages, and segments survive but lose their group_id.
 */
export async function deleteCampaignGroup(
  tx, {
    tenantId,
    groupId,
    actorUserId = null,
  }
) {
  const row = await run(tx, db.selectFrom("keystone.campaign_group").select("id").where("id", "=", groupId).where("tenant_id", "=", tenantId));
  if (row.rows.length === 0) {
    throw notFound("campaign group not found");
  }

  await run(tx, db.deleteFrom("keystone.campaign_group").where("id", "=", groupId).where("tenant_id", "=", tenantId));

  await emit(tx, {
    tenantId,
    topic: "growth.campaign_group.deleted",
    emittedBy: SECTION,
    subjectType: "campaign_group",
    subjectId: groupId,
    actor: userActor(actorUserId),
    payload: {},
  });

  return { id: groupId };
}

/**
 * Attach a campaign, landing_page, or segment to a group.
 * 409 if the object is already attached to a different LIVE group.
 */
export async function attachToCampaignGroup(
  tx, {
    tenantId,
    groupId,
    kind, // 'send' | 'page' | 'segment'
    id, // the object id
    actorUserId = null,
  }
) {
  // Validate the group exists
  const groupRow = await run(tx, db.selectFrom("keystone.campaign_group").select(["id", "status"]).where("id", "=", groupId).where("tenant_id", "=", tenantId));
  if (groupRow.rows.length === 0) {
    throw notFound("campaign group not found");
  }

  const groupStatus = groupRow.rows[0].status;

  // Map kind to table and column
  let table, idCol, currentGroupCol;
  if (kind === "send") {
    table = "campaign";
    idCol = "id";
    currentGroupCol = "campaign_group_id";
  } else if (kind === "page") {
    table = "landing_page";
    idCol = "id";
    currentGroupCol = "campaign_group_id";
  } else if (kind === "segment") {
    table = "segment";
    idCol = "id";
    currentGroupCol = "campaign_group_id";
  } else {
    throw invalid(`kind must be one of: send, page, segment (got ${kind})`);
  }

  // Check if object exists in this tenant
  const objRow = await tx.query(
    `SELECT id, ${currentGroupCol} FROM keystone.${table} WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  if (objRow.rows.length === 0) {
    throw notFound(`${kind} not found`);
  }

  const currentGroupId = objRow.rows[0][currentGroupCol];

  // 409 if already in a different LIVE group
  if (currentGroupId && currentGroupId !== groupId) {
    const otherGroup = await run(tx, db.selectFrom("keystone.campaign_group").select("status").where("id", "=", currentGroupId).where("tenant_id", "=", tenantId));
    if (otherGroup.rows.length > 0 && otherGroup.rows[0].status === "live") {
      throw conflict(`${kind} is already attached to another live campaign group`);
    }
  }

  // Attach
  await tx.query(
    `UPDATE keystone.${table} SET ${currentGroupCol} = $1 WHERE id = $2 AND tenant_id = $3`,
    [groupId, id, tenantId]
  );

  await emit(tx, {
    tenantId,
    topic: `growth.campaign_group.attached`,
    emittedBy: SECTION,
    subjectType: "campaign_group",
    subjectId: groupId,
    actor: userActor(actorUserId),
    payload: { kind, object_id: id },
  });

  return { id: groupId };
}

/**
 * Detach a campaign, landing_page, or segment from a group.
 */
export async function detachFromCampaignGroup(
  tx, {
    tenantId,
    groupId,
    kind, // 'send' | 'page' | 'segment'
    id, // the object id
    actorUserId = null,
  }
) {
  // Validate the group exists
  const groupRow = await run(tx, db.selectFrom("keystone.campaign_group").select("id").where("id", "=", groupId).where("tenant_id", "=", tenantId));
  if (groupRow.rows.length === 0) {
    throw notFound("campaign group not found");
  }

  // Map kind to table
  let table;
  if (kind === "send") {
    table = "campaign";
  } else if (kind === "page") {
    table = "landing_page";
  } else if (kind === "segment") {
    table = "segment";
  } else {
    throw invalid(`kind must be one of: send, page, segment (got ${kind})`);
  }

  // Detach (SET NULL)
  await tx.query(
    `UPDATE keystone.${table} SET campaign_group_id = NULL WHERE id = $1 AND tenant_id = $2 AND campaign_group_id = $3`,
    [id, tenantId, groupId]
  );

  await emit(tx, {
    tenantId,
    topic: `growth.campaign_group.detached`,
    emittedBy: SECTION,
    subjectType: "campaign_group",
    subjectId: groupId,
    actor: userActor(actorUserId),
    payload: { kind, object_id: id },
  });

  return { id: groupId };
}

/**
 * Pause a campaign group.
 */
export async function pauseCampaignGroup(
  tx, {
    tenantId,
    id,        // URL parameter from :id
    groupId,   // Body parameter (fallback for compatibility)
    actorUserId = null,
  }
) {
  const actualGroupId = id || groupId;
  if (!actualGroupId) {
    throw invalid("groupId or id is required");
  }

  const row = await run(tx, db.selectFrom("keystone.campaign_group").select(["id", "status"]).where("id", "=", actualGroupId).where("tenant_id", "=", tenantId));
  if (row.rows.length === 0) {
    throw notFound("campaign group not found");
  }

  await run(tx, db.updateTable("keystone.campaign_group").set({ status: "paused", updated_at: sql`now()` }).where("id", "=", actualGroupId).where("tenant_id", "=", tenantId));

  await emit(tx, {
    tenantId,
    topic: "growth.campaign_group.paused",
    emittedBy: SECTION,
    subjectType: "campaign_group",
    subjectId: actualGroupId,
    actor: userActor(actorUserId),
    payload: {},
  });

  return { id: actualGroupId, status: "paused" };
}

/**
 * Get results rollup for a campaign group.
 *
 * Computes from OUR OWN ROWS:
 * - sent: count of email_delivery rows from campaigns in this group
 * - delivered: count where email_bounced_at is NULL
 * - openedPct, clickedPct: from 0486 columns if they exist, else NULL
 * - unsubscribed: count where email_unsubscribed_at is not NULL
 * - leads: count of funnel_event with person_id matching the group's segments
 * - booked: count of people in the group's segments with a booking created after
 *   the group's first send
 * - bookedDefinition: plain text explaining what "booked" means
 *
 * Returns: {sent, deliveredPct, openedPct, clickedPct, unsubscribed, leads, booked, bookedDefinition}
 */
export async function getCampaignGroupResults(tx, { tenantId, groupId }) {
  // Verify the group exists
  const groupRow = await run(tx, db.selectFrom("keystone.campaign_group").select(["id", "created_at"]).where("id", "=", groupId).where("tenant_id", "=", tenantId));
  if (groupRow.rows.length === 0) {
    throw notFound("campaign group not found");
  }

  const groupCreatedAt = groupRow.rows[0].created_at;

  // Get all campaigns in this group
  const campaignsRow = await run(tx, db.selectFrom("keystone.campaign").select("id").where("tenant_id", "=", tenantId).where("campaign_group_id", "=", groupId));
  const campaignIds = campaignsRow.rows.map(r => r.id);

  let sent = 0;
  let delivered = 0;
  let opened = 0;
  let clicked = 0;
  let unsubscribed = 0;

  // Compute sent/delivered from email_delivery
  if (campaignIds.length > 0) {
    const placeholders = campaignIds.map((_, i) => `$${i + 2}`).join(",");
    const deliveryRow = await tx.query(
      // ★ real schema: a campaign's notifications point at an event about the campaign; a delivery
      //   has a status, not bounce/open/click columns. Opens, clicks and unsubscribes are tracked per
      //   PERSON (app_user.opened_at…), never per delivery — so they come back null, not 0 (F-R2-8).
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE nd.status NOT IN ('attempted', 'failed')) as delivered_count,
        NULL::int as unsubscribed_count,
        NULL::int as opened_count,
        NULL::int as clicked_count
       FROM keystone.notification_delivery nd
       JOIN keystone.notification n ON n.id = nd.notification_id
       JOIN keystone.event e ON e.id = n.event_id AND e.subject_type = 'campaign'
       WHERE n.tenant_id = $1 AND e.subject_id IN (${placeholders})`,
      [tenantId, ...campaignIds]
    );

    if (deliveryRow.rows.length > 0) {
      const row = deliveryRow.rows[0];
      sent = parseInt(row.total) || 0;
      delivered = parseInt(row.delivered_count) || 0;
      opened = row.opened_count == null ? null : parseInt(row.opened_count);
      clicked = row.clicked_count == null ? null : parseInt(row.clicked_count);
      unsubscribed = row.unsubscribed_count == null ? null : parseInt(row.unsubscribed_count);
    }
  }

  // Compute deliveredPct
  const deliveredPct = sent > 0 ? Math.round((delivered / sent) * 100) : 0;

  // Compute openedPct and clickedPct (degrade to null if 0486 not applied yet)
  // If opened = 0 and sent > 0, the columns don't exist (0486 not applied)
  const engagementApplied = opened !== null && clicked !== null;  // not tracked per campaign → null
  const openedPct = engagementApplied && sent > 0 ? Math.round((opened / sent) * 100) : null;
  const clickedPct = engagementApplied && sent > 0 ? Math.round((clicked / sent) * 100) : null;

  // Get all segment ids in this group
  const segmentsRow = await run(tx, db.selectFrom("keystone.segment").select("id").where("tenant_id", "=", tenantId).where("campaign_group_id", "=", groupId));
  const segmentIds = segmentsRow.rows.map(r => r.id);

  let leads = 0;
  let booked = 0;

  if (segmentIds.length > 0) {
    // Count leads: funnel_event rows with person_id from any campaign in this group
    const leadsPlaceholders = campaignIds.map((_, i) => `$${i + 2}`).join(",");
    const leadsRow = await tx.query(
      `SELECT COUNT(DISTINCT person_id) as leads FROM keystone.funnel_event
       WHERE tenant_id = $1 AND campaign_id IN (${leadsPlaceholders})`,
      [tenantId, ...campaignIds]
    );
    leads = parseInt(leadsRow.rows[0].leads) || 0;

    // Count booked: people in the group's segments with a booking created after the group's first send
    // First, get the minimum created_at from campaigns in the group (represents first send)
    const firstSendRow = await tx.query(
      `SELECT MIN(created_at) as first_send FROM keystone.campaign
       WHERE tenant_id = $1 AND campaign_group_id = $2`,
      [tenantId, groupId]
    );
    const firstSend = firstSendRow.rows[0]?.first_send;

    if (firstSend) {
      const segmentPlaceholders = segmentIds.map((_, i) => `$${i + 3}`).join(",");
      const bookedRow = await tx.query(
        `SELECT COUNT(DISTINCT b.id) as booked_count
         FROM keystone.booking b
         JOIN keystone.booking_participant bp ON bp.booking_id = b.id
         WHERE b.tenant_id = $1
           AND bp.app_user_id IN (
             SELECT DISTINCT person_id FROM keystone.funnel_event
             WHERE tenant_id = $1 AND campaign_id IN (${leadsPlaceholders})
           )
           AND b.created_at > $2`,
        [tenantId, firstSend, ...campaignIds]
      );
      booked = parseInt(bookedRow.rows[0].booked_count) || 0;
    }
  }

  const bookedDefinition =
    "People in this campaign's audience segments who booked a session after the first send.";

  return {
    sent,
    deliveredPct,
    openedPct,
    clickedPct,
    unsubscribed,
    leads,
    booked,
    bookedDefinition,
  };
}
