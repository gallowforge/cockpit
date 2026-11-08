# Changelog

## 1.0.0

The first release.

- `cockpit collect`: containers (Docker API, GET only), systemd units, HTTPS, TCP and DNS probes, host vitals and Raspberry Pi throttle flags every 20 s; backup sets and runs, the restore drill, notifier incidents, config drift, the heartbeat and the daily health check every 5 minutes. Writes one snapshot to `/run/cockpit/state.json`.
- `cockpit serve`: the dashboard (Overview, Services, Backups, Alerts, Timers, Drift and checks, Runbooks), live over Server-Sent Events, password login with signed sessions, socket activation.
- `cockpit check`: the same status in a terminal, with exit codes 0, 1 and 2.
- `cockpit demo`: three synthetic scenarios, also as a container image.
- Sandboxed systemd units (`systemd-analyze security` 2.4 and 0.5), an end-to-end test under real systemd with Docker and Caddy, CI on every push.
