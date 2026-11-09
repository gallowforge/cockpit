# Changelog

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
