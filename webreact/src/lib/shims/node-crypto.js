// The browser's own Web Crypto, under the name the shared server modules import (src/http/errors.mjs:1).
// ★ can.js imports the server's pure `authoriseSection` (src/nav/authorise.mjs) so the UI asks the SAME
//   section question the write dispatcher asks; that module pulls in errors.mjs, which imports
//   `randomUUID` from node:crypto. Aliased in vite.config.js and db/gates/fixtures/mountReact.mjs.
export const randomUUID = () => globalThis.crypto.randomUUID();
export default { randomUUID };
