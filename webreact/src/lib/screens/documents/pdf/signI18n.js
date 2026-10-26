// The signing page's words in English, Spanish, French and German (QUEUE §23.5.6), on i18next / react-i18next as the spec names. The KEY is the English sentence, so English needs no table and a missing
// translation falls back to English. ★ MACHINE-WRITTEN es / fr / de — a native speaker should review before reliance (recorded on the board). The sender's own message and the document are never translated.
import { createInstance } from "i18next";

export const LANGUAGES = ["en", "es", "fr", "de"];

const es = {
  "Pay": "Pagar", "Paid": "Pagado", "Payment": "Pago", "Pay {{amount}}": "Pagar {{amount}}", "Processing…": "Procesando…", "Close": "Cerrar", "The payment did not go through.": "El pago no se realizó.", "Payment could not load. Try again.": "No se pudo cargar el pago. Inténtelo de nuevo.",
  "Loading…": "Cargando…", "This link isn't working": "Este enlace no funciona",
  "That link is not valid. It may have been used already, expired, or been cancelled — ask them for a new one.": "Ese enlace no es válido. Puede que ya se haya usado, haya caducado o se haya cancelado: pida uno nuevo.",
  "Something went wrong loading this. Try reloading the page.": "Algo salió mal al cargar. Intente recargar la página.",
  "{{org}} needs to check it's you.": "{{org}} necesita comprobar que es usted.", "The sender": "El remitente",
  "Enter the code we emailed to {{email}}.": "Introduzca el código que enviamos a {{email}}.", "We'll email a code to {{email}}.": "Le enviaremos un código a {{email}}.",
  "{{org}} gave you an access code for this document. Enter it to open it.": "{{org}} le dio un código de acceso para este documento. Introdúzcalo para abrirlo.",
  "Too many wrong tries. Try again in a few minutes.": "Demasiados intentos fallidos. Inténtelo de nuevo en unos minutos.",
  "Send a new code": "Enviar un código nuevo", "Email me a code": "Enviarme un código por correo", "Code from your email": "Código de su correo", "Access code": "Código de acceso", "6-digit code": "Código de 6 dígitos", "Open the document": "Abrir el documento",
  "We emailed a code to {{to}}. It works for {{minutes}} minutes.": "Enviamos un código a {{to}}. Es válido durante {{minutes}} minutos.", "The code could not be sent.": "No se pudo enviar el código.", "Something went wrong. Try again.": "Algo salió mal. Inténtelo de nuevo.",
  "You've approved it": "Lo ha aprobado", "Thank you": "Gracias", "Details saved": "Datos guardados", "You've signed": "Ha firmado",
  "Thank you — this screen will reset for the next person. ": "Gracias: esta pantalla se reiniciará para la siguiente persona. ",
  "{{name}} will check what you filled in and sign it themselves. ": "{{name}} revisará lo que completó y lo firmará por sí mismo. ", "The signer": "El firmante", "We have noted that you looked at it. ": "Hemos anotado que lo vio. ",
  "Thank you, {{name}}. ": "Gracias, {{name}}. ", "Thank you. ": "Gracias. ", "We'll tell everyone once the last person has signed.": "Avisaremos a todos cuando firme la última persona.", "Everyone has signed — you'll get a copy by email.": "Todos han firmado: recibirá una copia por correo.",
  "Declined": "Rechazado", "The sender has been told. You can close this page.": "Se ha avisado al remitente. Puede cerrar esta página.",
  "Not your turn yet": "Todavía no es su turno", "{{who}} signs first. We'll email you when it's your turn.": "{{who}} firma primero. Le avisaremos por correo cuando sea su turno.", "Someone else": "Otra persona",
  "This is a test. It shows what the signer sees; nothing you do here is recorded.": "Esto es una prueba. Muestra lo que ve el firmante; nada de lo que haga aquí se registra.",
  "Also included — read these with the document": "También se incluye: léalo junto con el documento", "That file could not be opened.": "No se pudo abrir ese archivo.", "The pages could not be loaded.": "No se pudieron cargar las páginas.", "Document pages": "Páginas del documento",
  "{{name}}: please look this over, then approve or reject.": "{{name}}: revise esto y luego apruebe o rechace.", "A note (required if you reject)": "Una nota (obligatoria si rechaza)", "A note (optional)": "Una nota (opcional)", "A note for the sender": "Una nota para el remitente", "Approve": "Aprobar", "Reject": "Rechazar",
  "You are asked only to look at this document.": "Solo se le pide que vea este documento.", "I have viewed this document": "He visto este documento",
  "You are filling in details for {{name}}. They will check them and sign themselves.": "Está completando datos para {{name}}. Los revisará y firmará por sí mismo.", "Save": "Guardar", "Save and finish": "Guardar y terminar", "the signer": "el firmante",
  "{{n}} to fill in": "{{n}} por completar", "All filled in": "Todo completado", "Next field": "Siguiente campo", "Your full name": "Su nombre completo", "I agree to sign electronically": "Acepto firmar electrónicamente", "Finish and sign": "Terminar y firmar", "Save and finish later": "Guardar y terminar más tarde", "Decline": "Rechazar", "Ask for changes": "Pedir cambios",
  "What needs to change? They will see your note.": "¿Qué hay que cambiar? Verán su nota.", "What needs to change": "Qué hay que cambiar", "Send my note": "Enviar mi nota",
  "Why are you declining? (required)": "¿Por qué rechaza? (obligatorio)", "Why are you declining? (optional)": "¿Por qué rechaza? (opcional)", "Reason for declining": "Motivo del rechazo", "Decline this document": "Rechazar este documento",
  "Saved. Use this same link to carry on.": "Guardado. Use este mismo enlace para continuar.", "That could not be saved. Try again.": "No se pudo guardar. Inténtelo de nuevo.", "Saved.": "Guardado.",
  "This is a test — nothing is recorded and you cannot sign.": "Esto es una prueba: no se registra nada y no puede firmar.", "This is a test — nothing is recorded.": "Esto es una prueba: no se registra nada.",
  "Type your full name to sign.": "Escriba su nombre completo para firmar.", "{{n}} field still needs filling in.": "Falta completar {{n}} campo.", "{{n}} fields still need filling in.": "Faltan por completar {{n}} campos.", "Agree to sign electronically first.": "Primero acepte firmar electrónicamente.",
  "Something went wrong sending your signature. Try again.": "Algo salió mal al enviar su firma. Inténtelo de nuevo.", "Please tell them why you are rejecting it.": "Diga por qué lo rechaza.", "Tell them what needs to change.": "Diga qué hay que cambiar.",
  "Sent. They will get your note — you can still sign or decline.": "Enviado. Recibirán su nota; aún puede firmar o rechazar.", "Please tell them why you are declining.": "Diga por qué rechaza.", "That file could not be uploaded.": "No se pudo subir ese archivo.",
  "Date (on signing)": "Fecha (al firmar)", "Sign here": "Firme aquí", "Initial": "Ponga sus iniciales", "Add stamp": "Añadir sello", "Add picture": "Añadir imagen", " (optional)": " (opcional)", "Upload a file": "Subir un archivo", "file added": "archivo añadido", "Pick any": "Elija las que quiera", "Choose…": "Elegir…", "Type here": "Escriba aquí", "Tick": "Marcar",
};
const fr = {
  "Pay": "Payer", "Paid": "Payé", "Payment": "Paiement", "Pay {{amount}}": "Payer {{amount}}", "Processing…": "Traitement…", "Close": "Fermer", "The payment did not go through.": "Le paiement n'a pas abouti.", "Payment could not load. Try again.": "Le paiement n'a pas pu se charger. Réessayez.",
  "Loading…": "Chargement…", "This link isn't working": "Ce lien ne fonctionne pas",
  "That link is not valid. It may have been used already, expired, or been cancelled — ask them for a new one.": "Ce lien n'est pas valide. Il a peut-être déjà été utilisé, il a expiré ou il a été annulé — demandez-en un nouveau.",
  "Something went wrong loading this. Try reloading the page.": "Un problème est survenu au chargement. Essayez de recharger la page.",
  "{{org}} needs to check it's you.": "{{org}} doit vérifier que c'est bien vous.", "The sender": "L'expéditeur",
  "Enter the code we emailed to {{email}}.": "Saisissez le code envoyé à {{email}}.", "We'll email a code to {{email}}.": "Nous enverrons un code à {{email}}.",
  "{{org}} gave you an access code for this document. Enter it to open it.": "{{org}} vous a donné un code d'accès pour ce document. Saisissez-le pour l'ouvrir.",
  "Too many wrong tries. Try again in a few minutes.": "Trop d'essais incorrects. Réessayez dans quelques minutes.",
  "Send a new code": "Envoyer un nouveau code", "Email me a code": "M'envoyer un code par e-mail", "Code from your email": "Code reçu par e-mail", "Access code": "Code d'accès", "6-digit code": "Code à 6 chiffres", "Open the document": "Ouvrir le document",
  "We emailed a code to {{to}}. It works for {{minutes}} minutes.": "Nous avons envoyé un code à {{to}}. Il est valable {{minutes}} minutes.", "The code could not be sent.": "Le code n'a pas pu être envoyé.", "Something went wrong. Try again.": "Un problème est survenu. Réessayez.",
  "You've approved it": "Vous l'avez approuvé", "Thank you": "Merci", "Details saved": "Détails enregistrés", "You've signed": "Vous avez signé",
  "Thank you — this screen will reset for the next person. ": "Merci — cet écran va se réinitialiser pour la personne suivante. ",
  "{{name}} will check what you filled in and sign it themselves. ": "{{name}} vérifiera ce que vous avez renseigné et signera lui-même. ", "The signer": "Le signataire", "We have noted that you looked at it. ": "Nous avons noté que vous l'avez consulté. ",
  "Thank you, {{name}}. ": "Merci, {{name}}. ", "Thank you. ": "Merci. ", "We'll tell everyone once the last person has signed.": "Nous préviendrons tout le monde quand la dernière personne aura signé.", "Everyone has signed — you'll get a copy by email.": "Tout le monde a signé — vous recevrez une copie par e-mail.",
  "Declined": "Refusé", "The sender has been told. You can close this page.": "L'expéditeur a été prévenu. Vous pouvez fermer cette page.",
  "Not your turn yet": "Ce n'est pas encore votre tour", "{{who}} signs first. We'll email you when it's your turn.": "{{who}} signe en premier. Nous vous écrirons quand ce sera votre tour.", "Someone else": "Quelqu'un d'autre",
  "This is a test. It shows what the signer sees; nothing you do here is recorded.": "Ceci est un essai. Il montre ce que voit le signataire ; rien de ce que vous faites ici n'est enregistré.",
  "Also included — read these with the document": "Également inclus — à lire avec le document", "That file could not be opened.": "Ce fichier n'a pas pu être ouvert.", "The pages could not be loaded.": "Les pages n'ont pas pu être chargées.", "Document pages": "Pages du document",
  "{{name}}: please look this over, then approve or reject.": "{{name}} : relisez ceci, puis approuvez ou refusez.", "A note (required if you reject)": "Une note (obligatoire en cas de refus)", "A note (optional)": "Une note (facultative)", "A note for the sender": "Une note pour l'expéditeur", "Approve": "Approuver", "Reject": "Refuser",
  "You are asked only to look at this document.": "On vous demande seulement de consulter ce document.", "I have viewed this document": "J'ai consulté ce document",
  "You are filling in details for {{name}}. They will check them and sign themselves.": "Vous renseignez des détails pour {{name}}. Cette personne les vérifiera et signera elle-même.", "Save": "Enregistrer", "Save and finish": "Enregistrer et terminer", "the signer": "le signataire",
  "{{n}} to fill in": "{{n}} à renseigner", "All filled in": "Tout est renseigné", "Next field": "Champ suivant", "Your full name": "Votre nom complet", "I agree to sign electronically": "J'accepte de signer électroniquement", "Finish and sign": "Terminer et signer", "Save and finish later": "Enregistrer et terminer plus tard", "Decline": "Refuser", "Ask for changes": "Demander des modifications",
  "What needs to change? They will see your note.": "Que faut-il changer ? Ils verront votre note.", "What needs to change": "Ce qu'il faut changer", "Send my note": "Envoyer ma note",
  "Why are you declining? (required)": "Pourquoi refusez-vous ? (obligatoire)", "Why are you declining? (optional)": "Pourquoi refusez-vous ? (facultatif)", "Reason for declining": "Motif du refus", "Decline this document": "Refuser ce document",
  "Saved. Use this same link to carry on.": "Enregistré. Utilisez ce même lien pour continuer.", "That could not be saved. Try again.": "L'enregistrement a échoué. Réessayez.", "Saved.": "Enregistré.",
  "This is a test — nothing is recorded and you cannot sign.": "Ceci est un essai — rien n'est enregistré et vous ne pouvez pas signer.", "This is a test — nothing is recorded.": "Ceci est un essai — rien n'est enregistré.",
  "Type your full name to sign.": "Saisissez votre nom complet pour signer.", "{{n}} field still needs filling in.": "{{n}} champ reste à renseigner.", "{{n}} fields still need filling in.": "{{n}} champs restent à renseigner.", "Agree to sign electronically first.": "Acceptez d'abord de signer électroniquement.",
  "Something went wrong sending your signature. Try again.": "Un problème est survenu à l'envoi de votre signature. Réessayez.", "Please tell them why you are rejecting it.": "Dites-leur pourquoi vous le refusez.", "Tell them what needs to change.": "Dites-leur ce qu'il faut changer.",
  "Sent. They will get your note — you can still sign or decline.": "Envoyé. Ils recevront votre note — vous pouvez encore signer ou refuser.", "Please tell them why you are declining.": "Dites-leur pourquoi vous refusez.", "That file could not be uploaded.": "Ce fichier n'a pas pu être envoyé.",
  "Date (on signing)": "Date (à la signature)", "Sign here": "Signez ici", "Initial": "Vos initiales", "Add stamp": "Ajouter un tampon", "Add picture": "Ajouter une image", " (optional)": " (facultatif)", "Upload a file": "Envoyer un fichier", "file added": "fichier ajouté", "Pick any": "Choisissez-en", "Choose…": "Choisir…", "Type here": "Saisissez ici", "Tick": "Cocher",
};
const de = {
  "Pay": "Zahlen", "Paid": "Bezahlt", "Payment": "Zahlung", "Pay {{amount}}": "{{amount}} zahlen", "Processing…": "Wird verarbeitet…", "Close": "Schließen", "The payment did not go through.": "Die Zahlung ist nicht durchgegangen.", "Payment could not load. Try again.": "Die Zahlung konnte nicht geladen werden. Versuchen Sie es erneut.",
  "Loading…": "Wird geladen…", "This link isn't working": "Dieser Link funktioniert nicht",
  "That link is not valid. It may have been used already, expired, or been cancelled — ask them for a new one.": "Dieser Link ist ungültig. Er wurde vielleicht schon verwendet, ist abgelaufen oder wurde zurückgezogen — bitten Sie um einen neuen.",
  "Something went wrong loading this. Try reloading the page.": "Beim Laden ist etwas schiefgegangen. Laden Sie die Seite neu.",
  "{{org}} needs to check it's you.": "{{org}} muss prüfen, dass Sie es sind.", "The sender": "Der Absender",
  "Enter the code we emailed to {{email}}.": "Geben Sie den Code ein, den wir an {{email}} gesendet haben.", "We'll email a code to {{email}}.": "Wir senden einen Code an {{email}}.",
  "{{org}} gave you an access code for this document. Enter it to open it.": "{{org}} hat Ihnen einen Zugangscode für dieses Dokument gegeben. Geben Sie ihn ein, um es zu öffnen.",
  "Too many wrong tries. Try again in a few minutes.": "Zu viele falsche Versuche. Versuchen Sie es in einigen Minuten erneut.",
  "Send a new code": "Neuen Code senden", "Email me a code": "Code per E-Mail senden", "Code from your email": "Code aus Ihrer E-Mail", "Access code": "Zugangscode", "6-digit code": "6-stelliger Code", "Open the document": "Dokument öffnen",
  "We emailed a code to {{to}}. It works for {{minutes}} minutes.": "Wir haben einen Code an {{to}} gesendet. Er gilt {{minutes}} Minuten.", "The code could not be sent.": "Der Code konnte nicht gesendet werden.", "Something went wrong. Try again.": "Etwas ist schiefgegangen. Versuchen Sie es erneut.",
  "You've approved it": "Sie haben es genehmigt", "Thank you": "Vielen Dank", "Details saved": "Angaben gespeichert", "You've signed": "Sie haben unterschrieben",
  "Thank you — this screen will reset for the next person. ": "Vielen Dank — dieser Bildschirm wird für die nächste Person zurückgesetzt. ",
  "{{name}} will check what you filled in and sign it themselves. ": "{{name}} prüft Ihre Angaben und unterschreibt selbst. ", "The signer": "Die unterschreibende Person", "We have noted that you looked at it. ": "Wir haben vermerkt, dass Sie es angesehen haben. ",
  "Thank you, {{name}}. ": "Vielen Dank, {{name}}. ", "Thank you. ": "Vielen Dank. ", "We'll tell everyone once the last person has signed.": "Wir informieren alle, sobald die letzte Person unterschrieben hat.", "Everyone has signed — you'll get a copy by email.": "Alle haben unterschrieben — Sie erhalten eine Kopie per E-Mail.",
  "Declined": "Abgelehnt", "The sender has been told. You can close this page.": "Der Absender wurde informiert. Sie können diese Seite schließen.",
  "Not your turn yet": "Sie sind noch nicht an der Reihe", "{{who}} signs first. We'll email you when it's your turn.": "{{who}} unterschreibt zuerst. Wir schreiben Ihnen, wenn Sie an der Reihe sind.", "Someone else": "Jemand anderes",
  "This is a test. It shows what the signer sees; nothing you do here is recorded.": "Dies ist ein Test. Er zeigt, was die unterschreibende Person sieht; nichts, was Sie hier tun, wird aufgezeichnet.",
  "Also included — read these with the document": "Ebenfalls enthalten — bitte zusammen mit dem Dokument lesen", "That file could not be opened.": "Diese Datei konnte nicht geöffnet werden.", "The pages could not be loaded.": "Die Seiten konnten nicht geladen werden.", "Document pages": "Dokumentseiten",
  "{{name}}: please look this over, then approve or reject.": "{{name}}: Bitte sehen Sie sich dies an und genehmigen oder lehnen Sie ab.", "A note (required if you reject)": "Eine Notiz (bei Ablehnung erforderlich)", "A note (optional)": "Eine Notiz (optional)", "A note for the sender": "Eine Notiz für den Absender", "Approve": "Genehmigen", "Reject": "Ablehnen",
  "You are asked only to look at this document.": "Sie sollen dieses Dokument nur ansehen.", "I have viewed this document": "Ich habe dieses Dokument angesehen",
  "You are filling in details for {{name}}. They will check them and sign themselves.": "Sie füllen Angaben für {{name}} aus. Diese Person prüft sie und unterschreibt selbst.", "Save": "Speichern", "Save and finish": "Speichern und abschließen", "the signer": "die unterschreibende Person",
  "{{n}} to fill in": "{{n}} auszufüllen", "All filled in": "Alles ausgefüllt", "Next field": "Nächstes Feld", "Your full name": "Ihr vollständiger Name", "I agree to sign electronically": "Ich stimme der elektronischen Unterschrift zu", "Finish and sign": "Abschließen und unterschreiben", "Save and finish later": "Speichern und später fortfahren", "Decline": "Ablehnen", "Ask for changes": "Änderungen anfragen",
  "What needs to change? They will see your note.": "Was muss geändert werden? Sie sehen Ihre Notiz.", "What needs to change": "Was geändert werden muss", "Send my note": "Meine Notiz senden",
  "Why are you declining? (required)": "Warum lehnen Sie ab? (erforderlich)", "Why are you declining? (optional)": "Warum lehnen Sie ab? (optional)", "Reason for declining": "Grund der Ablehnung", "Decline this document": "Dieses Dokument ablehnen",
  "Saved. Use this same link to carry on.": "Gespeichert. Mit demselben Link können Sie fortfahren.", "That could not be saved. Try again.": "Das konnte nicht gespeichert werden. Versuchen Sie es erneut.", "Saved.": "Gespeichert.",
  "This is a test — nothing is recorded and you cannot sign.": "Dies ist ein Test — nichts wird aufgezeichnet und Sie können nicht unterschreiben.", "This is a test — nothing is recorded.": "Dies ist ein Test — nichts wird aufgezeichnet.",
  "Type your full name to sign.": "Geben Sie zum Unterschreiben Ihren vollständigen Namen ein.", "{{n}} field still needs filling in.": "{{n}} Feld muss noch ausgefüllt werden.", "{{n}} fields still need filling in.": "{{n}} Felder müssen noch ausgefüllt werden.", "Agree to sign electronically first.": "Stimmen Sie zuerst der elektronischen Unterschrift zu.",
  "Something went wrong sending your signature. Try again.": "Beim Senden Ihrer Unterschrift ist etwas schiefgegangen. Versuchen Sie es erneut.", "Please tell them why you are rejecting it.": "Bitte teilen Sie mit, warum Sie ablehnen.", "Tell them what needs to change.": "Teilen Sie mit, was geändert werden muss.",
  "Sent. They will get your note — you can still sign or decline.": "Gesendet. Sie erhalten Ihre Notiz — Sie können weiterhin unterschreiben oder ablehnen.", "Please tell them why you are declining.": "Bitte teilen Sie mit, warum Sie ablehnen.", "That file could not be uploaded.": "Diese Datei konnte nicht hochgeladen werden.",
  "Date (on signing)": "Datum (bei Unterschrift)", "Sign here": "Hier unterschreiben", "Initial": "Kürzel setzen", "Add stamp": "Stempel hinzufügen", "Add picture": "Bild hinzufügen", " (optional)": " (optional)", "Upload a file": "Datei hochladen", "file added": "Datei hinzugefügt", "Pick any": "Beliebige wählen", "Choose…": "Auswählen…", "Type here": "Hier eingeben", "Tick": "Ankreuzen",
};

const cache = new Map();
/** A translate function for one language: t("English sentence", { vars }). Unknown language or missing key → the English sentence, with the variables filled in. */
export function makeT(lang) {
  const code = LANGUAGES.includes(lang) ? lang : "en";
  if (!cache.has(code)) {
    const i = createInstance();
    i.init({ lng: code, fallbackLng: false, resources: { es: { translation: es }, fr: { translation: fr }, de: { translation: de } }, keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false }, returnNull: false, initImmediate: false });
    cache.set(code, (k, o) => (code === "en" ? String(k).replace(/\{\{(\w+)\}\}/g, (_, n) => o?.[n] ?? "") : i.t(k, { defaultValue: String(k).replace(/\{\{(\w+)\}\}/g, (_, n) => o?.[n] ?? ""), ...o })));
  }
  return cache.get(code);
}
