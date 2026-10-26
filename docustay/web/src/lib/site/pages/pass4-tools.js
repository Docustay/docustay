// pass 4 (13 Oct 2026): "how it works" sections for the three free tools. Each fact is from the tool's own code (src/lib/site/tools/*): pdf-lib in the browser, the 150 MB ceiling, the Helvetica text font, the three signature faces, the transparent PNG trimmed to the ink.
export const ADD4_TOOLS = {
  "/tools/sign-pdf": [
    { t: "cols", eyebrow: "What it can place", h2: "Five kinds of mark, on any page.", sub: "Everything is drawn onto a copy. Your original file is never changed.", cols: [
      { h: "Signature and initials", p: "Make a signature by drawing, typing or uploading a picture, then click the page where it goes. Initials are made from your name, up to three letters, and placed the same way. {{F-SIGNTOOL}}" },
      { h: "A date and free text", p: "Add today's date or any text. Text is written in Helvetica, and a character that font cannot write is replaced by a question mark, with a note telling you so. {{F-SIGNTOOL}}" },
      { h: "A check mark", p: "Click where a box is and a check is drawn there. Drag any mark to move it, and it follows the page's own rotation, so a sideways scan still lands where you clicked. {{F-SIGNTOOL}}" },
    ] },
    { t: "cols", eyebrow: "Where the work happens", h2: "In this page, and nowhere else.", sub: "No server sees your file, because no server is involved.", cols: [
      { h: "Written in your browser", p: "The marks are written into a copy of the PDF with an MIT-licensed library running in this page. No request carries the file, and nothing is stored. {{F-SIGNTOOL}}" },
      { h: "Large files are fine", p: "A file up to 150 MB opens. It stays on your device the whole time, so the limit is your browser's memory and not an upload. {{F-SIGNTOOL}}" },
      { h: "Only PDF files", p: "Docustay only accepts PDF files, here and when sending. A scan works too: it is a picture of a page, and you place your signature on top of it like any other page. {{F-UPLOAD}}" },
    ] },
    { t: "cols", eyebrow: "What it is not", h2: "A picture of a signature is not a signed record.", sub: "That is why the tool and sending are two different things.", cols: [
      { h: "Not sealed", p: "The copy you download carries a picture of your signature. It is not sealed with a digital signature and it records nothing about who signed or when. {{F-SIGNTOOL}}" },
      { h: "When it is enough", p: "It is fine for a form that only needs your name on it, such as a permission slip or a form you email back. For anything where others must sign, use sending. {{F-SEND}}" },
      { h: "When it is not", p: "Send the document with Docustay when you need each person's signature, the time and address of each act, a certificate of completion and a sealed copy. {{F-CERT}}" },
    ] },
  ],
  "/tools/fill-pdf": [
    { t: "cols", eyebrow: "Two ways to fill", h2: "Into the form's own fields, or onto the page.", sub: "The tool reads the PDF first and shows you which kind you have.", cols: [
      { h: "A PDF with form fields", p: "If the file has its own fields, the tool finds them and shows each one where it sits. Text boxes take typing, check boxes toggle, and drop-downs, lists and radio buttons take a choice. {{F-FILLTOOL}}" },
      { h: "A PDF without fields", p: "Choose Text, Check or Date and click the page where it goes. This works on any PDF, including a scan, because nothing depends on the file having fields. {{F-FILLTOOL}}" },
      { h: "A field that cannot be written", p: "If one field cannot be filled in, the tool says which one and why, and carries on with the rest, so one stubborn field does not lose your other answers. {{F-FILLTOOL}}" },
    ] },
    { t: "cols", eyebrow: "The copy you download", h2: "Editable or flat, your choice.", sub: "A single switch decides what the filled file looks like.", cols: [
      { h: "Make the fields non-editable", p: "With the option on, which is the default, your answers become plain page content and the form fields can no longer be changed in the copy. Turn it off to keep them editable. {{F-FILLTOOL}}" },
      { h: "Your original stays as it was", p: "The tool writes a new PDF. The file you chose is never changed, so you can always go back to it and start again. {{F-FILLTOOL}}" },
      { h: "Nothing leaves your device", p: "The file is opened, edited and written in this page. Nothing is uploaded and nothing is stored, and a file up to 150 MB opens. {{F-FILLTOOL}}" },
    ] },
    { t: "cols", eyebrow: "After you fill it in", h2: "Filling is not signing.", sub: "If the next step is a signature, use the right tool for it.", cols: [
      { h: "Add your own signature", p: "To put your signature on the filled copy, use the sign a PDF tool, which places a picture of it on any page. {{F-SIGNTOOL}}" },
      { h: "Collect other people's", p: "To collect signatures from other people, send the document with Docustay. Each person signs on their own device with no account. {{F-SEND}}" },
      { h: "Keep a sealed record", p: "A document sent with Docustay ends with a certificate of completion and a seal over the whole file, which this tool does not add. {{F-SEAL}}" },
    ] },
  ],
  "/tools/signature-generator": [
    { t: "cols", eyebrow: "Three ways to make one", h2: "Draw it, type it or upload it.", sub: "Pick whichever feels most like your own hand.", cols: [
      { h: "Draw", p: "Use a finger, a pen or a mouse on the paper canvas. Choose a line weight, and black or blue ink, and clear the canvas to start again. {{F-SIGNTOOL}}" },
      { h: "Type", p: "Type your name and choose one of three handwriting styles: Caveat, Dancing Script or Reenie Beanie. The name is drawn as large as fits the canvas. {{F-SIGNTOOL}}" },
      { h: "Upload", p: "Upload a photo or a scan of a signature you already have. It is fitted to the canvas and stays in your browser; nothing is sent anywhere. {{F-SIGNTOOL}}" },
    ] },
    { t: "cols", eyebrow: "What you download", h2: "A transparent PNG, trimmed to the ink.", sub: "Ready to drop onto any document.", cols: [
      { h: "No background", p: "The image is transparent wherever there is no ink, so it sits on a page without a white box around it. {{F-SIGNTOOL}}" },
      { h: "Trimmed with a margin", p: "The empty space around the signature is cut away, leaving a small margin of 10 pixels on every side, so it is easy to place and resize. {{F-SIGNTOOL}}" },
      { h: "Yours to use anywhere", p: "It is a normal image file. Put it into a word processor, a PDF editor or the sign a PDF tool, or keep it for next time. {{F-SIGNTOOL}}" },
    ] },
    { t: "cols", eyebrow: "What to know", h2: "A picture of a signature, not a signed document.", sub: "It looks like your signature. It does not record that you signed.", cols: [
      { h: "No record of who signed", p: "An image on its own says nothing about who placed it or when. A signed Docustay document records each person, the time and address of each act, and a hash of the file. {{F-CERT}}" },
      { h: "Kept private", p: "The signature is made in this page and is never uploaded or stored. Close the tab and it is gone unless you downloaded it. {{F-SIGNTOOL}}" },
      { h: "Use it with a PDF", p: "To put it on a PDF, open the sign a PDF tool, make or paste your signature there and click the page where it goes. {{F-SIGNTOOL}}" },
    ] },
  ],
};
