# Put Docustay behind your own address

The web container listens on port 8080 (change it with `DOCUSTAY_PORT` in `.env`). Everything people use goes through that one port. Put a reverse proxy in front of it to get your own domain and HTTPS. In the examples below, 8080 is the default: use the number you set as `DOCUSTAY_PORT` if you changed it. The proxy runs on the same machine as Docker and talks to `localhost:<that port>`; if it runs in a container of its own, use the web service name and port 3000 instead (`web:3000`) on the same Docker network.

## Tell Docustay its address

Set the address people will type, with no trailing slash, in `.env`, then run `docker compose up -d` (a plain restart does not read `.env` again):

```ini
# in .env (a file, not a command)
KEYSTONE_PUBLIC_URL=https://sign.example.com
```

This is the start of every signing link and reset link in an email. If it is wrong, the links in emails will not open.

## Caddy

Caddy gets and renews the certificate for you.

```caddyfile
sign.example.com {
  reverse_proxy localhost:8080
}
```

## nginx

```nginx
server {
  listen 443 ssl http2;
  server_name sign.example.com;
  ssl_certificate     /etc/letsencrypt/live/sign.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sign.example.com/privkey.pem;
  client_max_body_size 50m;                        # uploaded documents
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

## Traefik (labels on the web service)

Put this in a new file next to `docker-compose.yml` called `docker-compose.override.yml` (Docker Compose reads it on top of the main file), then run `docker compose up -d`. On its own it is not a whole compose file.

```yaml
# docker-compose.override.yml
services:
  web:
    labels:
      - traefik.enable=true
      - traefik.http.routers.docustay.rule=Host(`sign.example.com`)
      - traefik.http.routers.docustay.tls.certresolver=letsencrypt
      - traefik.http.services.docustay.loadbalancer.server.port=3000
```

## Check

- Open `https://sign.example.com/login`. The sign-in page should load over HTTPS with no certificate warning.
- Send yourself a document and open the link in the email. It must start with your address.
- If you use embedded signing, list your own website under Settings → Developers → Embedding.

## Keep the proxy honest

Pass `X-Forwarded-Proto` and `X-Forwarded-For` as shown, **and add `DOCUSTAY_CLIENT_IP_HEADER=X-Forwarded-For` to `.env`** (then `docker compose up -d`). Docustay uses the first to know a request was secure and the second for the address in the audit trail, on the signing certificate and in the rate limits; without the setting it can only see the proxy's own address. Set it only when a proxy you control is in front (otherwise anyone could write their own address into the header); `DOCUSTAY_PROXY_COUNT` is how many proxies there are (default 1). Do not expose ports 5432 (database), 8333 (file store) or 3000 (web) directly.

## Ports and what listens where

Inside the compose network the web service listens on 3000, and the compose file publishes it on your machine as port 8080 (`DOCUSTAY_PORT`). A proxy on the same machine forwards to `localhost:8080`, as in the Caddy and nginx examples; Traefik, running in the compose network, names 3000 in its label. The database (5432) and the file store (8333) must not be reachable from the internet.

## Variables this page touches

| Variable | What it does |
|---|---|
| `KEYSTONE_PUBLIC_URL` | the start of every signing and reset link in an email; defaults to `http://localhost:` plus your port |
| `DOCUSTAY_PORT` | the port the web container is published on (host side) |
| `DOCUSTAY_CLIENT_IP_HEADER` | the header to read the visitor's address from; set it only when a proxy you control is in front |
| `DOCUSTAY_PROXY_COUNT` | how many proxies are in front (default 1) |

## After changing any of them

Recreate the containers so the new values are read:

```bash
docker compose up -d
```

Then repeat the three checks above. If an email link still opens `localhost`, `KEYSTONE_PUBLIC_URL` was not picked up: confirm it is in the `.env` next to the compose file, with no trailing slash and no quotes around the value.
