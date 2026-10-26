# Single sign-on with OpenID Connect

A self-hosted install can offer **Sign in with your identity provider** next to the password form. It uses the standard OpenID Connect authorization-code flow with PKCE, so it works with any provider that follows the standard.

## What it does and does not do

- It is another way **in** for people who already have an account on this install. It never creates one: someone your provider vouches for, but who has no Docustay account here, is refused. Invite them first.
- It matches by email address, and only when the provider says the address is verified (`email_verified` is true).
- Two-step sign-in rules are unchanged. It only replaces the password step.
- Passwords keep working. Turning single sign-on on does not lock anyone out.

## Set it up

1. At your provider, make a client for Docustay. The sign-in redirect address is your address plus `/api/auth/oidc/callback`, for example `https://sign.example.com/api/auth/oidc/callback`.
2. Put these in `.env` next to the other settings, then recreate the containers:

```ini
# in .env (a file, not a command)
DOCUSTAY_OIDC_ISSUER=https://sso.example.com/realms/main
DOCUSTAY_OIDC_CLIENT_ID=docustay
DOCUSTAY_OIDC_CLIENT_SECRET=<the client secret>
DOCUSTAY_OIDC_LABEL=Example SSO
```

```bash
docker compose up -d --force-recreate app worker web
```

3. Open the sign-in page. A button named after your label appears. The address you set in `KEYSTONE_PUBLIC_URL` must be the one people use, because the provider sends them back to it.

## If it does not work

- Look at the app's log: `docker compose logs app`. Lines that start `oidc:` say why a sign-in was refused, without any secret.
- "No email in the token": your provider keeps the email in its userinfo answer. Docustay asks for it there; make sure the scopes include `email`.
- "The provider does not vouch for the email": turn on email verification at your provider.

## How a sign-in is checked

The sign-in uses the authorization-code flow with PKCE, a state value and a nonce. The identity token is verified for its signature, issuer, audience, nonce and expiry. A short-lived cookie (ten minutes) holds the state between your click and the provider's reply.

## Every setting

| Variable | Needed | What it is |
|---|---|---|
| `DOCUSTAY_OIDC_ISSUER` | yes | the address of your provider, for example `https://sso.example.com/realms/main` |
| `DOCUSTAY_OIDC_CLIENT_ID` | yes | the client id you made for Docustay |
| `DOCUSTAY_OIDC_CLIENT_SECRET` | yes | the client secret; keep it as private as the other secrets in `.env` |
| `DOCUSTAY_OIDC_LABEL` | no | the name on the button (default: your identity provider) |
| `DOCUSTAY_OIDC_SCOPES` | no | default `openid email profile`; it must include `openid` and `email` |

Single sign-on turns on only when the issuer, client id and client secret are all set. It is for self-hosted installs with the built-in identity.

## Before you test

Invite the person first, because an unknown email is refused. Then check that the address in `KEYSTONE_PUBLIC_URL` is the address in your browser's bar, and that the redirect you registered at the provider ends in `/api/auth/oidc/callback`.
