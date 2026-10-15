// @ts-check
// ★★★ PUSH NOTIFICATION SENDER FOR FIREBASE CLOUD MESSAGING (FCM)
//
// ★ This module handles sending push notifications to registered devices via FCM.
// Device tokens are registered via `src/notifications/send.mjs:registerDeviceToken`.
// FCM credential is provided by `KEYSTONE_FIREBASE_SERVICE_ACCOUNT_JSON`.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ PUSH IS A THIRD INDEPENDENT PREFERENCE AXIS — NOT COUPLED TO IN-APP/EMAIL.
// Per MOCKUPS §15, a person can have push ON independently of their email/in-app settings.
// The preference mechanism in `src/notifications/rules.mjs` handles this automatically via the
// three-tier fallback (`notification_preference` → `notification_rule` → implicit on).
// ═════════════════════════════════════════════════════════════════════════════════════════════

import { getMessaging } from "firebase-admin/messaging";
import { initializeApp, applicationDefault, getApps, cert } from "firebase-admin/app";
import { internal } from "../http/errors.mjs";
import { isDeadToken, deleteDeadToken } from "./send.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

let messagingInstance = null;

/**
 * Initialize Firebase Admin SDK for messaging (push notifications).
 * Shares the same Firebase project as auth (KEYSTONE_FIREBASE_PROJECT_ID).
 * Credential is KEYSTONE_FIREBASE_SERVICE_ACCOUNT_JSON (optional; uses applicationDefault if unset).
 */
function getFirebaseMessaging() {
  if (messagingInstance) return messagingInstance;

  const projectId = process.env.KEYSTONE_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw internal("KEYSTONE_FIREBASE_PROJECT_ID is not set — push notifications cannot be configured");
  }

  // ★ Reuse existing Firebase app if already initialized (auth uses this too), otherwise create it
  if (getApps().length === 0) {
    const raw = process.env.KEYSTONE_FIREBASE_SERVICE_ACCOUNT_JSON;
    initializeApp({
      projectId,
      credential: raw ? cert(JSON.parse(raw)) : applicationDefault(),
    });
  }

  messagingInstance = getMessaging();
  return messagingInstance;
}

/**
 * ★ Fetch all registered device tokens for a person.
 * Returns an array of {id, platform, token} objects.
 */
async function getDeviceTokens(tx, { tenantId, appUserId }) {
  const { rows } = await tx.query(
    `SELECT id, platform, token FROM keystone.device_token
      WHERE tenant_id = $1 AND app_user_id = $2
      ORDER BY last_seen_at DESC`,
    [tenantId, appUserId]);
  return rows;
}

/**
 * ★★★ SEND A PUSH NOTIFICATION VIA FCM.
 *
 * Called by `fanOut()` in `src/notifications/send.mjs` with (tenantId, recipientId, notificationId).
 * Fetches the recipient's device tokens, constructs an FCM message, and sends.
 *
 * ★ Returns { provider, messageIds } on success (one or more tokens sent).
 * ★ Throws with .code/.message/.token (for dead-token handling by fanOut).
 *
 * ★★ DEAD TOKENS — a rejection that matches `isDeadToken` signals the token should be deleted.
 *     fanOut() catches this and calls deleteDeadToken() in the same transaction (P9.8).
 */
export async function pushSender(tx, { tenantId, recipientId, notificationId }) {
  // ★ Fetch the notification to get the title/body
  const { rows: [notif] } = await run(tx, db
    .selectFrom("keystone.notification")
    .select(["title", "body", "deep_link"])
    .where("id", "=", notificationId));
  if (!notif) {
    throw new Error("notification not found");
  }

  // ★ Get all registered device tokens for this recipient
  const tokens = await getDeviceTokens(tx, { tenantId, appUserId: recipientId });
  if (tokens.length === 0) {
    throw new Error("no device tokens registered for this recipient");
  }

  try {
    const messaging = getFirebaseMessaging();

    // ★★ Construct the FCM message. Send to multiple tokens with multicast if > 1, else single.
    const fcmMessage = {
      notification: {
        title: notif.title,
        body: notif.body || undefined,
      },
      // ★ Android-specific: allows app to handle notification in background
      android: {
        priority: "high",
      },
      // ★ iOS-specific: mutable-content enables rich notifications
      apns: {
        payload: {
          aps: {
            "mutable-content": 1,
          },
        },
      },
      // ★ Data payload: includes deep link if present
      data: {
        notificationId: notificationId,
        ...(notif.deep_link && { deepLink: notif.deep_link }),
      },
    };

    const messageIds = [];
    const failedTokens = [];

    // ★ Send to each token. If one fails, record it but continue with others.
    for (const { token, id } of tokens) {
      try {
        const msgId = await messaging.send({
          token,
          ...fcmMessage,
        });
        messageIds.push(msgId);
      } catch (e) {
        failedTokens.push({ token, id, error: e });
      }
    }

    // ★★ If ALL tokens failed, throw the first failure so fanOut records it
    if (failedTokens.length === tokens.length) {
      const failure = failedTokens[0];
      const err = new Error(failure.error?.message ?? `FCM send failed to all ${tokens.length} tokens`);
      err.code = failure.error?.code;
      err.token = failure.token;
      throw err;
    }

    // ★ If SOME failed, delete those tokens and return success for the ones that worked
    for (const { token, error: e } of failedTokens) {
      if (isDeadToken(e)) {
        await deleteDeadToken(tx, { tenantId, token });
      }
    }

    return {
      provider: "firebase",
      messageIds: messageIds.length > 0 ? messageIds[0] : undefined,
      // ★ Record how many actually sent (for debugging multi-token sends)
      sentCount: messageIds.length,
      failedCount: failedTokens.length,
    };
  } catch (e) {
    // ★ Re-throw with token info if available (for dead-token cleanup by fanOut)
    if (e.token) throw e;
    // ★ If no specific token, it's a general FCM error (auth, config, etc.)
    throw new Error(`FCM sender failed: ${e?.message ?? String(e)}`);
  }
}

/**
 * ★★ REGISTRATION HANDLER — the logic for `POST /api/notifications/device-token`.
 *
 * The route itself lives in `src/routes/writes.mjs` and dispatches to this function.
 * Validates and registers a device token for the authenticated user.
 *
 * @param tx - database transaction
 * @param {tenantId, appUserId, platform, token} - request parameters
 * @returns {id, inserted} from registerDeviceToken
 */
export async function registerDeviceTokenHandler(tx, { tenantId, appUserId, platform, token }) {
  // ★ Import registerDeviceToken from send.mjs (already exists, used here via tx call)
  const { registerDeviceToken } = await import("./send.mjs");

  if (!platform || !["ios", "android", "web"].includes(platform)) {
    throw new Error("platform must be one of: ios, android, web");
  }
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    throw new Error("token is required and must be a non-empty string");
  }

  // ★ Use the existing registerDeviceToken function with now() for the timestamp
  return registerDeviceToken(tx, {
    tenantId,
    appUserId,
    platform,
    token: token.trim(),
  });
}

/** ★ For testing: reset the messaging instance. */
export function __setMessagingForTests(m) { messagingInstance = m; }
