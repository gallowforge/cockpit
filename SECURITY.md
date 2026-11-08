# Security

Cockpit shows how a server is doing, so it is built to be safe to leave open
on a phone: it can read, and it cannot change anything.

## The model

| Process | Runs as | Can read | Can write | Network |
| --- | --- | --- | --- | --- |
| `cockpit collect` | root, `CapabilityBoundingSet=CAP_DAC_READ_SEARCH` | the journal, `systemctl show`, the Docker API (GET only), the files named in `cockpit.conf` | `/run/cockpit` only (`ProtectSystem=strict`, `ProtectHome=read-only`) | no listener; outbound only to localhost and private ranges (`IPAddressDeny=any`) |
| `cockpit serve` | `DynamicUser`, no capabilities | `state.json`, the copied runbooks, its config, the password hash (`LoadCredential`) | nothing | none (`PrivateNetwork=yes`); systemd hands it the unix socket |

Both units also use `NoNewPrivileges`, `MemoryDenyWriteExecute`, a
`@system-service` system-call filter, and the kernel and namespace protections in
[`deploy/systemd/`](deploy/systemd). CI prints `systemd-analyze security` for
both on every push (2.4 and 0.5 at the time of 1.0.0).

## The web side

- Every route only reads. The only `POST`s are login and logout, which accept
  JSON from the same origin only.
- Passwords are stored as PBKDF2-SHA256 with 600,000 rounds and a random salt.
  Sessions are HMAC-signed cookies (`HttpOnly`, `SameSite=Strict`, `Secure`
  behind TLS) keyed to the password hash, so a new password signs every device out.
- Failed logins back off per client after 5 attempts, and stop for everyone after
  30 a minute.
- Headers: a strict Content-Security-Policy (no inline script, no framing),
  `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.
- Runbooks are Markdown rendered with raw HTML escaped; only `http`, `https`,
  `mailto` and relative links survive.
- Alert titles and run summaries pass a redactor (URL paths, `key=value`
  secrets, bearer tokens, UUIDs, long hex and base64 runs) before they reach the page.

Put Cockpit behind TLS (see [`deploy/caddy/Caddyfile.example`](deploy/caddy/Caddyfile.example))
and keep it on your LAN or tailnet. `auth = none` is meant for a proxy that does
its own authentication.

## Reporting a problem

Please report a vulnerability privately to ali@gallowforge.dev rather
than in a public issue. Expect a reply within a week.
