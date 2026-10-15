// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE DOCUMENTS ISLAND'S FRONT DOOR (ISLAND-PROGRAMS.md §2 "FE", 2 Oct 2026).
//
// ★★★ NON-ISLAND CODE IMPORTS DOCUMENTS ONLY FROM HERE. Not `@/lib/screens/documents/*`, not
//     `@/lib/portal/DocumentSigning.jsx`, not `@/lib/record/PersonDocumentsTab.jsx`, and not a raw
//     `/api/list/documents/...` path. This file re-exports ONLY what the rest of the app legitimately
//     needs from Documents. Anything not listed here is the island's own business.
//
//   The island's own files may import only: @/lib/components/ui|kit|editor|forms|empty|lists,
//   @/lib/format.js, @/lib/idempotency.js, @/lib/hooks/*, @/lib/permissions/rank.js, @/lib/api.js
//   (core request/ApiError), @/lib/terminology/*, @/lib/phone/*, @keystone/documents/*, other island
//   files, and `./ports.js` — the one place the island calls OUT (people, plans, programs, uploads).
//
//   Registry-style references (the route table's `S("documents", …)` / `F("lib/screens/documents/…")`
//   strings in lib/app/routes.js, sectionPages.js, surfaceRegistry.js and gate-entry.js) name screens
//   by string, not by import, and are not routed through here yet.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { api } from "@/lib/api.js";

// The person record's Documents tab (PersonRecord).
export { default as PersonDocumentsTab } from "@/lib/record/PersonDocumentsTab.jsx";

// Public pages for uploaded documents: the recipient's signing page (/sign/pdf) and the certificate's verify page (/verify/<ref>) — QUEUE §23.4, §23.5.1.
export { default as SignPdfPage } from "@/lib/screens/documents/SignPdfPage.jsx";
export { default as VerifyDocPage } from "@/lib/screens/documents/VerifyDocPage.jsx";
export { default as ToolSignPdfPage } from "@/lib/screens/documents/ToolSignPdfPage.jsx";      // the free "sign a PDF online" page (/tools/sign-pdf) — §23.5.14
export { default as SignatureMakerPage } from "@/lib/screens/documents/SignatureMakerPage.jsx";    // the free signature maker (/tools/signature-maker) — §23.5.15
export { default as SelfServePage } from "@/lib/screens/documents/SelfServePage.jsx";   // the public link a practice puts on its website (/s/<slug>) — §23.5.7

// The client app's signing surfaces (ClientApp / ClientSurfaces).
export { default as DocumentSigning } from "@/lib/portal/DocumentSigning.jsx";
export { default as PortalDocuments } from "@/lib/portal/PortalDocuments.jsx";

/**
 * The template picker's data: the practice's agreement (contract) templates, `{ rows: [{ id, name, active, … }] }`.
 * Items (service editor, attach-an-agreement modal) and People (new-person form) offer these as "put an
 * agreement on it" choices; they call this instead of naming a Documents list path.
 */
export const listAgreementTemplates = () => api.listAgreementTemplates();
