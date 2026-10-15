// ★★★ THE PRODUCT IS **PLATFORM**. "Keystone" IS THE REPOSITORY AND THE POSTGRES SCHEMA, AND IT IS
//     NEVER A WORD A CUSTOMER READS.
//
// ★★ WHY THIS IS ITS OWN FILE AND NOT A CONSTANT IN Login.jsx. The auth screens now exist in TWO
//    stacks — the SvelteKit screens in `authui/` that customers actually see, and the React
//    `Login.jsx` shim that redirects to them. A name defined in the JSX file cannot be imported by
//    the Svelte app (Vite there has no JSX loader), so keeping it there would have forced a second
//    literal. Two spellings of one product name is the same defect class as two nav label tables
//    and two token stores — it drifts, and the drift shows up on the first page a customer sees.
//  ★ A PLAIN .js FILE, deliberately: importable from JSX, from Svelte, and from a Node gate with no
//    build step in between.
//
// ★ [MEASURED 2026-09-15] before this, the deployed sign-in screen said "Sign in to Keystone", the
//   signup screen said "Create your Keystone workspace", and the browser TAB said "Keystone" — the
//   internal codename on every page a customer ever opened.
//   Asserted by `db/gates/ms18_no_codename_on_screen.mjs`, which mounts both screens and reads the
//   rendered text rather than grepping source (the comments say "Keystone" correctly, and always
//   will).
export const PRODUCT_NAME = "Workbench";

/** One line under the product's own name, used when no tenant owns the screen. */
export const PRODUCT_TAGLINE =
  "The practice management system for appointment-based care.";
