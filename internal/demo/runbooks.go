package demo

import (
	"os"
	"path/filepath"

	"github.com/gallowforge/vesper/internal/snapshot"
)

type runbook struct {
	id, title string
	match     []string
	body      string
}

var runbooks = []runbook{
	{"restore", "Restore a backup", []string{"backups", "backup-*", "drill", "unit-failed-homelab-backup*", "health-backups"}, `# Restore a backup

Every set in ` + "`backups.conf`" + ` is written at 05:00, verified, and only then are old archives pruned. The weekly drill restores the newest archive of every set into RAM and compares it with live data, so the archive you are about to use has already been read back once.

## Before you start

1. Pause the watchdogs: ` + "`sudo touch /run/homelab/maintenance`" + `
2. Take a fresh backup of the set, so the restore itself can be undone: ` + "`sudo homelab-backup --only <set>`" + `
3. Check the drill's last result for the set in Vesper (Backups → Restore drill).

## Restore one set

| Set type | Restore |
| --- | --- |
| sqlite | stop the container, ` + "`tar -xzf`" + ` the archive over the data directory, start it |
| dir | stop the container, replace the directory from the archive, start it |
| files | copy the single files back to their live paths, keep the old ones as ` + "`*.bak`" + ` |
| ha-link | Home Assistant: Settings → System → Backups → upload and restore |

` + "```bash" + `
cd ~/docker/vaultwarden && docker compose stop
sudo tar -xzf ~/backups/vaultwarden/vaultwarden_<stamp>.tar.gz -C ~/docker/vaultwarden/data
docker compose up -d && docker compose ps
` + "```" + `

## Afterwards

- Test from a client, not from the server: sign in, sync, open a note.
- ` + "`sudo homelab-health.sh --dry-run`" + ` must end with **all healthy**.
- Remove the flag: ` + "`sudo rm /run/homelab/maintenance`" + `
`},
	{"dns", "When DNS stops", []string{"adguard", "health-dns"}, `# When DNS stops

AdGuard Home is the only resolver on the network, on purpose: a fallback resolver broke every local name on phones that race their resolvers. So when it stops, everything looks like "the internet is down".

## First aid (two minutes)

1. Is it the Pi or the ISP? ` + "`homelab-netprobe report`" + ` separates DNS failures from packet loss.
2. Is the container up? Vesper → Services → AdGuard Home. If it is restarting, read ` + "`docker logs --tail 50 adguard`" + `.
3. Still down after a restart? Point the router's DHCP DNS at a public resolver **for now**, and say so in the journal.

## Never

- Never edit ` + "`AdGuardHome.yaml`" + ` while AdGuard runs: it rewrites the file on exit.
- Never add a fallback resolver for clients.
`},
	{"drift", "Config drift", []string{"drift", "config-drift", "health-config-drift"}, `# Config drift

Every host file lives in the repo under ` + "`_host/`" + ` at its live path. Drift means the live machine no longer matches the repo.

## Find it

` + "```bash" + `
sudo ~/docker/_host/install.sh          # ends with RESULT: no drift, or the difference
` + "```" + `

## Decide which side is right

- **The live file is right** (a hand fix during an incident): copy it into ` + "`_host/`" + `, commit with the reason.
- **The repo is right** (someone edited the live file): ` + "`sudo _host/install.sh --apply`" + ` installs the repo's version and keeps the old file next to it.

Either way, finish with ` + "`RESULT: no drift`" + `. Vesper re-checks every five minutes.
`},
	{"alerts", "Alerts and the notifier", []string{"alerts", "health-*", "unit-failed-*", "kuma-*"}, `# Alerts and the notifier

Every alert goes through one notifier, which sends **at most one push per key per interval** and one all-clear when the problem clears. Silence means healthy.

| Key | Comes from | Repeats |
| --- | --- | --- |
| ` + "`health-<category>`" + ` | the 07:30 health check | every 20 h while it lasts |
| ` + "`unit-failed-<unit>`" + ` | any timer job that fails | once, then the all-clear |
| ` + "`kuma-down`" + ` | Uptime Kuma | per monitor |

## An alert you did not expect

1. Open it in Vesper → Alerts: when it opened, how often it was sent, whether it resolved.
2. Read the unit's own log: ` + "`journalctl -u <unit> -n 50`" + `
3. Fix the cause, then ask why the machinery did not prevent it, and write that down.
`},
	{"rebuild", "Rebuild the Pi", []string{"host", "host-*", "heartbeat", "health"}, `# Rebuild the Pi

Target: two to three hours from bare hardware to every service answering.

1. Flash Raspberry Pi OS Lite (64-bit), enable SSH, set the hostname.
2. Install Docker CE with Compose and Tailscale; join the tailnet.
3. Clone the repo to ` + "`~/docker`" + `, restore ` + "`/etc/homelab/secrets.env`" + ` from the newest ` + "`secrets`" + ` archive on the desktop.
4. ` + "`sudo _host/install.sh --apply && sudo _host/install.sh --bootstrap`" + `
5. Start the stacks in order: AdGuard first, Uptime Kuma last.
6. Restore each data set (see *Restore a backup*), then run the drill: ` + "`sudo _host/backup-restore-test.sh`" + `
`},
}

// Runbooks lists the demo runbooks as the snapshot carries them.
func Runbooks() []snapshot.Runbook {
	out := make([]snapshot.Runbook, 0, len(runbooks))
	for _, rb := range runbooks {
		out = append(out, snapshot.Runbook{ID: rb.id, Title: rb.title, Local: true, Match: rb.match, Bytes: len(rb.body)})
	}
	return out
}

// RunbookBody returns the Markdown of one demo runbook.
func RunbookBody(id string) (string, bool) {
	for _, rb := range runbooks {
		if rb.id == id {
			return rb.body, true
		}
	}
	return "", false
}

// WriteRunbooks writes the demo runbooks into dir for the web server to serve.
func WriteRunbooks(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, rb := range runbooks {
		if err := os.WriteFile(filepath.Join(dir, rb.id+".md"), []byte(rb.body), 0o644); err != nil {
			return err
		}
	}
	return nil
}
