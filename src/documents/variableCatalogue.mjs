// ═══════════════════════════════════════════════════════
// THE ISLAND'S MERGE-FIELD CATALOGUE — A LIVE REGISTRY (QUEUE §23.3.3). **THE CLOSED SET A TEMPLATE MAY NAME.**
//
// Documents owns FIVE namespaces: `signer.*` (the person signing), `sender.*` (the person who sent it), `org.*` (the organisation), `document.*` (the document itself) and `custom.<key>` (values supplied
// per send by the API or a CSV). Everything else a practice might merge — `person.*`, `booking.*`, `money.*`, `subscription.*`, `workbench.*`, `practice.*` — is a HOST concept: the host REGISTERS those
// namespaces here (`registerVariables`) through the port at start-up, on the server and in the browser, from `src/ports/documentsVariables.mjs`. The island never names them.
//
// ★ THE EXPORTS ARE LIVE ARRAYS, mutated in place by registration, so every importer (the editor's picker, the reach check, `assertVariablesResolvable`) sees the full set once the host has registered
//   and none of them has to change. Registration is idempotent by name.
// ★ NOTHING IS IMPORTED HERE, ON PURPOSE: the browser loads this file; the moment it imports a node dependency the picker's copy comes back (F406, A3.2, A5.1 — the same lesson three times).
// ★ The `read` functions travel with their entries — pure functions over a facts object — so a name and how it resolves can never disagree.
// ═══════════════════════════════════════════════════════

/** Domains in play: the island's own five, then each registered host namespace. Live — grows on registration. */
export const FIELD_DOMAINS = ["signer", "sender", "org", "document", "custom"];

const CORE_VARIABLES = [
  // SIGNER — the person signing this document
  { name: "signer.name", label: "Signer name", sample: "Dana Whitfield", why: "the name of the person this document is for — the party snapshot, then the people directory",
    audience: "client", fallback: "there", domain: "signer", read: (f) => f.signer?.name ?? null },
  { name: "signer.first_name", label: "Signer first name", sample: "Dana", why: "the first word of the signer's name",
    audience: "client", fallback: null, domain: "signer", read: (f) => f.signer?.name?.trim()?.split(/\s+/)[0] ?? null },
  { name: "signer.email", label: "Signer email", sample: "dana@example.com", why: "the signer's email address",
    audience: "client", fallback: null, domain: "signer", read: (f) => f.signer?.email ?? null },
  // SENDER — the person who sent it
  { name: "sender.name", label: "Sender name", sample: "Sam Coach", why: "the name of the person who sent the document",
    audience: "client", fallback: null, domain: "sender", read: (f) => f.sender?.name ?? null },
  { name: "sender.email", label: "Sender email", sample: "sam@example.com", why: "the sender's email address",
    audience: "client", fallback: null, domain: "sender", read: (f) => f.sender?.email ?? null },
  // ORG — the organisation sending
  { name: "org.name", label: "Organisation name", sample: "Bright Path Coaching", why: "the organisation's display name — the brand the signer sees",
    audience: "client", fallback: null, domain: "org", read: (f) => f.org?.name ?? null },
  { name: "org.address", label: "Organisation address", sample: "123 Main St, Oakland, CA", why: "the address line set in Documents → Settings → Signed copy",
    audience: "client", fallback: null, domain: "org", read: (f) => f.org?.address ?? null },
  { name: "org.logo", label: "Organisation logo", sample: "https://example.com/logo.png", why: "the address of the organisation's logo",
    audience: "client", fallback: null, domain: "org", read: (f) => f.org?.logo ?? null },
  // DOCUMENT DOMAIN — client fields
  {
    name: "document.title", label: "Document title", sample: "Coaching Agreement",
    why: "the document's title — document_instance.title",
    audience: "client", fallback: null, domain: "document",
    read: (f) => f.instance?.title ?? null,
  },
  {
    name: "document.date", label: "Date issued", sample: "15 September 2026",
    why: "the moment of send, formatted in the tenant's own timezone — document_instance.sent_at",
    audience: "client", fallback: null, domain: "document",
    read: (f) => f.sentOn ?? null,
  },
  {
    name: "document.version", label: "Document version", sample: "2",
    why: "version number of the document — document_instance.version",
    audience: "client", fallback: null, domain: "document",
    read: (f) => f.instance?.version ?? null,
  },
  {
    name: "document.signer_name", label: "Signer name", sample: "Dana Whitfield",
    why: "name of the person who signed the document — signature.signer_name",
    audience: "client", fallback: null, domain: "document",
    read: (f) => f.instance?.signerName ?? null,
  },
  {
    name: "document.certificate_ref", label: "Certificate reference", sample: "CERT-abc123def456",
    why: "reference code for the document's certificate — document_instance.certificate_ref",
    audience: "client", fallback: null, domain: "document",
    read: (f) => f.instance?.certificateRef ?? null,
  },
];

/** `custom.<key>` — a value the sender supplied for THIS send (API or CSV). Free names, so they are not in the catalogue list; they resolve from `facts.custom`. */
export const CUSTOM_VARIABLE = /^custom\.[a-z][a-z0-9_]*$/;
export const isCustomVariable = (name) => CUSTOM_VARIABLE.test(String(name ?? ""));
export const readCustomVariable = (facts, name) => facts?.custom?.[String(name).slice("custom.".length)] ?? null;

// ── the live registry ───────────────────────────────────────────────────────────────────────
/** Every registered variable (island + host). Live, mutated in place. */
export const VARIABLES = [];
/** The subset that can actually resolve on a real send — what a picker should offer. Live. */
export const RESOLVABLE_VARIABLES = [];
const NEVER_RESOLVES = new Set(["document.certificate_ref"]);   // hard-coded NULL: no certificate reference column exists (F-R2-5)

function rebuildResolvable() {
  RESOLVABLE_VARIABLES.length = 0;
  for (const v of VARIABLES) if (!NEVER_RESOLVES.has(v.name)) RESOLVABLE_VARIABLES.push(v);
}

/**
 * Register a namespace of merge fields (the host calls this once, at start-up). Idempotent by name; `neverResolves` lists names the picker should not offer. Returns the number of NEW entries.
 * @param {Array<{name:string,label:string,sample:string,why:string,audience:string,fallback:string|null,domain:string,read:Function}>} entries
 */
export function registerVariables(entries, { neverResolves = [] } = {}) {
  let added = 0;
  for (const e of entries ?? []) {
    if (VARIABLES.some((v) => v.name === e.name)) continue;
    VARIABLES.push(Object.freeze({ ...e }));
    if (!FIELD_DOMAINS.includes(e.domain)) FIELD_DOMAINS.push(e.domain);
    added += 1;
  }
  for (const n of neverResolves) NEVER_RESOLVES.add(n);
  rebuildResolvable();
  return added;
}
registerVariables(CORE_VARIABLES);

// Return the catalogue for a role (admin sees all; staff sees staff + client fields; client sees client fields).
export function variableCatalogue(role = 'admin') {
  return VARIABLES.filter((field) => {
    if (role === 'admin') return true;
    if (role === 'staff') return field.audience === 'staff' || field.audience === 'client';
    if (role === 'client') return field.audience === 'client';
    return false;
  });
}

/** ★ The subset of the catalogue that can actually resolve on a real send today. This is what a picker should offer; the rest always renders its "[Label — not provided]" fallback. */
export function resolvableVariableCatalogue(role = 'admin') {
  return variableCatalogue(role).filter((v) => !NEVER_RESOLVES.has(v.name));
}
