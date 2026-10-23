// V1 item 2: Docustay is English only, so a refusal from the server (a plan limit, a budget pause, "email isn't set up") is shown exactly as the server wrote it.
// (Before V1 this file held the server's sentences in 13 languages; the server's words are now the one source, so there is nothing to keep in step.)
/** The refusal as the server wrote it, or null when there is none. `t` and `lang` are kept so existing callers do not change. */
export function serverText(error, t = (s) => s, lang = "en") {   // eslint-disable-line no-unused-vars
  return error?.message ?? null;
}
