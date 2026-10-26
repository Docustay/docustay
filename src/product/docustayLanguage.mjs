// Docustay v1 is English only: account and billing emails are always in English. Kept as two small functions so their callers stay as they are; they read nothing and never throw.
export async function languageOfUser() { return "en"; }
export async function languageOfEmail() { return "en"; }
