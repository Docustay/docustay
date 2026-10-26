// @ts-check
// src/email/notificationEmail.mjs — THE BRANDED FRAME FOR ORDINARY NOTIFICATION EMAILS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ FOUND LIVE, 1 Oct 2026 (the "7 missing emails" brief) — `resolveTemplate()`'s own comment
//     says it plainly: every shipped template's `html_body` function returns `""`. Every
//     notification email this product has ever sent — receipts, reminders, invites, the lot — has
//     gone out as PLAIN TEXT ONLY. The one real, proven, branded HTML email in this codebase is
//     `src/email/signLinkEmail.mjs`'s `SignLinkEmail` (React Email: logo, heading, body, a button,
//     a footer) — built for ONE sender (the document sign-link). This file is that SAME frame,
//     generalised so `deliverNotificationEmail` (src/queue/tasks.mjs) can put EVERY notification
//     through it instead of raw text — fixing "branded look" once, at the root, for the 7 new
//     emails this brief asks for AND retroactively for the ~45 that already exist.
//
// ★ WHY `React.createElement`, NOT JSX: same reason as signLinkEmail.mjs — `src/` is plain Node ESM
//   with no build/transform step.
//
// ★ THE FRAME IS FIXED, THE CONTENT IS NOT. Logo, practice name, the card, the footer are always
//   the same component; `heading`/`bodyText`/`ctaLabel`/`ctaLink` are the template's own resolved
//   subject/text — nothing here re-authors a template's wording.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createElement as h } from "react";
import { logoBlock, lightOnlyMeta } from "./emailLogo.mjs";
import { render } from "@react-email/render";
import {
  Html, Head, Preview, Body, Container, Section, Img, Heading, Text, Button, Hr, Link,
} from "@react-email/components";

const BRAND_COLOR = "#5A3AC1"; // ★ same default accent signLinkEmail.mjs uses (webreact's design tokens)

/**
 * @param {object} p
 * @param {string} p.practiceName
 * @param {string|null} p.logoUrl
 * @param {string} p.preview       the inbox preview line — usually the subject
 * @param {string} p.heading       a short line above the body (often the subject, shortened)
 * @param {string} p.bodyText      the template's own resolved text, verbatim — never re-worded here
 * @param {string|null} p.ctaLabel
 * @param {string|null} p.ctaLink
 * @param {Array<{label:string, href:string, variant?:"primary"|"secondary"}>|null} [p.buttons]  several buttons in a row (booking emails); when given, the single CTA is not drawn
 * @param {string|null} p.leadText     a big, prominent line ABOVE the heading (e.g. "$150.00 due") — NEW, Part 3 invoice rebuild
 * @param {string|null} p.leadSubtext  a smaller line under leadText (e.g. "Due Oct 31, 2026")
 * @param {string} p.footerLine    e.g. "Sent by an example organisation"
 */
function NotificationEmailBody({ practiceName, logoUrl, heading, bodyText, ctaLabel = null, ctaLink = null, buttons = null, leadText = null, leadSubtext = null, footerLine }) {
  return h(Body, { style: { backgroundColor: "#f4f4f5", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", margin: 0, padding: "32px 0" } },
    h(Container, { style: { backgroundColor: "#ffffff", borderRadius: "12px", maxWidth: "480px", margin: "0 auto", padding: "32px" } },
      logoBlock(h, { logoUrl, practiceName }),
      leadText
        ? h(Text, { style: { fontSize: "30px", fontWeight: 600, color: "#18181b", margin: "0 0 4px" } }, leadText)
        : null,
      leadSubtext
        ? h(Text, { style: { fontSize: "13px", color: "#71717a", margin: "0 0 16px" } }, leadSubtext)
        : null,
      h(Heading, { style: { fontSize: "20px", fontWeight: 600, color: "#18181b", margin: "0 0 16px" } }, heading),
      h(Text, { style: { fontSize: "15px", color: "#3f3f46", lineHeight: "22px", margin: "0 0 24px", whiteSpace: "pre-wrap" } }, bodyText),
      buttons && buttons.length
        ? h(Section, { style: { margin: 0 } }, ...buttons.map((b) => h(Button, {
            key: b.label, href: b.href,
            style: b.variant === "secondary"
              ? { backgroundColor: "#ffffff", color: BRAND_COLOR, border: `1px solid ${BRAND_COLOR}`, fontSize: "15px", fontWeight: 600,
                  borderRadius: "8px", padding: "11px 20px", textDecoration: "none", display: "inline-block", margin: "0 8px 8px 0" }
              : { backgroundColor: BRAND_COLOR, color: "#ffffff", fontSize: "15px", fontWeight: 600,
                  borderRadius: "8px", padding: "12px 20px", textDecoration: "none", display: "inline-block", margin: "0 8px 8px 0" },
          }, b.label)))
        : ctaLabel && ctaLink
        ? h(Button, {
            href: ctaLink,
            style: {
              backgroundColor: BRAND_COLOR, color: "#ffffff", fontSize: "15px", fontWeight: 600,
              borderRadius: "8px", padding: "12px 24px", textDecoration: "none", display: "inline-block",
            },
          }, ctaLabel)
        : null,
      h(Hr, { style: { borderColor: "#e4e4e7", margin: "24px 0" } }),
      h(Text, { style: { fontSize: "12px", color: "#a1a1aa", margin: 0 } }, footerLine),
    ),
  );
}

function NotificationEmail(props) {
  return h(Html, null,
    h(Head, null, ...lightOnlyMeta(h)),
    h(Preview, null, props.preview),
    h(NotificationEmailBody, props),
  );
}

/**
 * Render a notification's resolved subject/text into the branded frame. Returns `{html, text}` —
 * `html` for Resend's `html` field, `text` as a plain fallback (Resend sends both; most clients
 * show html).
 *
 * ★ A blank/whitespace-only `bodyText` renders an empty email body rather than throwing — callers
 *   already validate their own template output; this is the LAST stage, not a second validator.
 */
export async function renderNotificationEmail({
  practiceName, logoUrl = null, subject, bodyText, ctaLabel = null, ctaLink = null, buttons = null,
  leadText = null, leadSubtext = null,
}) {
  const footerLine = `Sent by ${practiceName}.`;
  const element = h(NotificationEmail, {
    practiceName, logoUrl, preview: subject, heading: subject, bodyText, ctaLabel, ctaLink, buttons,
    leadText, leadSubtext, footerLine,
  });
  const html = await render(element);
  const text = await render(element, { plainText: true });
  return { html, text };
}
