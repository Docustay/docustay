// Turns the server's refusal of a setting (the text after the key, e.g. '"practice.name" must not be blank') into the words a person would use under the field.
export function plainReason(f, reason) {
  const r = String(reason ?? "").replace(/^"[^"]*"\s*/, "").trim();
  const label = String(f?.label ?? "value").toLowerCase();
  if (/^must not be blank/i.test(r)) return f?.kind === "phone" ? "Enter a phone number people can call." : `Enter ${/^[aeiou]/.test(label) ? "an" : "a"} ${label}.`;
  const max = r.match(/^must be (\d+) characters or fewer/i);
  if (max) return `Use ${max[1]} characters or fewer.`;
  if (/^must be text/i.test(r)) return "Enter some text.";
  if (/digits, spaces, brackets/i.test(r)) return "Use digits, spaces, brackets, - and + only.";
  if (/7 to 15 digits/i.test(r)) return "Enter a phone number with 7 to 15 digits.";
  const sentence = r.charAt(0).toUpperCase() + r.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
