// CREATE and PROPOSE tools. A CREATE tool makes a draft (or a template) and never sends anything: it is reversible, the person can open and change it, and it counts as one AI draft against the workspace's limits.
// A PROPOSE tool makes a suggestion the person accepts or rejects; nothing changes until they accept.
import { OBJ, STR, ID, EDIT, EDIT_ALL, AUTHOR, docIdOf, isId, loadOpen, done, refuse } from "./toolkit.mjs";
import { blocksToSource } from "./blocks.mjs";
import { apiCreateDocument, apiUseTemplate, apiCheckSource } from "../pdfApiV2.mjs";
import { sendBlockersFor } from "../pdfSend.mjs";
import { readyMadeSource, saveSourceTemplate } from "../engine/creation.mjs";
import { rolesOfSource, slugWord } from "../engine/rolesOfSource.mjs";
import { listLibrary } from "../library.mjs";
import { guidanceFor } from "../starters/guidance.mjs";
import { getDocumentSetting } from "../settings.mjs";
import { getPlay } from "../plays/store.mjs";
import { readPeople, playChoice, ACTIONS } from "./people.mjs";
import { flagNotes } from "../plays/play.mjs";


const BLOCK = { type: "object", description: "one block: {type:'heading',text,level?,senderOnly?} · {type:'paragraph',text} · {type:'bullets'|'numbered',items:[text]} · {type:'signature',role,label?} (a signature and date for that role) · {type:'field',fieldType,role,label?} · {type:'payment',role,amount,currency?,label?} (the person who pays enters their card when signing; amount is a plain number such as 180; currency defaults to usd; use only when the person asked for a payment, and also write the payment terms in words) · {type:'rule'} · {type:'pagebreak'}. In any text: **bold**, and {{Role.name}} / {{Role.email}} for a person's own name or email." };
export const PERSON = OBJ({ name: STR("full name"), email: STR("email address; in a test document with no real address use name.test@example.test"), role: STR("the role word in the document, such as Client or Provider; it must match a signature block's role"), action: { type: "string", enum: ACTIONS, description: "what they do; default signer" }, order: { type: "integer", description: "their step when signing in order (1, 2, 3)" } }, ["name"]);
const SEND_CHOICE = {
  subject: STR("the email subject signers see", { maxLength: 200 }), message: STR("the email message signers see", { maxLength: 4000 }),
  expiryDays: { type: "integer", minimum: 0, maximum: 365, description: "days until the request expires; 0 = never" },
  reminderDays: { type: "array", items: { type: "integer", minimum: 1, maximum: 60 }, maxItems: 3, description: "remind after these many days (up to three); [] = no reminders" },
  signingOrder: { type: "string", enum: ["any", "sequential"] }, language: STR("two-letter language of the signing page, such as es"), internalNote: STR("a note only the sender sees", { maxLength: 2000 }),
};
const pickChoice = (i) => { const o = {}; for (const k of ["subject", "message", "expiryDays", "reminderDays", "signingOrder", "language", "internalNote"]) if (i?.[k] !== undefined) o[k] = i[k]; return o; };
async function stateOf(ctx, id) { const { rows: [r] } = await ctx.db.query(`SELECT title, state, is_test FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL`, [id]); return r ?? null; }

export const DRAFT_TOOLS = [
  { name: "docustay.doc.create", kind: "create", permission: EDIT_ALL, step: "Making the document",
    description: `Make a new DRAFT document for the person, with its people and send choices, from a built-in template in the library (find it first with docustay.library.find), a saved template of theirs, or words you write (blocks). It checks the document, and returns the draft's id, the checks and anything that still stops it being sent. It does NOT send. When the draft is ready, call docustay.confirm.send so the person sees the send card. In test mode (the person said "test", or the workspace is in test mode) set test:true: a test goes only to the person and is stamped TEST. Roles: every signature or field block names a role; each person's role must be one of them. When it comes from a template, tell the person which one ("Using: Rental application template").`,
    input_schema: OBJ({
      title: STR("the document's name", { maxLength: 120 }), from: { type: "string", enum: ["library", "template", "blocks"] },
      blocks: { type: "array", items: BLOCK, maxItems: 200 }, library: STR("a built-in template's slug (from docustay.library.find)"), templateId: STR("a saved template's id (from docustay.templates.list)"),
      answers: { type: "object", additionalProperties: { type: "string" }, description: "answers to a template's questions, by question key" },
      people: { type: "array", items: PERSON, maxItems: 30 }, test: { type: "boolean", description: "true for a test document" }, play: STR("the name of a skill this document follows (from docustay.plays.list), so its defaults apply and the document records it", { maxLength: 61 }), ...SEND_CHOICE,
    }, ["title", "from", "people"]),
    run: async (ctx, input) => {
      const test = input?.test === true || (await getDocumentSetting(ctx.db, "test_mode.on").catch(() => false)) === true;
      const { people, errors } = readPeople(input?.people, { test }); if (errors.length || !people.length) return refuse(errors[0] ?? "Add at least one person who signs.");
      const title = String(input?.title ?? "").trim().slice(0, 120) || "Untitled document";
      let pg = null; if (input?.play) { pg = await ctx.tx((tx) => getPlay(tx, { name: input.play })); if (!pg) return refuse("No skill with that name, or it is not published yet."); }
      const choice = { ...playChoice(pg?.play.defaults), ...pickChoice(input) };
      let made, source = null, roles = [], usedTemplate = null;
      if (input.from === "template") {
        if (!isId(input.templateId)) return refuse("Give the template's id (docustay.templates.list shows them).");
        try { made = await ctx.tx((tx) => apiUseTemplate(tx, { tenantId: ctx.tenantId, ownerId: ctx.actorUserId, templateId: input.templateId, title, people, variableValues: input.answers ?? null, sendChoice: choice, send: false, test })); }
        catch (e) { return refuse(String(e?.message ?? "That template could not be used.").slice(0, 300), e); }
      } else {
        if (input.from === "library") {
          const slug = String(input.library ?? ""); const lib = await ctx.tx((tx) => listLibrary(tx, { kind: "document" }));
          const e = lib.templates.find((t) => t.slug === slug); if (!e) return refuse(lib.shown ? "There is no built-in Document template with that name (docustay.library.find lists them)." : "This workspace has hidden the built-in templates (Settings → Templates).");
          try { source = readyMadeSource({ slug }).source; } catch (err) { return refuse(String(err?.message ?? "That template could not be used.")); }
          usedTemplate = { slug, title: e.title, guidance: guidanceFor(slug, "document") };
          if (!pg && usedTemplate.guidance) Object.assign(choice, playChoice(usedTemplate.guidance.guidance.defaults), pickChoice(input));
        }
        else { const b = blocksToSource(input.blocks); if (!b.ok) return refuse(b.errors[0]); source = b.source; }
        roles = rolesOfSource(source);
        const check = apiCheckSource({ source, people, requireSignature: true });
        if (!check.ok) return refuse(`The document would not pass its checks: ${check.errors.slice(0, 3).join("; ")}`);
        try { made = await ctx.tx((tx) => apiCreateDocument(tx, { tenantId: ctx.tenantId, ownerId: ctx.actorUserId, title, source, people, sendChoice: choice, send: false, test })); }
        catch (e) { return refuse(String(e?.message ?? "The document could not be made.").slice(0, 300), e); }
      }
      const ref = pg?.ref ?? usedTemplate?.guidance?.ref ?? null;   // what guided the draft: the skill, else the template's own guidance
      if (ref) await ctx.tx((tx) => tx.query(`UPDATE keystone.document_instance SET play_ref = $2 WHERE id = $1`, [made.id, ref]));
      const notes = pg ? flagNotes(pg.play) : usedTemplate?.guidance ? flagNotes(usedTemplate.guidance.guidance) : [];   // the marked clauses, at most 3, shown on the sender's card only — never put in the document
      const bl = await ctx.tx((tx) => sendBlockersFor(tx, { tenantId: ctx.tenantId, instanceId: made.id })).catch(() => ({ problems: [] }));
      return done({ created: true, documentId: made.id, title, test, people: people.map((p) => ({ name: p.name, email: p.email, role: p.role ?? null, does: p.action })), roles: (made.roles ?? []).map((r) => r.label), stillStopsSending: bl.problems ?? [], link: `/documents/${made.id}/edit?step=prepare`, playNotes: notes.map((n) => n.topic), ...(usedTemplate ? { using: `Using: ${usedTemplate.title} template` } : {}), note: "A draft is made. Nothing has been sent. Call docustay.confirm.send to show the person the send card once stillStopsSending is empty." },
        { proposal: { kind: "created", summary: `Made the draft “${title}”`, documentId: made.id, state: "accepted", card: { title, test, people: people.length, link: `/documents/${made.id}/edit?step=prepare`, ...(usedTemplate ? { using: usedTemplate.title } : {}), ...(notes.length ? { notes } : {}) } } });
    } },
  { name: "docustay.template.create", kind: "create", permission: AUTHOR, step: "Making the template",
    description: "Make a reusable TEMPLATE from words you write (blocks) or from the document that is open (fromOpen:true). Merge text such as {{Client.name}} fills in per person when the template is used. Does not send anything. kind \"document\" (the default) is sent to people the sender names; kind \"form\" is ONE public link many people fill in and sign: give it exactly one role that fills it in (plus, only if asked, one staff role with a decision, a note and a signature), ask for name and email first, and never ask for card or bank numbers, ID numbers, tax forms or medical records. A form is published afterwards on the Forms page.",
    input_schema: OBJ({ name: STR("the template's name", { maxLength: 120 }), kind: { type: "string", enum: ["document", "form"], description: "document (default) or form" }, blocks: { type: "array", items: BLOCK, maxItems: 200 }, fromOpen: { type: "boolean", description: "use the open document's words instead of blocks" } }, ["name"]),
    run: async (ctx, input) => {
      let source;
      if (input?.fromOpen === true) { const d = await loadOpen(ctx); if (!d?.source) return refuse("No written document is open to make a template from."); source = d.source; }
      else { const b = blocksToSource(input?.blocks); if (!b.ok) return refuse(b.errors[0]); source = b.source; }
      const name = String(input?.name ?? "").trim().slice(0, 120); if (!name) return refuse("Give the template a name.");
      const isForm = input?.kind === "form";   // Run 7: Scribe is told the type; a form template opens on the Forms page to publish
      let t; try { t = await ctx.tx((tx) => saveSourceTemplate(tx, { tenantId: ctx.tenantId, actorUserId: ctx.actorUserId, name, source, profile: "typeset", origin: "written", requireSignature: false, kind: isForm ? "form" : "document" })); }
      catch (e) { return refuse(String(e?.message ?? "The template could not be saved.").slice(0, 300), e); }
      const id = t.templateId ?? t.id;
      const link = isForm ? `/forms?new=${id}` : "/templates";
      return done({ created: true, templateId: id, name, kind: isForm ? "form" : "document", link }, { proposal: { kind: "template", summary: isForm ? `Made the form template “${name}”` : `Made the template “${name}”`, state: "accepted", card: { title: name, link, kind: isForm ? "form" : "document" } } });
    } },
  { name: "docustay.doc.propose_people", kind: "proposal", permission: EDIT, step: "Preparing the people", needs: "edit",
    description: "Propose who signs (or approves, views, gets a copy) on a saved DRAFT, their roles and their order. The person sees the new list and accepts or rejects it. Replaces the draft's people with this list.",
    input_schema: OBJ({ documentId: ID(), summary: STR("one plain sentence"), people: { type: "array", items: PERSON, maxItems: 30 }, signingOrder: { type: "string", enum: ["any", "sequential"] } }, ["people"]),
    run: async (ctx, input) => {
      const id = docIdOf(ctx, input); if (!id) return refuse("Which draft? Give its id, or open it first.");
      const s = await stateOf(ctx, id); if (!s) return refuse("That document was not found."); if (s.state !== "draft") return refuse(`That document is ${s.state}, so its people can no longer be changed.`);
      const { people, errors } = readPeople(input?.people, { test: s.is_test === true }); if (errors.length || !people.length) return refuse(errors[0] ?? "Add at least one person.");
      return done({ proposed: true, count: people.length, note: "The person has been shown the new list and will accept or reject it." },
        { proposal: { kind: "people", summary: String(input?.summary || `Set ${people.length} ${people.length === 1 ? "person" : "people"} on “${s.title}”`).slice(0, 300), documentId: id, payload: { people, ...(input.signingOrder ? { signingOrder: input.signingOrder } : {}) }, card: { title: s.title, lines: people.map((p) => ({ label: p.role || p.action, value: `${p.name} <${p.email}>` })) } } });
    } },
  { name: "docustay.doc.propose_details", kind: "proposal", permission: EDIT, step: "Preparing the details", needs: "edit",
    description: "Propose the email subject and message, the expiry, the reminders, the signing order, the signing page's language or a private note on a saved DRAFT. Send only the ones to change. The person accepts or rejects.",
    input_schema: OBJ({ documentId: ID(), summary: STR("one plain sentence"), ...SEND_CHOICE }),
    run: async (ctx, input) => {
      const id = docIdOf(ctx, input); if (!id) return refuse("Which draft? Give its id, or open it first.");
      const s = await stateOf(ctx, id); if (!s) return refuse("That document was not found."); if (s.state !== "draft") return refuse(`That document is ${s.state}, so its details can no longer be changed.`);
      const choice = pickChoice(input); if (!Object.keys(choice).length) return refuse("Nothing to change: give a subject, message, expiry, reminders, order, language or note.");
      const lines = Object.entries(choice).map(([k, v]) => ({ label: k, value: Array.isArray(v) ? (v.length ? `after ${v.join(", ")} days` : "none") : String(v).slice(0, 200) }));
      return done({ proposed: true, changes: lines.map((l) => l.label), note: "The person has been shown these details and will accept or reject them." },
        { proposal: { kind: "details", summary: String(input?.summary || `Change ${lines.map((l) => l.label).join(", ")} on “${s.title}”`).slice(0, 300), documentId: id, payload: { sendChoice: choice }, card: { title: s.title, lines } } });
    } },
];
