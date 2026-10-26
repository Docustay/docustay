// CONFIRM tools. Each only PREPARES a card for the person (what will happen, in plain words, with a button). The model cannot run the action: it happens when the person presses the button,
// through the route that calls executeCard (confirm.mjs). A tool here that is called returns "the person sees a card"; nothing else.
import { OBJ, STR, ID, EDIT, EDIT_ALL, done, refuse } from "./toolkit.mjs";
import { prepareCard } from "./confirm.mjs";
import { PERSON } from "./toolsDraft.mjs";

const card = (action, step, description, schema, { permission = EDIT } = {}) => ({
  name: `docustay.confirm.${action}`, kind: "confirm", permission, step, description: `${description} It only SHOWS the person a card with a button; nothing happens until they press it, so say "here is the card", never "I sent it".`, input_schema: schema, confirmAction: action,
  run: async (ctx, input) => {
    const r = await prepareCard(ctx, action, input);
    if (r.error) return refuse(r.problems ? `${r.error} ${r.problems.join(" · ")}` : r.error);
    return done({ cardShown: true, title: r.card.title, summary: r.card.summary, note: "The person now sees a card with a button. Tell them what it will do and that nothing happens until they press it." },
      { proposal: { kind: "confirm", action, summary: r.card.title, documentId: r.documentId ?? null, payload: r.payload, card: r.card } });
  },
});

export const CONFIRM_TOOLS = [
  card("send", "Preparing the send", "Prepare the card that sends a finished DRAFT for signature. It first runs the same checks as the Send step and refuses (with the reasons) if the draft cannot be sent. In test mode the send goes only to the person and is stamped TEST.", OBJ({ documentId: ID() })),
  card("remind", "Preparing a reminder", "Prepare the card that emails a reminder to the people who still have to act on a SENT document (or one person, by seat or name).", OBJ({ documentId: ID(), seat: STR("a seat key or a person's name; leave out for everyone waiting") })),
  card("resend", "Preparing the resend", "Prepare the card that re-emails the signing link to one person on a SENT document.", OBJ({ documentId: ID(), seat: STR("a seat key or the person's name") }, ["seat"])),
  card("void", "Preparing the cancel", "Prepare the card that voids (cancels) a SENT document. The card asks for the reason if you do not give one.", OBJ({ documentId: ID(), reason: STR("why it is being voided", { maxLength: 500 }) })),
  card("copy", "Preparing the copy", "Prepare the card that makes a copy of a written document as a new draft (same words, people and choices).", OBJ({ documentId: ID() })),
  card("use_template", "Preparing the draft from the template", "Prepare the card that makes a draft from a saved template for these people. The template's questions must be answered first.", OBJ({ templateId: STR("the template's id"), title: STR("the document's name"), people: { type: "array", items: PERSON, maxItems: 30 }, answers: { type: "object", additionalProperties: { type: "string" } }, test: { type: "boolean" } }, ["templateId", "people"]), { permission: EDIT_ALL }),
  card("bulk_send", "Preparing the list send", "Prepare the card that sends one template to a list of people (up to 50), one document each. Needs a paid plan and a template made from an uploaded file with exactly one person signing. The card shows who will receive it.", OBJ({ templateId: STR("the template's id"), rows: { type: "array", maxItems: 50, items: OBJ({ name: STR("full name"), email: STR("email address") }, ["name", "email"]) } }, ["templateId", "rows"]), { permission: EDIT_ALL }),
  // Run 9 — Scribe actions (Pro, checked on the card's tool and again at the click): several documents reminded from one ticked list, a template made from a document, a document's reminders
  card("remind_many", "Finding who to remind", "Prepare ONE card reminding the people still to sign on SEVERAL documents (\"remind everyone who hasn't signed a lease yet\"): title words, a person, or ids. A tick per document; the person may change the message.", OBJ({ query: STR("title words"), waitingOn: STR("a name"), documentIds: { type: "array", items: { type: "string" }, maxItems: 20 } }), { permission: EDIT_ALL }),
  card("make_template", "Preparing the template", "Prepare the card that saves a document's pages and boxes as a template (no people; nothing sent).", OBJ({ documentId: ID(), name: STR("the template's name", { maxLength: 120 }) })),
  card("set_reminders", "Preparing the reminders", "Prepare the card setting a draft's or sent document's automatic reminders: up to 3 days (1–60) after each person was sent it; [] turns them off.", OBJ({ documentId: ID(), days: { type: "array", items: { type: "integer", minimum: 1, maximum: 60 }, maxItems: 3 } }, ["days"])),
  card("support", "Preparing the message", "Prepare the card that lets the person talk to a person or report a problem. It sends the screen and the ids, plus what they wrote; the document's words only if they tick a box.", OBJ({ kind: { type: "string", enum: ["person", "problem"] }, note: STR("what the person wants to say", { maxLength: 1000 }) }), { permission: null }),
];
