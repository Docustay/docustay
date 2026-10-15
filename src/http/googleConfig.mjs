// src/http/googleConfig.mjs — Launch step 2: what the sign-in pages are told about "Continue with Google". The button exists only when this deployment names a Google web OAuth client (the one Firebase's Google provider uses);
// the client id is public by design (it is in the page that draws Google's button), the client secret never comes near this code.
export const googleSignInConfig = (env = process.env) => {
  const clientId = String(env.DOCUSTAY_GOOGLE_SIGNIN_CLIENT_ID ?? "").trim();
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(clientId) ? { google: { clientId } } : {};
};
