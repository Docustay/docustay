---
title: Single sign-on and hardening for self-hosted Docustay
description: Connect your own OpenID Connect provider, keep the inside private, encrypt what is stored and follow a seven-part hardening list.
---

# Sign in your way. Lock it down.

Connect your own OpenID Connect provider for single sign-on, then follow a short hardening list: private inside, HTTPS in front, encrypted disks and logs you control.

## What it does, and what it does not.

**Another way in.** It signs in people who already have an account on this install. It never creates one, so someone your provider vouches for but who has no account here is refused.

**Matched by email.** It matches by email address, and only when the provider says the address is verified.

**Nobody locked out.** Two-step rules are unchanged, and passwords keep working. Turning single sign-on on does not lock anyone out.

## Four settings and a restart.

At your provider make a client for Docustay with the sign-in redirect address set to your address plus /api/auth/oidc/callback.

```
DOCUSTAY_OIDC_ISSUER=https://sso.example.com/realms/main
DOCUSTAY_OIDC_CLIENT_ID=docustay
DOCUSTAY_OIDC_CLIENT_SECRET=<the client secret>
DOCUSTAY_OIDC_LABEL=Example SSO
```

## Three things people hit first.

| What you see | Why | What to do |
| --- | --- | --- |
| No email in the token | The provider keeps the email in its userinfo answer | Include the email scope |
| Provider does not vouch for the email | email_verified is not true | Turn on email verification at the provider |
| A button does not appear | The settings were not picked up | Recreate app, worker and web, then read the app log for lines that start oidc |

## Five variables, three of them required.

| Variable | Needed | What it is |
| --- | --- | --- |
| DOCUSTAY_OIDC_ISSUER | Yes | The address of your provider, for example a realm on your own identity server |
| DOCUSTAY_OIDC_CLIENT_ID | Yes | The client id you made for Docustay |
| DOCUSTAY_OIDC_CLIENT_SECRET | Yes | The client secret; keep it as private as the other secrets in the settings file |
| DOCUSTAY_OIDC_LABEL | No | The name on the button, by default your identity provider |
| DOCUSTAY_OIDC_SCOPES | No | By default openid email profile; it must include openid and email |

## A standard flow, checked end to end.

The sign-in uses the authorization-code flow with PKCE, a state value and a nonce. The identity token is verified for its signature, issuer, audience, nonce and expiry, and a short-lived cookie holds the state between your click and the provider's reply.

Single sign-on turns on only when the issuer, client id and client secret are all set. It is for self-hosted installs with the built-in identity, and invited people only: an unknown email is refused.

## Seven parts of a hardening list.

**Security settings.** Set the workspace's own security settings, including whether an owner requires two-step sign-in for the whole team.

**Keep the inside private.** Only the web container listens. The database, file store and converter talk on Compose's private network.

**Encrypt what is stored.** Put the volumes on an encrypted disk, keep the master key safe, and encrypt each backup before it leaves the machine.

**Choose your providers.** Your own mail, your own sign-in and, if documents must not leave your servers, no AI key at all.

**Sign-in and sessions.** Offer two-step to everyone, and list or end any session under Settings, Security.

**Logs and monitoring.** Logs leave out email addresses and credentials; send them to a store you control and set an alert address.

## HTTPS in front, one port out.

- **Proxy**: Put HTTPS in front with Caddy, nginx or Traefik
- **Address**: Set the public address to the https address
- **Firewall**: Allow 443, and 80 for the certificate check; nothing else from outside

- **Ports**: Do not publish the database or the file store
- **Telemetry**: Switch the one anonymous ping off if you must
- **Updates**: Do not skip upgrades: release notes say when a fix is about security

## Questions

**Does single sign-on create accounts?**

No. It only signs in people who already have an account on the install, so invite them first.

**Can I use passkeys?**

Yes, once you turn them on with the passkey settings in your environment file.

**Does the install call out to AI?**

Only if you set an AI key. Leave it empty if documents must not leave your servers for drafting.

**Where do I read the whole list?**

In the hardening guide and the single sign-on guide in the documentation.

**Do people need a password if they use single sign-on?**

No, because it replaces the password step, but passwords keep working for anyone who has one, so turning single sign-on on locks nobody out. Two-step rules are unchanged.

**Which providers work?**

Any provider that speaks OpenID Connect with the authorization-code flow and PKCE, such as a Keycloak realm. Register the redirect address that ends in the callback path and give the client id and secret to the install.

**Is single sign-on on the hosted service?**

No. Single sign-on is for self-hosted installs with the built-in identity, where you run your own provider and your own settings.

**What do the logs contain?**

Server and worker logs leave out email addresses and credentials. Keep that on, send the logs to a store you control and keep them as long as your policy says.


## Keep reading

- [Requirements](/self-host/requirements)
- [Backups and upgrades](/self-host/backups-and-upgrades)
- [Trust](/trust)
