// PDF FIELD DETECTION · LABEL WORDS (PDF-FIELD-DETECTION-SPEC §4.5–§4.6). Pure: no imports. Turns the words printed beside a blank into a field type, a signer role and a sensitivity flag, in the product's languages.
// Text is normalised first (NFKC folds Arabic presentation forms back to letters; accents and case are dropped), and a right-to-left label is tried both ways round because a PDF may store it in visual order.

const strip = (s) => String(s ?? "").normalize("NFKC").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const rev = (s) => [...s].reverse().join("");

// Each entry: type, words (substring match on a normalised label), fieldless = true when the label alone is not a blank worth a box.
const TYPES = [
  { type: "initials", w: ["initial here", "initials", "initial", "iniciales", "initiales", "iniziali", "iniciais", "paraaf", "inicjaly", "inicialy", "инициалы", "bas harfler", "イニシャル", "이니셜", "缩写", "姓名首字母", "الاحرف الاولى", "الأحرف الأولى"] },
  { type: "signature", w: ["signature", "sign here", "signed by", "signed", "/s/", "signatory", "firma", "firmado", "signature de", "unterschrift", "unterzeichnet", "firma del", "assinatura", "handtekening", "podpis", "подпись", "imza", "署名", "서명", "签名", "簽名", "التوقيع", "توقيع"] },
  { type: "date_signed", w: ["date signed", "dated", "date", "mm/dd", "dd/mm", "fecha", "datum", "data", "datum", "дата", "tarih", "日付", "날짜", "日期", "التاريخ", "تاريخ", "fecha de"] },
  { type: "email", w: ["e-mail", "email", "correo", "courriel", "почта", "eposta", "e-posta", "メール", "이메일", "邮箱", "电子邮件", "البريد"] },
  { type: "phone", w: ["phone", "telephone", "tel.", "tel:", "mobile", "cell", "telefono", "telefon", "telefone", "teléfono", "телефон", "電話", "전화", "电话", "الهاتف", "هاتف"] },
  { type: "address", w: ["address", "street", "city", "zip", "postal", "direccion", "adresse", "indirizzo", "endereco", "adres", "адрес", "住所", "주소", "地址", "العنوان"] },
  { type: "name", w: ["print name", "printed name", "full name", "participant name", "client name", "name", "nombre", "nom", "nome", "naam", "imie", "имя", "фио", "adi soyadi", "ad soyad", "氏名", "名前", "이름", "姓名", "الاسم", "االسم", "اسم"] },
];
const SENSITIVE = ["ssn", "social security", "social sec", "tax id", "ein", "passport", "driver license", "driver's license", "id number", "account number", "routing", "card number", "credit card", "cvv", "bank account", "numero de seguro", "sozialversicherung", "numero de passeport", "pasaporte", "iban", "dob", "date of birth", "birth date", "fecha de nacimiento", "geburtsdatum"];
const AMOUNT = ["amount", "income", "salary", "fee", "price", "total", "monto", "importe", "betrag", "montant", "wage", "rent", "deposit"];
const CHECK = ["check box", "checkbox", "check only one", "check one", "tick"];

/** Longest-first so "date signed" beats "date" and "initial here" beats "initial". */
function hit(text, words) {
  let best = null;
  for (const w of words) {
    const n = strip(w);
    if (!n) continue;
    const i = text.indexOf(n);
    if (i < 0) continue;
    // a short Latin word must stand alone, so "tel" is not found inside "hotel" and "date" not inside "update"
    if (/^[a-z]{1,5}$/.test(n)) { const before = text[i - 1] ?? " ", after = text[i + n.length] ?? " "; if (/[a-z]/.test(before) || (/[a-z]/.test(after) && !(n === "date" && /^(d|s)/.test(text.slice(i + n.length))))) continue; }
    if (!best || n.length > best.len) best = { len: n.length, at: i };
  }
  return best;
}

/** What is this label asking for? → { type, sensitive, format } or null when it is not a blank's label. */
export function classifyLabel(raw) {
  const a = strip(raw), b = strip(rev(String(raw ?? "")));
  if (!a) return null;
  const both = [a, b];
  const sensitive = both.some((t) => SENSITIVE.some((w) => t.includes(strip(w))));
  let found = null;
  for (const t of both) for (const def of TYPES) {
    const h = hit(t, def.w);
    if (h && (!found || h.len > found.len || (h.len === found.len && TYPES.indexOf(def) < TYPES.indexOf(found.def)))) found = { ...h, def };
  }
  if (found) {
    const type = found.def.type;
    // "first name and middle initial", "Your name (first name, initial, and last name)" name a person, not where to initial
    if (type === "initials" && both.some((t) => /(first|middle|last|full|given)\s+name|name\s*\(|initial,?\s+(and\s+)?last|and\s+(middle\s+)?initial/.test(t))) return { type: "text", sensitive, format: null, kind: "name" };
    // "Date of birth" is a text blank, not the date of signing; "Name" inside "Witness signature name" stays a signature
    if (type === "date_signed" && both.some((t) => /birth|nacimiento|geburt|naissance|nascita|nascimento|dob/.test(t))) return { type: "text", sensitive: true, format: "date" };
    if (type === "signature" && both.some((t) => /print|printed|type|escriba|imprimer/.test(t)) && both.some((t) => /name|nombre|nom\b/.test(t))) return { type: "text", sensitive, format: null };
    if (type === "name") return { type: "text", sensitive, format: null, kind: "name" };
    if (type === "email" || type === "phone" || type === "address") return { type: "text", sensitive, format: type, kind: type };
    return { type, sensitive, format: type === "date_signed" ? "date" : null };
  }
  if (sensitive) return { type: "text", sensitive: true, format: null };
  if (both.some((t) => AMOUNT.some((w) => hit(t, [w])))) return { type: "text", sensitive: false, format: "currency", kind: "amount" };
  if (both.some((t) => CHECK.some((w) => t.includes(strip(w))))) return { type: "checkbox", sensitive: false, format: null };
  return null;
}

// Role words near a blank: the person it belongs to. Order matters: "case manager" before "manager", "witness" before everything it is printed with.
const ROLES = [
  ["witness", ["witness", "testigo", "zeuge", "temoin", "testimone", "testemunha", "getuige", "swiadek", "свидетель", "sahit", "証人", "증인", "见证人", "شاهد"]],
  ["case_manager", ["case manager", "caseworker", "case worker", "counselor", "counsellor", "coach", "therapist", "provider", "clinician", "staff"]],
  ["agency", ["agency representative", "agency", "company representative", "authorized representative", "authorised representative", "representative", "organization", "organisation", "supervisor", "director", "manager"]],
  ["landlord", ["landlord", "lessor", "owner", "arrendador", "propietario", "vermieter", "bailleur", "locatore", "locador", "verhuurder", "wynajmujacy", "арендодатель", "ev sahibi", "貸主", "임대인", "房东", "المؤجر"]],
  ["tenant", ["tenant", "lessee", "renter", "resident", "inquilino", "arrendatario", "mieter", "locataire", "conduttore", "inquilino", "huurder", "najemca", "арендатор", "kiraci", "借主", "임차인", "租客", "المستأجر"]],
  ["employer", ["employer", "empleador", "arbeitgeber", "employeur", "datore di lavoro", "empregador", "werkgever", "pracodawca", "работодатель", "isveren", "雇用主", "고용주", "雇主", "صاحب العمل"]],
  ["employee", ["employee", "empleado", "arbeitnehmer", "employe", "dipendente", "empregado", "werknemer", "pracownik", "сотрудник", "calisan", "従業員", "직원", "员工", "الموظف"]],
  ["guardian", ["parent", "guardian", "padre", "tutor", "eltern", "erziehungsberechtigter", "parent/guardian", "genitore", "responsavel", "ouder", "rodzic", "родитель", "veli", "保護者", "보호자", "家长", "监护人", "ولي الامر", "ولي الأمر"]],
  ["client", ["participant", "client", "customer", "patient", "student", "member", "applicant", "buyer", "cliente", "kunde", "participante", "teilnehmer", "klant", "klient", "клиент", "musteri", "顧客", "고객", "客户", "العميل"]],
];
export const ROLE_LABEL = Object.freeze({ client: "Client", case_manager: "Case manager", agency: "Agency representative", landlord: "Landlord", tenant: "Tenant", employer: "Employer", employee: "Employee", guardian: "Parent or guardian", witness: "Witness" });

const NOT_A_PERSON = /^(print|printed|type|typed|your|full|authorized|authorised|digital|electronic|signed|sign|here|the|and|of|for|by|please|legal|official|original|required|initial|date|name|email|phone|address|signature|first|last|middle|company|business)$/;
/** The role named in a label or the words near it, else null. A word not in the table that stands before "signature" ("Borrower signature") is taken as a role of its own: "custom:Borrower". */
export function roleOf(raw) {
  const texts = [strip(raw), strip(rev(String(raw ?? "")))];
  let best = null;
  for (const [key, words] of ROLES) for (const t of texts) { const h = hit(t, words); if (h && (!best || h.len > best.len)) best = { key, len: h.len }; }
  if (best) return best.key;
  const m = /([A-Za-z][A-Za-z'’-]{2,24})\s+(?:signature|signed|sign)\b/i.exec(String(raw ?? ""));
  if (m && !NOT_A_PERSON.test(m[1].toLowerCase())) return `custom:${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}`;
  return null;
}

/** Words that mark a blank-like page region as running text rather than a label: a sentence is not a label. */
export const looksLikeSentence = (raw) => String(raw ?? "").trim().split(/\s+/).length > 7;
const normalise = strip;
