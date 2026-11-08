# Configuration

Cockpit reads one INI file, `/etc/cockpit/cockpit.conf` by default (`-config`
changes it). Sections are `[name]` or `[name:id]`, values are `key = value`, and
`#` or `;` start a comment. Unknown sections and keys are errors, with the line
number, so a typo never passes silently. Start from
[`deploy/cockpit.conf.example`](../deploy/cockpit.conf.example).

Durations are Go durations (`20s`, `5m`) or days (`8d`). Lists are separated by spaces.

## `[cockpit]`

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | the hostname | shown in the UI and the browser tab |
| `state` | `/run/cockpit/state.json` | where the collector writes and the web reads |
| `runbook_dir` | `/run/cockpit/runbooks` | where local runbooks are copied for the web process |
| `interval` | `20s` | containers, units, probes, host (at least `2s`) |
| `slow_interval` | `5m` | journal, backups, alerts, drift, runbooks |
| `history` | `90` | samples kept for heartbeat bars and sparklines |

## `[web]`

| Key | Default | Meaning |
| --- | --- | --- |
| `listen` | `127.0.0.1:8080` | `systemd` (socket activation), `unix:/path`, or `host:port` |
| `auth` | `password` | or `none` when the proxy authenticates |
| `password_hash_file` | `/etc/cockpit/password.hash` | from `cockpit hash-password`; a systemd credential named `password.hash` wins |
| `session_days` | `365` | how long a sign-in lasts |
| `cookie_secure` | `auto` | `auto` (when TLS or `X-Forwarded-Proto: https`), `always`, `never` |
| `trust_proxy` | `false` | trust `X-Forwarded-*`; always on for `systemd` and `unix:` listeners |

## `[host]`

| Key | Default | Meaning |
| --- | --- | --- |
| `mounts` | `/` | file systems shown as disk dials |
| `temp_file` | `/sys/class/thermal/thermal_zone0/temp` | millidegrees Celsius |
| `throttle_cmd` | none | e.g. `vcgencmd get_throttled` on a Raspberry Pi |
| `write_device` | none | block device for the writes-per-day figure, e.g. `sda` |

## `[docker]`

`enabled` (default `true`) and `socket` (default `/var/run/docker.sock`).
Cockpit only sends `GET` requests: the container list and one inspect per container.

## `[homelab]`

The backup, drill, alert, drift, heartbeat and health views. Defaults follow
[gallowforge/homelab](https://github.com/gallowforge/homelab).

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` turns all of the below off |
| `backup_conf` | `/etc/homelab/backups.conf` | `[defaults] base`, and each set's `type`, `keep`, `max_age_h` |
| `backup_status` | `/var/lib/homelab/backup-status` | one `key=value` file per verified set (`epoch`, `bytes`, `members`, `rows_*`) |
| `notify_state` | `/var/lib/homelab/notify` | one file per open incident (`opened`, `last_ok`, `last_try`) |
| `maintenance_flag` | `/run/homelab/maintenance` | shows a maintenance banner while it exists |
| `repo` | `/home/pi/docker` | the git repo with `_host/` |
| `manifest` | `<repo>/_host/MANIFEST` | `path mode owner group follow-up` per line, `ignore path` lines |
| `backup_unit`, `drill_unit`, `health_unit`, `heartbeat_unit` | `homelab-backup.service`, `homelab-restore-test.service`, `homelab-health.service`, `homelab-heartbeat.service` | units whose runs are read from the journal |
| `health_categories` | the 17 categories of `homelab-health.sh` | each lights up while `health-<category>` is open |
| `notify_tag` | `homelab-notify` | the notifier's syslog identifier |
| `info_keys` | none | glob patterns for routine notes, never counted as open |
| `self_disabling` | none | MANIFEST timers that may be disabled (they turn themselves off) |
| `alert_window` | `8d` | an open incident with no push for this long is "stale" |
| `events_days` | `30` | how much of the notifier's log to read |

## `[timers]`

| Key | Default | Meaning |
| --- | --- | --- |
| `show` | `*` | glob patterns of timers to list |
| `highlight` | `homelab-*` | timers that count towards the status (failed or disabled) |
| `history` | the four homelab units | services whose last 40 runs are kept |
| `history_days` | `30` | how far back to read them |

## `[service:<id>]`

One row on the Services page. At least one of `container`, `unit` or `probe`.

| Key | Meaning |
| --- | --- |
| `title`, `note`, `group` | how it is shown; rows are grouped by `group` in file order |
| `container` | a Docker container name |
| `unit` | a systemd unit |
| `probe` | `https://127.0.0.1:8452/alive`, `http://...`, `tcp://host:port` or `dns://server:port/name` |
| `sni` | the TLS name to ask for (and to verify) when the probe uses an address |
| `expect` | accepted HTTP statuses, default `200-399`; `200-499` means "the proxy and the app answer" |
| `url` | where the row's Open button goes |
| `runbook` | a runbook id, if the automatic matching is not enough |

A probe that fails marks the row down; a certificate with less than 14 days left marks it degraded.

## `[runbook:<id>]`

| Key | Meaning |
| --- | --- |
| `title` | shown in the list and on links |
| `file` or `url` | a local Markdown file (rendered in Cockpit) or a link |
| `match` | glob patterns matched against alert keys, service ids, unit names and areas (`backups`, `drill`, `alerts`, `timers`, `drift`, `heartbeat`, `health`, `host`, `services`); the first runbook that matches wins |
