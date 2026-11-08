package collect

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gallowforge/cockpit/internal/config"
)

var now = time.Date(2026, 3, 10, 7, 42, 0, 0, time.UTC)

func write(t *testing.T, root, p, body string, mode os.FileMode) {
	t.Helper()
	full := filepath.Join(root, p)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
	os.Chmod(full, mode) // umask must not decide the test
}

// fixture lays out a small homelab: two backup sets (one stale), two notify
// states, a MANIFEST with one drifted file, and /proc for the host block.
func fixture(t *testing.T) string {
	root := t.TempDir()
	write(t, root, "proc/loadavg", "0.12 0.20 0.18 1/400 999\n", 0o644)
	write(t, root, "proc/uptime", "4366800.12 1700000.00\n", 0o644)
	write(t, root, "proc/meminfo", "MemTotal: 8000000 kB\nMemAvailable: 3000000 kB\nSwapTotal: 1000000 kB\nSwapFree: 500000 kB\n", 0o644)
	write(t, root, "proc/stat", "cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 25 0 25 200 0 0 0 0 0 0\ncpu1 25 0 25 200 0 0 0 0 0 0\n", 0o644)
	write(t, root, "proc/sys/kernel/osrelease", "6.12.47+rpt-rpi-2712\n", 0o644)
	write(t, root, "etc/os-release", "PRETTY_NAME=\"Debian GNU/Linux 12 (bookworm)\"\n", 0o644)
	write(t, root, "sys/class/thermal/thermal_zone0/temp", "52900\n", 0o644)

	write(t, root, "etc/homelab/backups.conf", `[defaults]
base = /home/pi/backups
[vaultwarden]
type = sqlite
keep = 14
db = /x
[homeassistant]
type = ha-link
keep = 7
max_age_h = 50
`, 0o644)
	write(t, root, "var/lib/homelab/backup-status/vaultwarden",
		fmt.Sprintf("epoch=%d\ntime=x\nfile=/home/pi/backups/vaultwarden/v.tar.gz\nbytes=224853\nmembers=2\nrows_ciphers=412\n", now.Add(-3*time.Hour).Unix()), 0o600)
	write(t, root, "var/lib/homelab/backup-status/homeassistant",
		fmt.Sprintf("epoch=%d\nbytes=96300000\n", now.Add(-60*time.Hour).Unix()), 0o600)
	for i := 0; i < 3; i++ {
		p := fmt.Sprintf("home/pi/backups/vaultwarden/vaultwarden_2026031%d_050002.tar.gz", i)
		write(t, root, p, strings.Repeat("x", 100+i), 0o600)
		ts := now.Add(-time.Duration(3-i) * 24 * time.Hour)
		os.Chtimes(filepath.Join(root, p), ts, ts)
	}
	write(t, root, "home/pi/backups/vaultwarden/.tmp-partial", "x", 0o600)

	write(t, root, "var/lib/homelab/notify/health-storage", fmt.Sprintf("opened=%d\nlast_ok=%d\nlast_try=%d\n", now.Add(-2*time.Hour).Unix(), now.Add(-2*time.Hour).Unix(), now.Add(-2*time.Hour).Unix()), 0o644)
	write(t, root, "var/lib/homelab/notify/health-reboot", fmt.Sprintf("opened=%d\nlast_ok=%d\nlast_try=0\n", now.Add(-40*24*time.Hour).Unix(), now.Add(-40*24*time.Hour).Unix()), 0o644)
	write(t, root, "var/lib/homelab/notify/half.tmp.123", "opened=1\n", 0o644)
	os.MkdirAll(filepath.Join(root, "var/lib/homelab/notify/.locks"), 0o755)

	write(t, root, "home/pi/docker/_host/MANIFEST", `# comment
etc/fail2ban/jail.local  0644 root root sudo fail2ban-client reload
etc/sysctl.d/90-homelab.conf 0644 root root sysctl-p
etc/systemd/system/homelab-backup.timer 0644 root root daemon-reload
usr/local/bin/missing.sh 0755 root root -
crontab/pi crontab pi - -
ignore etc/homelab/secrets.env
`, 0o644)
	write(t, root, "home/pi/docker/_host/etc/fail2ban/jail.local", "[sshd]\nmaxretry = 5\n", 0o644)
	write(t, root, "etc/fail2ban/jail.local", "[sshd]\nmaxretry = 3\n", 0o644)
	write(t, root, "home/pi/docker/_host/etc/sysctl.d/90-homelab.conf", "vm.swappiness = 10\n", 0o644)
	write(t, root, "etc/sysctl.d/90-homelab.conf", "vm.swappiness = 10\n", 0o600)
	write(t, root, "home/pi/docker/_host/etc/systemd/system/homelab-backup.timer", "[Timer]\n", 0o644)
	write(t, root, "etc/systemd/system/homelab-backup.timer", "[Timer]\n", 0o644)
	write(t, root, "home/pi/docker/_host/usr/local/bin/missing.sh", "#!/bin/sh\n", 0o755)
	write(t, root, "home/pi/docker/RESTORE.md", "# Restore\n\n## Steps\n", 0o644)
	return root
}

// fakeCmd answers systemctl and git the way a Pi does.
func fakeCmd(calls *[]string) CmdRunner {
	return func(_ context.Context, name string, args ...string) ([]byte, error) {
		*calls = append(*calls, name+" "+strings.Join(args, " "))
		switch {
		case name == "systemctl" && len(args) > 0 && args[0] == "list-timers":
			next := now.Add(18 * time.Hour).UnixMicro()
			last := now.Add(-6 * time.Hour).UnixMicro()
			return []byte(fmt.Sprintf(`[{"unit":"homelab-backup.timer","activates":"homelab-backup.service","next":%d,"last":%d,"left":0,"passed":0},
			{"unit":"apt-daily.timer","activates":"apt-daily.service","next":null,"last":null},
			{"unit":"exim4-base.timer","activates":"","next":null,"last":0}]`, next, last)), nil
		case name == "systemctl" && args[0] == "show":
			for _, u := range args {
				if u == "" {
					return nil, fmt.Errorf("Failed to mangle name: Invalid argument")
				}
			}
			var b strings.Builder
			for _, u := range args[len(args)-countUnits(args):] {
				switch u {
				case "homelab-backup.timer":
					b.WriteString("Id=homelab-backup.timer\nUnitFileState=disabled\nDescription=Nightly backups timer\n\n")
				case "homelab-backup.service":
					b.WriteString("Id=homelab-backup.service\nResult=exit-code\nActiveState=failed\nSubState=failed\nDescription=Nightly homelab backups\n\n")
				case "tailscaled.service":
					b.WriteString("Id=tailscaled.service\nActiveState=active\nSubState=running\nResult=success\nStateChangeTimestamp=@" + fmt.Sprint(now.Add(-8*24*time.Hour).Unix()) + "\nNRestarts=0\nLoadState=loaded\nUnitFileState=enabled\n\n")
				default:
					b.WriteString("Id=" + u + "\nActiveState=inactive\nLoadState=loaded\nUnitFileState=static\n\n")
				}
			}
			return []byte(b.String()), nil
		case name == "git":
			return []byte(" M README.md\n?? notes.txt\n"), nil
		case name == "vcgencmd":
			return []byte("throttled=0x0\n"), nil
		}
		return nil, fmt.Errorf("unexpected command %s %v", name, args)
	}
}

func countUnits(args []string) int {
	for i, a := range args {
		if a == "--" {
			return len(args) - i - 1
		}
	}
	return 0
}

func entry(at time.Time, unit, inv, msg string, pid1 bool) string {
	m := map[string]any{"__REALTIME_TIMESTAMP": fmt.Sprint(at.UnixMicro()), "MESSAGE": msg, "__CURSOR": fmt.Sprint(at.UnixNano())}
	if pid1 {
		m["UNIT"], m["INVOCATION_ID"], m["_PID"] = unit, inv, "1"
	} else {
		m["_SYSTEMD_UNIT"], m["_SYSTEMD_INVOCATION_ID"] = unit, inv
	}
	if unit == "" {
		m["SYSLOG_IDENTIFIER"] = "homelab-notify"
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func fakeJournal(_ context.Context, args []string) ([]byte, error) {
	joined := strings.Join(args, " ")
	var lines []string
	switch {
	case strings.Contains(joined, "-u homelab-backup.service"):
		u := "homelab-backup.service"
		lines = []string{
			entry(now.Add(-26*time.Hour), u, "a", "2 of 2 sets written, verified and pruned", false),
			entry(now.Add(-26*time.Hour+time.Minute), u, "a", u+": Deactivated successfully.", true),
			entry(now.Add(-150*time.Minute), u, "b", "[homeassistant] no new backup - nothing pruned", false),
			entry(now.Add(-149*time.Minute), u, "b", u+": Failed with result 'exit-code'.", true),
		}
	case strings.Contains(joined, "-u homelab-restore-test.service"):
		u := "homelab-restore-test.service"
		lines = []string{
			entry(now.Add(-50*time.Hour), u, "d", "PASS vaultwarden: integrity_check ok, ciphers=412 (live now 412)", false),
			entry(now.Add(-50*time.Hour), u, "d", "PASS homeassistant: tar opens", false),
			entry(now.Add(-50*time.Hour+9*time.Second), u, "d", "restore test: 2 passed, 0 failed (restored copies in /dev/shm/restore-test deleted)", false),
			entry(now.Add(-50*time.Hour+9*time.Second), u, "d", u+": Deactivated successfully.", true),
		}
	case strings.Contains(joined, "-u homelab-health.service"):
		u := "homelab-health.service"
		lines = []string{
			entry(now.Add(-12*time.Minute), u, "h", "1 problem(s) found", false),
			entry(now.Add(-12*time.Minute), u, "h", u+": Deactivated successfully.", true),
		}
	case strings.Contains(joined, "-u homelab-heartbeat.service"):
		u := "homelab-heartbeat.service"
		for i := 0; i < 3; i++ {
			inv := fmt.Sprint("hb", i)
			at := now.Add(-time.Duration(15-5*i) * time.Minute)
			lines = append(lines, entry(at, u, inv, u+": Deactivated successfully.", true))
		}
	case strings.Contains(joined, "SYSLOG_IDENTIFIER=homelab-notify"):
		lines = []string{
			entry(now.Add(-2*time.Hour), "", "", `sent prio=default key=health-storage title="Homelab: storage needs attention" http=200 attempts=1`, false),
			entry(now.Add(-26*time.Hour), "", "", `sent prio=high key=kuma-down title="Uptime Kuma: Home Assistant is DOWN https://kuma.example/dashboard/7?token=abc" http=200 attempts=1`, false),
			entry(now.Add(-26*time.Hour+4*time.Minute), "", "", `resolved key=kuma-down prio=default title="Uptime Kuma: Home Assistant is UP" http=200 attempts=1`, false),
		}
	}
	return []byte(strings.Join(lines, "\n")), nil
}

func TestCollectFixture(t *testing.T) {
	root := fixture(t)
	cfg, err := config.FromINI(mustINI(t, `
[cockpit]
title = pi
state = /run/cockpit/state.json
[docker]
enabled = false
[host]
throttle_cmd = vcgencmd get_throttled
[homelab]
repo = /home/pi/docker
[service:tailscale]
title = Tailscale
unit = tailscaled.service
[service:gone]
container = gone
[runbook:restore]
title = Restore a backup
file = /home/pi/docker/RESTORE.md
match = backups backup-* health-storage
`))
	if err != nil {
		t.Fatal(err)
	}
	cfg.RunbookDir = filepath.Join(t.TempDir(), "runbooks")
	var calls []string
	c := New(cfg)
	c.Root, c.Cmd, c.Journal, c.Now = root, fakeCmd(&calls), fakeJournal, func() time.Time { return now }
	c.Log = log.New(io.Discard, "", 0)
	s := c.Collect(context.Background())

	if s.Host.MemTotal != 8000000*1024 || s.Host.CPUs != 2 || s.Host.TempC == nil || *s.Host.TempC != 52.9 || *s.Host.Throttled != "0x0" {
		t.Errorf("host: %+v", s.Host)
	}
	if s.Host.OS != "Debian GNU/Linux 12 (bookworm)" || s.Host.UptimeS != 4366800 {
		t.Errorf("host facts: %+v", s.Host)
	}

	if len(s.Services) != 2 || s.Services[0].State != "up" || !strings.HasPrefix(s.Services[0].Detail, "running · 8d") {
		t.Errorf("unit service: %+v", s.Services)
	}

	if len(s.Backups.Sets) != 2 {
		t.Fatalf("sets: %+v", s.Backups.Sets)
	}
	vw, ha := s.Backups.Sets[0], s.Backups.Sets[1]
	if vw.Level != "ok" || vw.Checks["rows_ciphers"] != 412 || len(vw.Archives) != 3 || vw.Archives[0].Bytes != 102 {
		t.Errorf("vaultwarden set: %+v", vw)
	}
	if ha.Level != "crit" || ha.MaxAgeH != 50 || !strings.HasPrefix(ha.Detail, "stale") {
		t.Errorf("homeassistant set should be stale past its 50 h limit: %+v", ha)
	}
	if len(s.Backups.Runs) != 2 || s.Backups.Runs[0].Result != "failed" {
		t.Errorf("backup runs: %+v", s.Backups.Runs)
	}
	if len(s.Drill.Runs) != 1 || s.Drill.Runs[0].Passed != 2 || s.Drill.Level != "ok" {
		t.Errorf("drill: %+v", s.Drill)
	}

	byKey := map[string]string{}
	for _, in := range s.Alerts.Incidents {
		byKey[in.Key] = in.State
		if strings.Contains(in.Title, "token=abc") {
			t.Errorf("titles must be redacted: %q", in.Title)
		}
	}
	if byKey["health-storage"] != "open" || byKey["kuma-down"] != "resolved" || byKey["health-reboot"] != "stale" {
		t.Errorf("incident states: %v", byKey)
	}
	if s.Alerts.Sent24h != 1 || s.Alerts.Sent7d != 2 {
		t.Errorf("sent counts %d/%d", s.Alerts.Sent24h, s.Alerts.Sent7d)
	}

	d := s.Drift
	states := map[string]string{}
	for _, f := range d.Files {
		states[f.Path] = f.State
	}
	if d.Result != "drift" || d.Tracked != 4 || states["/etc/fail2ban/jail.local"] != "differs" ||
		states["/etc/sysctl.d/90-homelab.conf"] != "mode" || states["/usr/local/bin/missing.sh"] != "missing" {
		t.Errorf("drift: %+v", d)
	}
	if len(d.Disabled) != 1 || d.Disabled[0] != "homelab-backup.timer" || d.Uncommitted != 2 {
		t.Errorf("disabled timers / uncommitted: %+v", d)
	}

	if len(s.Timers) != 3 || s.Timers[0].Unit != "homelab-backup.timer" || s.Timers[0].Result != "failed" || !s.Timers[0].Highlight {
		t.Errorf("timers: %+v", s.Timers)
	}
	if len(s.Timers[0].Runs) != 2 {
		t.Errorf("the backup timer should carry its runs: %+v", s.Timers[0].Runs)
	}

	if !s.Heartbeat.OK || s.Heartbeat.Pings24h != 3 {
		t.Errorf("heartbeat: %+v", s.Heartbeat)
	}
	if s.Health.Result != "1 problem(s) found" {
		t.Errorf("health result: %+v", s.Health)
	}
	open := 0
	for _, hc := range s.Health.Categories {
		if hc.Open {
			open++
			if hc.Name != "storage" || hc.Prio != "default" {
				t.Errorf("open category: %+v", hc)
			}
		}
	}
	if open != 1 {
		t.Errorf("exactly storage is open (reboot is stale), got %d", open)
	}

	if len(s.Runbooks) != 1 || !s.Runbooks[0].Local {
		t.Errorf("runbooks: %+v", s.Runbooks)
	}
	if b, err := os.ReadFile(filepath.Join(cfg.RunbookDir, "restore.md")); err != nil || !strings.HasPrefix(string(b), "# Restore") {
		t.Errorf("runbook copy: %v", err)
	}

	if s.Status.Level != "crit" {
		t.Errorf("stale set and failed run make it crit: %+v", s.Status)
	}
	for _, c := range calls {
		if strings.HasPrefix(c, "systemctl") && !strings.HasPrefix(c, "systemctl show") && !strings.HasPrefix(c, "systemctl list-timers") {
			t.Errorf("the collector may only read systemd: %s", c)
		}
		if strings.HasPrefix(c, "git") && !strings.Contains(c, "status --porcelain") {
			t.Errorf("the collector may only read git: %s", c)
		}
	}

	// the second tick reuses the slow data and keeps the history going
	write(t, root, "proc/stat", "cpu  150 0 150 900 0 0 0 0 0 0\ncpu0 25 0 25 200 0 0 0 0 0 0\ncpu1 25 0 25 200 0 0 0 0 0 0\n", 0o644)
	s2 := c.Collect(context.Background())
	if len(s2.Services[0].Beats) != 2 || s2.Host.CPUPct == nil || *s2.Host.CPUPct != 50 {
		t.Errorf("history: beats %q cpu %v", s2.Services[0].Beats, s2.Host.CPUPct)
	}
}

func mustINI(t *testing.T, s string) *config.File {
	t.Helper()
	f, err := config.ParseINI(strings.NewReader(s))
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestContainerState(t *testing.T) {
	started := now.Add(-3 * time.Hour)
	cases := []struct {
		c          container
		configured bool
		want       string
	}{
		{container{State: "running", Health: "healthy", StartedAt: started}, true, "up"},
		{container{State: "running", StartedAt: started}, true, "up"},
		{container{State: "running", Health: "starting"}, true, "degraded"},
		{container{State: "running", Health: "unhealthy", Streak: 3}, true, "down"},
		{container{State: "restarting", ExitCode: 1}, true, "down"},
		{container{State: "exited", ExitCode: 0, EndedAt: started}, false, "off"},
		{container{State: "exited", ExitCode: 0, EndedAt: started}, true, "down"},
		{container{State: "exited", ExitCode: 137, EndedAt: started}, false, "down"},
	}
	for _, tc := range cases {
		if got, _ := containerState(tc.c, tc.configured, now); got != tc.want {
			t.Errorf("%+v configured=%v: got %s, want %s", tc.c, tc.configured, got, tc.want)
		}
	}
}

func TestParseShow(t *testing.T) {
	p := parseShow([]byte("Id=a.service\nActiveState=active\n\nId=b.timer\nUnitFileState=enabled\n"))
	if p["a.service"]["ActiveState"] != "active" || p["b.timer"]["UnitFileState"] != "enabled" {
		t.Fatalf("got %v", p)
	}
}

func TestBackupsConfLenient(t *testing.T) {
	base, sets := parseBackupsConf([]byte("[defaults]\nbase = /b\n[x]\ntype = dir\nkeep = 3\ninclude = a\ninclude = b\n[y]\nmax_age_h = nope\n"))
	if base != "/b" || len(sets) != 2 || sets[0].Keep != 3 || sets[1].MaxAgeH != 48 {
		t.Fatalf("base %q sets %+v", base, sets)
	}
}
