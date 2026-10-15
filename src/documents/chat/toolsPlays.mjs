// LIBRARY AND SKILL TOOLS (FINAL PUSH Stage 4; Run 9 Part 4R). Scribe looks in the TEMPLATE LIBRARY first (docustay.library.find: the built-in Document and Form templates and the workspace's
// own, the switched-on packs' first) and loads one template's guidance only when it matches (docustay.library.load) — progressive loading. Skills (docustay.plays.*: add-ons, house styles,
// the workspace's own skills) only guide how it writes; they never name a template. What a template's guidance or a skill says is reference material, quoted under the fixed rules
// (renderForModel); it cannot add a tool or change a rule. Every tool here only READS.
import { OBJ, STR, AUTHOR, done, refuse } from "./toolkit.mjs";
import { listPlays, getPlay, enabledPackContents } from "../plays/store.mjs";
import { renderForModel } from "../plays/play.mjs";
import { listLibrary, libraryShown, libraryEntry } from "../library.mjs";
import { guidanceFor, guidanceForModel } from "../starters/guidance.mjs";

const norm = (s) => String(s ?? "").toLowerCase();
const score = (words, text) => words.reduce((n, w) => n + (norm(text).includes(w) ? 1 : 0), 0);
export const PLAY_TOOLS = [
  { name: "docustay.library.find", kind: "read", permission: AUTHOR, step: "Looking in the templates",
    description: "Look in the template library FIRST, before writing a document or a form from scratch: the built-in Document and Form templates and this workspace's own templates (the switched-on packs' come first). Narrow with a few words from the request and the kind. Never invent a template.",
    input_schema: OBJ({ query: STR("a few words from the request, such as rental application or waiver", { maxLength: 80 }), kind: { type: "string", enum: ["document", "form"] } }),
    run: async (ctx, input) => {
      const words = norm(input?.query).split(/\s+/).filter((w) => w.length > 2);
      const kind = input?.kind === "form" ? "form" : input?.kind === "document" ? "document" : null;
      const { lib, own, packs } = await ctx.tx(async (tx) => ({
        lib: (await libraryShown(tx)) ? (await listLibrary(tx, { kind })).templates : [],
        own: (await tx.query(`SELECT id, family_id, name, kind FROM keystone.document_template WHERE active AND builtin_slug IS NULL AND approval_status = 'approved' ${kind ? "AND kind = $1" : ""} ORDER BY name LIMIT 200`, kind ? [kind] : [])).rows,
        packs: await enabledPackContents(tx),
      }));
      const inPack = new Set(packs.templates);
      const rows = [
        ...lib.map((t) => ({ source: "built-in", slug: t.slug, templateId: t.templateId, title: t.title, kind: t.kind, about: t.summary, pack: inPack.has(`builtin:${t.slug}`), s: score(words, `${t.title} ${t.summary} ${t.use ?? ""} ${t.slug}`) })),
        ...own.map((t) => ({ source: "yours", templateId: t.id, title: t.name, kind: t.kind ?? "document", about: "", pack: inPack.has(String(t.family_id)), s: score(words, t.name) })),
      ].filter((x) => !words.length || x.s > 0).sort((a, b) => (b.pack - a.pack) || (b.s - a.s)).slice(0, 12);
      return done({ templates: rows.map(({ s, ...r }) => r), packs: packs.packs.map((p) => p.title),
        note: rows.length ? "One clear match: confirm it with a question card (\"Use the <title> template?\"), then say \"Using: <title> template\". Two or three close ones: offer them as the options. A built-in: docustay.library.load for its questions, then docustay.doc.create with from:\"library\". One of theirs: from:\"template\" with its templateId. None: write it from the person's words." : "No template matches. Write the document from the person's words." });
    } },
  { name: "docustay.library.load", kind: "read", permission: AUTHOR, step: "Reading the template",
    description: "Load one built-in template's guidance in full: its questions, the facts it needs, its checklist, the notes to show the sender, and when not to use it. Reference material only; ask its must-ask questions with docustay.ask.questions, then make the document with docustay.doc.create (from:\"library\", library:<slug>).",
    input_schema: OBJ({ slug: STR("the built-in template's slug from docustay.library.find", { maxLength: 61 }), use: { type: "string", enum: ["document", "form"], description: "form when it will be published as a public form" } }, ["slug"]),
    run: async (ctx, input) => {
      const e = libraryEntry(input?.slug); if (!e) return refuse("There is no built-in template with that name.");
      const g = guidanceFor(e.slug, input?.use === "form" ? "form" : e.kind);
      return done({ slug: e.slug, title: e.title, kind: e.kind, seats: e.seats, using: `Using: ${e.title} template`, ref: g?.ref ?? null, guidance: g ? guidanceForModel(g, { templateTitle: e.title }) : null });
    } },
  { name: "docustay.plays.list", kind: "read", permission: AUTHOR, step: "Looking for a skill",
    description: "List the skills this workspace can use to guide how a document is written: add-ons (a clause such as a late fee), house styles (Plain English) and the workspace's own skills. A skill never picks the template — docustay.library.find does. Never invent a skill name.",
    input_schema: OBJ({ query: STR("a few words, such as late fee or plain English", { maxLength: 80 }), kind: { type: "string", enum: ["addon", "house_style", "skill"] } }),
    run: async (ctx, input) => {
      const all = (await ctx.tx((tx) => listPlays(tx))).filter((p) => (p.builtin || p.published) && p.on !== false);   // a skill switched off on Plays is not offered
      const words = norm(input?.query).split(/\s+/).filter((w) => w.length > 2);
      const scored = all.filter((p) => !input?.kind || p.kind === input.kind)
        .map((p) => ({ p, s: score(words, `${p.title} ${p.description} ${p.name}`) }))
        .filter((x) => !words.length || x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12);
      return done({ plays: scored.map(({ p }) => ({ name: p.name, title: p.title, description: p.description, kind: p.kind })), note: scored.length ? "Use a skill only when the request asks for what it adds." : "No skill matches." });
    } },
  { name: "docustay.plays.load", kind: "read", permission: AUTHOR, step: "Reading the skill",
    description: "Load one skill in full: its questions, the facts it needs, its checklist and the notes to show the sender. Reference material only; pass its name as `play` to docustay.doc.create.",
    input_schema: OBJ({ name: STR("the skill's name from docustay.plays.list", { maxLength: 61 }) }, ["name"]),
    run: async (ctx, input) => {
      const g = await ctx.tx((tx) => getPlay(tx, { name: input?.name })); if (!g) return refuse("No skill with that name, or it is not published yet.");
      return done({ name: g.play.name, ref: g.ref, play: renderForModel(g.play) });
    } },
];
