# The locked kit's licences

One row per locked kit entry from `specs/00-foundations/09-design-system-and-kit.md` §4 and
`specs/MOCKUPS.md` §22. The **Installed** column is checked against `webui/package.json` — a
package copied into the repo as source (not an npm dependency) never carries a `package.json`
entry, so it gets its own status rather than a false "installed: yes".

Do not hand-edit `webui/package.json`, `design/tokens.json` or `webui/src/styles/tokens.css` from
this file — they belong to other tasks (10a.4, 10a.1, 10a.6).

## Kept (staff app, already in `webui/package.json`)

| Package | Version constraint | Licence | Where used | Installed |
|---|---|---|---|---|
| bits-ui | `^2.19.2` | MIT | Base components, command palette — everywhere | installed: yes |
| @lucide/svelte | `^1.46.0` | ISC | Icons — everywhere | installed: yes |
| @tanstack/table-core | `^9.2.4` | MIT | Tables, via shadcn-svelte data table — everywhere | installed: yes |
| svelte-dnd-action | `^0.9.79` | MIT | Drag and drop — form builder, signers, pipeline board, waitlist | installed: yes |
| svelte-sonner | `^1.1.0` | MIT | Toasts / undo bars — everywhere | installed: yes |
| vaul-svelte | `^1.0.0-next.7` | MIT | Phone sheets — everywhere | installed: yes |
| @internationalized/date | `^3.12.0` | Apache-2.0 | Dates, time zones — everywhere they are handled | installed: yes |

## Kept, copied in as source (no npm entry expected)

| Package | Version constraint | Licence | Where used | Installed |
|---|---|---|---|---|
| shadcn-svelte | n/a — components copied in, not published as a single npm package | MIT | Base components, command palette — everywhere | copied in — no package.json entry |
| FileDropZone (shadcn-svelte-extras registry) | n/a — copied in | MIT | File upload | copied in — no package.json entry |

## Added, not yet installed (Q10-5)

| Package | Version constraint | Licence | Where used | Installed |
|---|---|---|---|---|
| @event-calendar/core (EventCalendar) | not pinned yet | MIT | Calendar routes only | installed: no — feature spec NN installs it |
| Edra (Tiptap, copied into `lib/components/edra`) | not pinned yet | MIT | Builders, automations, campaigns, landing pages only | installed: no — feature spec NN installs it |
| LayerChart 2 (via shadcn-svelte charts) | not pinned yet | MIT | Reports, client sites, Home trends only | installed: no — feature spec NN installs it |
| pdf.js (`pdfjs-dist`) | not pinned yet | Apache-2.0 | PDF import and signed-document views only | installed: no — feature spec NN installs it |
| Stripe Elements (`@stripe/stripe-js`) | not pinned yet | Stripe Terms of Service (proprietary SDK, no open-source licence) | Sign-and-pay, update card, payment method only | installed: no — feature spec NN installs it |

## Removed, Stage 10a.4

MOCKUPS §0 / `09-design-system-and-kit.md` §11 is the reason: none of these three survive in the
rebuilt product.

| Package | Version constraint | Licence | Where used | Installed |
|---|---|---|---|---|
| driver.js | was in use before 10a.4 | MIT | Old onboarding tour | removed, Stage 10a.4 |
| @svar-ui/svelte-calendar | was in use before 10a.4 | dual-licensed GPL-2.0-or-later / commercial (SVAR) — not reverified, package removed | Old calendar | removed, Stage 10a.4 |
| @svar-ui/svelte-kanban | was in use before 10a.4 | dual-licensed GPL-2.0-or-later / commercial (SVAR) — not reverified, package removed | Old board (pipeline now uses svelte-dnd-action) | removed, Stage 10a.4 |

## Forms (rule, not an install — MOCKUPS §22 "Forms" row)

| Package | Version constraint | Licence | Where used | Installed |
|---|---|---|---|---|
| formsnap | not pinned yet | MIT | New forms only (current forms stay as they are) | installed: no — feature spec NN installs it |
| sveltekit-superforms | not pinned yet | MIT | New forms only (current forms stay as they are) | installed: no — feature spec NN installs it |
| zod | not pinned yet | MIT | New forms only (current forms stay as they are) | installed: no — feature spec NN installs it |

## Client app (React + Capacitor) — a different `package.json`, not `webui/`

| Package | Version constraint | Licence | Where used | Installed |
|---|---|---|---|---|
| shadcn/ui (React) | n/a — components copied in, not published as a single npm package | MIT | Client app | n/a — client app not yet built, not checked against webui/package.json |
| Radix (`@radix-ui/*`) | not pinned yet | MIT | Client app, under shadcn/ui (React) | n/a — client app not yet built, not checked against webui/package.json |

## Fonts

The tokens.json/tokens.css layer names these; the seven files are already self-hosted at
`web/webdist/fonts/` — MEASURED 21 Sep 2026.

| Package | Version constraint | Licence | Where used | Installed |
|---|---|---|---|---|
| Inter (400, 500, 600, 700) | woff2, self-hosted | SIL Open Font License 1.1 | Body text — staff app, client app, PDFs, emails | self-hosted — not an npm package — `web/webdist/fonts/Inter-400-normal.woff2`, `Inter-500-normal.woff2`, `Inter-600-normal.woff2`, `Inter-700-normal.woff2` |
| Fraunces (400, 600, 700) | woff2, self-hosted | SIL Open Font License 1.1 | Headline / figure text — staff app, client app, PDFs, emails | self-hosted — not an npm package — `web/webdist/fonts/Fraunces-400-normal.woff2`, `Fraunces-600-normal.woff2`, `Fraunces-700-normal.woff2` |
