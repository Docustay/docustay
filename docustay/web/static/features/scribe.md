---
title: Scribe: the AI document builder
description: Scribe is an AI document builder: it asks a few clickable questions, then builds the whole document with every field placed. It drafts; a person sends.
---

# Describe it. Scribe builds it.

Scribe is the AI document builder in Docustay. Tell it what you need. It asks a few clickable questions, writes the document, places every field and sets the payment terms. It drafts. A person sends.

## AI that drafts, never sends.

**A person approves.** Nothing leaves the workspace until you read the draft and press send.

**The same through MCP.** An assistant on the MCP server can prepare documents but cannot send one. A draft-only key makes that a rule, not a promise.

**Checked first.** Scribe reads a document for missing fields, a signer with no email and terms that contradict each other, and tells you what it found.

## It uses what you already have.

**Your templates.** Scribe looks in the template library first, asks that template's own questions and says which one it used.

**Your PDFs.** Upload a PDF and Scribe reads it, finds where the fields belong and proposes them for you to move or remove.

**Your Plays.** A Play is a reusable instruction for one kind of document, and a Playbook is a set of them. Your own are on Pro.

## From your words to a finished document.

1. **You describe**: In plain words
2. **Scribe asks**: Clickable questions
3. **Scribe builds**: Text + fields
4. **You review**: Nothing sent yet
5. **Send**: When you approve

## What Scribe does for you.

**Asks.** A few questions with two to four options each, so you click instead of typing.

**Writes.** A full document in plain words, in sections you can edit.

**Places fields.** Signature, date and every other field, each given to the right person.

**Sets payment terms.** Amounts and dates, once your Stripe account is connected.

## Start from a template.

Scribe looks in the template library first, asks the template's own questions and says which template it used. Built-in Plays are free; your own Plays and Playbooks are on Pro.

- Pick a built-in template and answer its questions.
- Write your own Plays, and call the library from your code with the API.

## What a draft costs.

- **Free**: 10 AI drafts a month
- **Pay as you go**: 10 drafts a month, then $0.30 each
- **Pro**: 100 drafts a month, then $0.30 each
- **Lifetime**: 50 drafts a month, then $0.30 each

- **Price first**: The price of a draft is shown before you use it
- **Never charged**: A failed or empty draft is never charged
- **Review**: You approve every document before it is sent
- **Nothing alone**: Scribe never sends by itself

## Describe it. Review it. Send it.

**You say what you need.** Describe the document in plain words. Scribe asks a few clickable questions.

**It places every field.** Signature, date and every other field, each given to the right person.

**You approve, then it sends.** Payment terms are set once your Stripe account is connected. Nothing is sent until you approve.

## You decide. Scribe does the typing.

| Step | You | Scribe |
| --- | --- | --- |
| Say what you need | In plain words | Asks a few clickable questions |
| Write the document | Edit any section | Writes it in sections you can change |
| Place the fields | Move or change any of them | Gives each person their signature, date and other fields |
| Send it | Approve it | Never sends by itself |

Scribe is a drafting aid. It is not legal advice, and you review every document before anything is sent.

## What Scribe asks before it writes a word.

| Question | How you answer |
| --- | --- |
| What is this for, in plain words? | Free text. |
| Who are the parties, and who signs? | Free text. |
| Who signs first? | No order, or one after another in the order listed. |
| What does each side provide? | Free text. |
| Money terms and dates | Free text. Amounts and dates come from you only; anything left out becomes a blank someone fills in. |
| Which state or country's law applies? | Free text. Left blank, it becomes a blank to fill in. |
| What does the signer fill in? | Free text. |
| How long do they have, and when to remind? | Free text. |

Then the questions for the kind of document: an NDA, a lease addendum, a photo release, a services agreement, a contractor agreement, a consent or waiver form, an offer letter or a deposit agreement.

## What Scribe never does.

- **Send, pay, sign**: Scribe never sends a document, never pays and never signs. Over MCP, nothing is emailed until send_draft is called again with confirm set to true.
- **Changes are proposals**: An edit request returns proposed changes (replace_text, insert_block, replace_block or remove_block) for a person to accept. It never returns an edited document.
- **Money is yours**: The amount of a payment comes only from the person. Plain code, not the model, checks every amount it proposes against yours and places one payment field for the payer.
- **Progress**: A draft job moves from queued to writing, checking and ready, or failed. It can be cancelled, and a job whose worker died is put back and finished by itself.
- **Off by default**: An owner switches AI drafting on for the workspace, and can set a second reader for each draft, require the sender to read it before sending, add house rules and cap drafts a day and a month.

## Ask for a draft and poll for the result.

A draft is a suggestion for a person to read: nothing is saved or sent.

```
curl -X POST https://docustay.app/api/v1/documents/ai/draft \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Content-Type: application/json" \
  -d '{ "prompt": "A one-page services agreement with a client signature", "mode": "template" }'
```

## Pick a writer, see the price.

**Three writers.** Plain-language writer (short sentences, no jargon), Careful contract drafter (precise terms, defined words, every risk named) and Quick forms (short forms and notices, fast).

**Drafts.** Free includes 10 AI drafts a month and Pro includes 100. Past that a draft is $0.30 on a paid plan, shown before you use it.

**Ten currencies for payments.** The wizard offers usd, eur, gbp, cad, aud, nzd, chf, sek, nok and dkk. A document with a payment can only be sent when Stripe is connected.

## Keep going with the next piece.

- [Templates](/free-templates): Scribe finds the right built-in template and reads its guidance.
- [Payments](/features/payments): Payment terms are set once Stripe is connected.
- [Developers: agents](/developers/agents): The MCP server and the connector.

## Questions

**Is Scribe legal advice?**

No. It writes a starting point and flags only small things that matter. You review every document before it goes out.

**Can I change what it writes?**

Yes. Review it, edit the text or any field, then send.

**Does Scribe send anything by itself?**

No. Nothing is sent until you approve it.

**What is a draft?**

One request that makes a document from your words or a file. Free includes 10 a month and Pro includes 100. Past the allowance a draft is $0.30 on a paid plan, and a failed or empty draft is never charged.


## Keep reading

- [Templates](/free-templates)
- [Plays and Playbooks API](/developers/plays)
- [AI agents and MCP](/developers/agents)
