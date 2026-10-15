// Run 10 R10-41: a Docustay workspace gets document-side notices only; the platform's CRM notices (usage reconciled, accounts, booking, money...) stay the platform's.
import test from "node:test";
import assert from "node:assert/strict";
import { GENERIC_NOTIFICATIONS, docustayWantsNotice } from "../src/queue/genericNotifications.mjs";

test("document-side and team topics reach a Docustay owner; the CRM ones do not (every topic exists in the table, so the control is real)", () => {
  for (const t of ["documents.document.signed", "documents.document.executed", "documents.document.bounced", "documents.usage.threshold", "settings.subscription.updated", "settings.data.export_ready", "people.role.granted", "people.team.member_removed"]) { assert.ok(GENERIC_NOTIFICATIONS[t], `${t} is in the table`); assert.equal(docustayWantsNotice(t), true, t); }
  for (const t of ["settings.usage.reconciled", "accounts.account.created", "booking.policy.changed", "money.payout.recorded", "growth.campaign.scheduled", "run.item.blocked", "messages.message.sent", "tasks.task.assigned"]) { assert.ok(GENERIC_NOTIFICATIONS[t], `${t} is in the table`); assert.equal(docustayWantsNotice(t), false, t); }
});
