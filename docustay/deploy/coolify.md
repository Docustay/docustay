# Docustay on Coolify

Coolify runs Docker Compose projects as they are, so Docustay needs no special file.

1. In Coolify: **New resource → Docker Compose → Git repository** (or paste `docustay/docker-compose.yml`).
2. Set the build context to the repository root and the compose file to `docustay/docker-compose.yml`.
3. Under **Environment variables** add what `./init.sh` would have written (see `docs/settings-reference.md`): `KEYSTONE_DB_PASSWORD`, `KEYSTONE_S3_ACCESS_KEY_ID`, `KEYSTONE_S3_SECRET_ACCESS_KEY`, `KEYSTONE_TOKEN_PEPPER`, `KEYSTONE_LOCAL_AUTH_SECRET`, `KEYSTONE_SETUP_TOKEN` (random strings), and `KEYSTONE_PUBLIC_URL` (your domain).
4. Give the **web** service your domain and port 3000; leave every other service without a public address.
5. Deploy, then open `https://your-domain/setup` and use the setup token.
