// Helpers for writing a starter template as HTML with text tags (Part 31 item 4). Pure, no imports: the site build and the island both read the same files.
// A tag is {{Name;type=...;role=...;label=...}} (docs: templates-and-text-tags). The first role written becomes signer_1, the next signer_2.
const clean = (s) => String(s).replace(/[;{}=]/g, "");
export const sig = (role, label) => `{{${clean(label ?? `${role} signature`)};type=signature;role=${clean(role)}}}`;
export const initials = (role, label) => `{{${clean(label ?? `${role} initials`)};type=initials;role=${clean(role)}}}`;
export const signedOn = (role) => `{{${clean(role)} date signed;type=date_signed;role=${clean(role)}}}`;
export const text = (role, name, label) => `{{${clean(name)};type=text;role=${clean(role)};label=${clean(label ?? name)}}}`;
export const area = (role, name, label) => `{{${clean(name)};type=text;role=${clean(role)};label=${clean(label ?? name)};width=420;height=54}}`;
export const date = (role, name, label) => `{{${clean(name)};type=date;role=${clean(role)};label=${clean(label ?? name)}}}`;
export const number = (role, name, label) => `{{${clean(name)};type=number;role=${clean(role)};label=${clean(label ?? name)}}}`;
export const email = (role, name, label) => `{{${clean(name)};type=email;role=${clean(role)};label=${clean(label ?? name)}}}`;
export const phone = (role, name, label) => `{{${clean(name)};type=phone;role=${clean(role)};label=${clean(label ?? name)}}}`;
export const check = (role, name, label) => `{{${clean(name)};type=checkbox;role=${clean(role)};label=${clean(label ?? name)}}}`;
/** A checkbox WITH its sentence printed beside it (the signer must see what they are ticking; the label alone lives only in the field's hidden name). Use this wherever the surrounding text does not already say it. */
export const checkText = (role, name, label) => `${check(role, name, label)}&nbsp; ${label ?? name}`;
export const pick = (role, name, options, label) => `{{${clean(name)};type=dropdown;role=${clean(role)};options=${options.map(clean).join(",")};label=${clean(label ?? name)}}}`;
export const optional = (tag) => tag.replace(/}}$/, ";required=false}}");
// Docustay v1 item 10: the amount is one the sender sets before sending (a custom value of this send, e.g. custom.deposit), never typed by the signer and never a formula.
export const pay = (role, name, key) => `{{${clean(name)};type=payment;role=${clean(role)};amount=custom.${clean(key)};currency=usd}}`;

/** The fifty US states, for a governing-law dropdown (a dropdown takes at most fifty options). */
export const STATES = Object.freeze(["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"]);
export const YESNO = Object.freeze(["Yes", "No"]);
