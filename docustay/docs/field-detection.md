---
title: Field detection
description: Press Find fields on a PDF and have the signature, date, initials, text and tick-box fields found for you, with the right people on each.
order: 4
---

# Field detection

Uploading never places boxes by itself. Only exact sources appear on their own: the form fields already inside the PDF, text tags, a template, or a form you have sent before. For anything else, press **Find fields** in the editor and Docustay looks at the page the way a person would and places the boxes it would draw by hand: signature lines, "Date:" blanks, initials, text lines, empty boxes and table cells, tick boxes, and highlighted "sign here" bars. It reads the words beside each blank (in English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Russian, Turkish, Japanese, Korean, Chinese and Arabic), works out which person each box belongs to ("Participant", "Witness", "Case Manager", "Landlord"…), and says how sure it is of each one.

Nothing is placed until you accept it. In the editor the boxes appear dashed in each person's colour, with a line such as "Found 14 fields, 3 signers; 2 not sure about". **Accept all**, or fix them one at a time. A form you have sent before comes back with the boxes you finally placed.

A scanned PDF page has no text, so it is read by character recognition on the server (English). A page in another script is read by shape alone.

Detection by the program is free. The optional **Find fields with AI** button (shown only where AI is turned on) hands the pages to the model in the background, one page at a time in parallel, with a progress line such as "Finding fields 3 of 12 pages". The model is shown each page and a numbered list of the boxes the program drew, and it only picks numbers and says what each one is and whose it is: it never draws a box of its own, so nothing can land off the page. It costs 0.25 credit a page, at most 20 pages a file and a dollar cap per file; if the AI is unavailable the program's own result stays and a plain message says so. Nothing is placed until you accept it.

## How it decides

Each blank is judged by the words printed beside it and the shape it makes on the page. A line next to "Signature", "Initials", "Date", "Email" or "Phone" becomes that kind of field. A line with no useful label becomes a plain text field. Words like "Landlord", "Witness" or "Parent or guardian" next to a blank decide which person it belongs to, and "Borrower signature" makes a new role called Borrower.

The program marks a box "not sure" when the label and the shape disagree, when two readings fit, or when a blank sits in dense running text. The AI look sees all of them, weak ones included; without it nothing leaves the server. Sensitive blanks (a social security or account number, a date of birth) are marked sensitive: the signing page masks what the signer types and turns off browser autofill for them.

## Over the API

`POST /api/v1/documents/detect-fields` takes a file and stores nothing:

```bash
curl https://app.docustay.app/api/v1/documents/detect-fields \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Content-Type: application/json" \
  -d "{\"fileName\":\"intake.pdf\",\"file\":\"$(base64 -i intake.pdf)\"}"
```

Each field has `type`, `page`, `x`, `y`, `w`, `h` (fractions of the page, origin top left), `confidence` (0 to 1), `source` (`native`, `line`, `text`, `box`, `table`, `checkbox`, `highlight`, `remembered`, `vision`), the printed `label`, the `role` (a seat key from `signers`), `sensitive` (an SSN, a date of birth, an account number) and `group` (tick boxes that answer one question). Fields under `minConfidence` (default 0.6) are marked `uncertain`. `pages` says which pages are forms and which are reference pages; `documents` says how a packet splits.

To make a template and place the sure fields in one call, upload with `fields: "auto"`:

```bash
curl https://app.docustay.app/api/v1/templates/file -H "Idempotency-Key: $(uuidgen)" \
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Content-Type: application/json" \
  -d "{\"name\":\"Intake\",\"fileName\":\"intake.pdf\",\"file\":\"$(base64 -i intake.pdf)\",\"fields\":\"auto\"}"
```

The answer's `detected` says how many fields were found, how many seats, how many it was unsure of and how many were placed. A `documents.template.fields_detected` webhook event is sent with the same numbers.

From the command line: `docustay detect intake.pdf`. From an assistant: the MCP tool `detect_fields`. In Node, `docustay.detectFields({ file, fileName })`; in Python, `client.detect_fields(file, file_name)`.

## What it will not do

Through the API the file goes in the body as base64 and may be as large as your plan's upload limit (25 MB on Free and Pay as you go, 100 MB on Pro and Lifetime). A bigger file is refused with `400` and the code `too_big`, which says the limit.

It does not read ID, card or bank numbers out of a picture, and it never sends a page to the AI unless you pressed Find fields with AI. Files are checked first: scripts, launch actions and embedded files are removed from the copy that is kept, and at most the first 100 pages are read, within a time limit. A file that cannot be read simply has no suggestions.
