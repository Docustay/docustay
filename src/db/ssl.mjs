// src/db/ssl.mjs — the ONE place a database connection decides about TLS. Hosted (Railway) Postgres is reached over TLS with its own certificate, so verification is off and TLS is on (unchanged).
// A self-hosted install whose Postgres sits next to the app on a private network can set KEYSTONE_DB_SSL=off. Unset = exactly what every connection did before.
export const dbSsl = () => (process.env.KEYSTONE_DB_SSL === "off" ? false : { rejectUnauthorized: false });
