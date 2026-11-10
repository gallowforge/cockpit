# Changelog

## Unreleased

- A config with both `[vesper]` and its old name `[cockpit]` is refused with a clear error, instead of quietly ignoring `[cockpit]`.

## 2.0.0 "Vesper"

Cockpit is now **Vesper**, with a ground-up redesign of the UI, a real day of history, and a stricter rule: Vesper never calls something fine that it cannot see.

- **New name.** Vesper is the evening star, the first light of the night. The binary, the config and the units follow it: `vesper`, `/etc/vesper/vesper.conf`, `vesper-collect.service` and `vesper-web.socket`, with the state in `/run/vesper`. A config that still has the old `[cockpit]` section is read the same way. The session cookie is new, so every device signs in once more.
- **Upgrading from Cockpit 1.x**: stop and disable `cockpit-collect.service`, `cockpit-web.socket` and `cockpit-web.service`; install the `vesper` binary; copy `/etc/cockpit/cockpit.conf` to `/etc/vesper/vesper.conf` and `password.hash` beside it (change any `/run/cockpit` or `/etc/cockpit` path inside); install the units and the tmpfiles entry from `deploy/`; enable `vesper-collect.service` and `vesper-web.socket`; point your reverse proxy at `/run/vesper/web.sock` (a Caddy in Docker also needs its volume changed to `/run/vesper:/run/vesper:ro`); then remove the old `cockpit-*` unit files and `/etc/tmpfiles.d/cockpit.conf`, run `systemctl daemon-reload`, and delete `/etc/cockpit` once Vesper is running.
- **A console, not a poster.** A sidebar with Overview, Services, Backups, History, Jobs, System and Checklists (on a phone, a tab bar with a More tab). The Overview opens with one sentence and the facts behind it, then the last 24 hours of every service in quarter hours, four key figures, the services table and a rail with what happened since you last looked, backups, the next jobs, the host and what Vesper can see. Colour only means state: green up, amber needs you, red down, hatched grey can't see. Type is IBM Plex Sans and Plex Mono, vendored with their licences; a new neutral mark and app icons.
- **24 hours of history.** Every service carries a day line, one mark per five minutes, kept across restarts. A slot holds the worst state sampled in it; time Vesper did not watch stays unknown instead of being assumed up. Uptime and outages on the Services pages come from it.
- **Honest states.** A source that cannot be read, a service that cannot be confirmed, an unreadable MANIFEST, or a drill, heartbeat or health check that is set up but has never run, is a blind spot: the status is "Vesper can't see", never "Nothing needs you", and `vesper check` exits 1. An alert about a service that is already down is folded into it; failed pushes raise "Alerts may not reach your phone".
- **Jobs** have their own page: the next 24 hours on one line, daily and weekly jobs apart from the ones that run every few minutes.
- Schema 2 (`status.blind`, `services[].day`, `drill.unit`, `health.unit`). A page served to an older collector treats its snapshot as a blind spot until the collector is restarted. Nothing else to change in the config.
- README images and the social preview show the new UI; `scripts/readme-visuals.sh` captures it as before.

## 1.2.0

- **Username and password.** The login is now a real form with a username and a password, so Bitwarden and other password managers save and fill one complete login. The fields are read when the form is sent, so a filled-in login works without any typing, and the button never waits for keystrokes. A UI test fills the fields the way a password manager does and signs in.
- One owner account: `[web] username` in `cockpit.conf` (default `owner`), compared in constant time. A wrong username gets the same answer, delay and back-off as a wrong password, so nobody can tell whether a name exists. Renaming the account signs every device out.
- Upgrading: add `username = ...` under `[web]` if you want a name other than `owner`; the password hash file is unchanged.

## 1.1.1

- The demo container image now builds both architectures natively: the UI is built once and Go cross-compiles for arm64. The 1.1.0 image build ran `npm ci` under arm64 emulation, which crashed with an illegal instruction and hung, so 1.1.0 has binaries but no image. The program itself is unchanged from 1.1.0.

## 1.1.0 "Night flight"

A new face, and three ways to get to the answer faster.

- **Night flight.** The Overview is an artificial horizon: level and blue while nothing needs you, banked amber or red when something does. Eight status lamps sit under it and only the ones that need you light; a lamp-test button lights them all. Live gauges for CPU, memory, temperature and disk, with a caution arc. Barlow and Barlow Condensed throughout.
- **Command bar.** <kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>/</kbd> jumps to any service, backup set, alert, timer or checklist, or opens an app; <kbd>G</kbd> then a letter jumps to a page.
- **While you were away.** One line on the Overview says what happened since you last looked: backup runs, the drill, alerts that opened and cleared. The time you last looked stays in your browser.
- **Checklists.** Runbooks are now checklists: numbered steps become boxes you tick as you go, kept on that device for 12 hours and dropped if the runbook changes.
- **Home-screen app.** A web app manifest and icons, so it installs on a phone and opens full screen.
- Plain wording: "1 file differs" instead of "1 file(s) differ", in the UI, `cockpit check` and config errors.

Security:

- Password checks run one at a time, so a burst of parallel logins cannot outrun the limiter.
- A failed login's back-off starts after the password check. It used to be stamped with the time before the check, so on a machine where the check takes about a second, the first one-second wait had already lapsed.
- The global login limit no longer counts clients that are already locked out, so one attacker cannot lock everybody else out.
- The event stream re-checks the session on every keep-alive and stops when it has expired or the password changed.
- When `cockpit serve` opens its own unix socket, it is created with mode 0660 from the start instead of being changed afterwards.
- The redactor also removes credentials in any URL, `Basic` tokens, JWTs, AWS access keys, `--password` flags and `pwd`/`passwd` values.
- Unknown `/api/` routes answer 404 in JSON instead of the app page.

## 1.0.0

The first release.

- `cockpit collect`: containers (Docker API, GET only), systemd units, HTTPS, TCP and DNS probes, host vitals and Raspberry Pi throttle flags every 20 s; backup sets and runs, the restore drill, notifier incidents, config drift, the heartbeat and the daily health check every 5 minutes. Writes one snapshot to `/run/cockpit/state.json`.
- `cockpit serve`: the dashboard (Overview, Services, Backups, Alerts, Timers, Drift and checks, Runbooks), live over Server-Sent Events, password login with signed sessions, socket activation.
- `cockpit check`: the same status in a terminal, with exit codes 0, 1 and 2.
- `cockpit demo`: three synthetic scenarios, also as a container image.
- Sandboxed systemd units (`systemd-analyze security` 2.4 and 0.5), an end-to-end test under real systemd with Docker and Caddy, CI on every push.
