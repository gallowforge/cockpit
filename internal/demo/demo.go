// Package demo generates a synthetic but realistic homelab snapshot, so the
// dashboard can be tried, tested and photographed without a real server. Every
// name and number here is made up; the shapes match what the collector emits.
package demo

import (
	"fmt"
	"hash/fnv"
	"math"
	"math/rand/v2"
	"time"

	"github.com/gallowforge/cockpit/internal/snapshot"
)

// Scenarios.
const (
	Calm      = "calm"      // everything fine
	Attention = "attention" // one config drift, one low alert
	Incident  = "incident"  // a container down and an urgent alert
	Blind     = "blind"     // Docker cannot be read: nothing is wrong that Cockpit can see
)

// Generator builds snapshots for a fixed scenario. Histories are seeded, so
// the same clock gives the same picture.
type Generator struct {
	Scenario string
	Title    string
}

func (g *Generator) title() string {
	if g.Title != "" {
		return g.Title
	}
	return "raspberrypi"
}

type svcDef struct {
	id, title, note, group, kind, image, unit, probe string
	port                                             int
	ms                                               float64
}

var services = []svcDef{
	{"adguard", "AdGuard Home", "DNS for the house", "Network", "container", "adguard/adguardhome:v0.107", "", "dns 127.0.0.1:53", 53, 1.4},
	{"caddy", "Caddy", "the TLS front door", "Network", "container", "caddy:2", "", "https://127.0.0.1:8443", 8443, 6.8},
	{"tailscale", "Tailscale", "access from away", "Network", "unit", "", "tailscaled.service", "", 0, 0},
	{"vaultwarden", "Vaultwarden", "passwords", "Apps", "container", "vaultwarden/server:1.34", "", "https://127.0.0.1:8452", 8452, 9.2},
	{"homeassistant", "Home Assistant", "smart home", "Apps", "container", "ghcr.io/home-assistant/home-assistant:2026.3", "", "https://127.0.0.1:8443", 8443, 24.5},
	{"couchdb", "CouchDB", "notes sync", "Apps", "container", "couchdb:3", "", "https://127.0.0.1:8450", 8450, 11.3},
	{"syncthing", "Syncthing", "file replication", "Apps", "container", "syncthing/syncthing:1.30", "", "https://127.0.0.1:8453", 8453, 14.1},
	{"uptime-kuma", "Uptime Kuma", "endpoint monitors", "Operations", "container", "louislam/uptime-kuma:2", "", "https://127.0.0.1:8446", 8446, 18.7},
	{"dockge", "Dockge", "compose stacks", "Operations", "container", "louislam/dockge:1", "", "", 0, 0},
	{"watchtower", "Watchtower", "tiered updates", "Operations", "container", "containrrr/watchtower:1.7", "", "", 0, 0},
	{"docker", "Docker Engine", "container runtime", "Host", "unit", "", "docker.service", "", 0, 0},
	{"operator", "AI operator", "on-call agent session", "Host", "unit", "", "claude-session.service", "", 0, 0},
}

type setDef struct {
	name, typ string
	keep      int
	maxAge    int
	bytes     int64
	checks    map[string]int
	growth    float64
}

var sets = []setDef{
	{"adguard", "dir", 14, 48, 412_000, map[string]int{"members": 3}, 0.001},
	{"couchdb", "dir", 14, 48, 38_400_000, map[string]int{"members": 9}, 0.004},
	{"kuma", "sqlite", 7, 48, 23_700_000, map[string]int{"rows_monitor": 13, "members": 1}, 0.006},
	{"vaultwarden", "sqlite", 14, 48, 224_800, map[string]int{"rows_ciphers": 412, "members": 2}, 0.0008},
	{"dockge", "sqlite", 14, 48, 61_400, map[string]int{"rows_user": 1, "members": 1}, 0},
	{"syncthing", "dir", 14, 48, 4_100, map[string]int{"members": 3}, 0},
	{"homeassistant", "ha-link", 7, 50, 96_300_000, nil, 0.009},
	{"platform", "files", 30, 48, 2_180_000, map[string]int{"members": 94}, 0.002},
	{"secrets", "files", 14, 48, 9_200, map[string]int{"members": 6}, 0},
}

// Snapshot returns the state of the synthetic homelab at now.
func (g *Generator) Snapshot(now time.Time) *snapshot.Snapshot {
	now = now.UTC().Truncate(time.Second)
	r := rand.New(rand.NewPCG(42, 7))
	s := &snapshot.Snapshot{Schema: snapshot.Schema, Generated: now, Title: g.title(), Demo: true}

	s.Host = g.host(now, r)
	s.Services = g.services(now, r)
	s.Backups = g.backups(now, r)
	s.Drill = g.drill(now)
	s.Alerts = g.alerts(now)
	s.Timers = g.timers(now)
	s.Drift = g.drift(now)
	s.Heartbeat = g.heartbeat(now)
	s.Health = g.health(now)
	s.Runbooks = Runbooks()
	for _, n := range []string{"alerts", "backups", "drift", "host", "journal", "runbooks", "services", "timers"} {
		src := snapshot.Source{Name: n, OK: true, At: now, DurationMS: 2 + float64(len(n))}
		if g.Scenario == Blind && n == "services" {
			src.OK, src.Error = false, "docker: dial unix /var/run/docker.sock: connect: permission denied"
		}
		s.Sources = append(s.Sources, src)
	}
	snapshot.Finalize(s, now)
	return s
}

// wave is a smooth, deterministic "live" signal in [0,1] for a given time.
func wave(now time.Time, period float64, phase float64) float64 {
	t := float64(now.Unix())
	return 0.5 + 0.5*math.Sin(2*math.Pi*t/period+phase)
}

func jitter(now time.Time, key string) float64 {
	h := fnv.New32a()
	fmt.Fprintf(h, "%s-%d", key, now.Unix()/2)
	return float64(h.Sum32()%1000) / 1000
}

func (g *Generator) host(now time.Time, r *rand.Rand) snapshot.Host {
	cpu := 4 + 9*wave(now, 300, 0) + 6*jitter(now, "cpu")
	temp := 49 + 5*wave(now, 600, 1) + jitter(now, "temp")
	thr := "0x0"
	writes := 6.4
	h := snapshot.Host{
		Name: g.title(), OS: "Debian GNU/Linux 12 (bookworm)", Kernel: "6.12.47+rpt-rpi-2712", CPUs: 4,
		UptimeS:  int64(50*86400 + 12*3600 + now.Unix()%3600),
		Load:     [3]float64{0.12 + 0.3*wave(now, 240, 0), 0.18, 0.16},
		CPUPct:   &cpu,
		MemTotal: 8_455_000_000, MemAvail: int64(3_300_000_000 + 250_000_000*wave(now, 900, 2)),
		SwapTotal: 1_610_000_000, SwapFree: 1_150_000_000,
		TempC: &temp, Throttled: &thr, WritesGiBd: &writes,
		Disks: []snapshot.Disk{{Mount: "/", Size: 62_400_000_000, Used: 21_900_000_000}},
	}
	for i := 89; i >= 0; i-- {
		t := now.Add(-time.Duration(i) * 20 * time.Second)
		c := 4 + 9*wave(t, 300, 0) + 6*r.Float64()
		m := 59 + 3*wave(t, 900, 2+math.Pi) + r.Float64()
		h.History = append(h.History, snapshot.Sample{T: t, CPU: math.Round(c*10) / 10, Mem: math.Round(m*10) / 10})
	}
	return h
}

func (g *Generator) services(now time.Time, r *rand.Rand) []snapshot.Service {
	var out []snapshot.Service
	for i, d := range services {
		up := time.Duration(2+i*3)*24*time.Hour + time.Duration(i*37)*time.Minute
		if d.id == "adguard" {
			up = 21 * time.Hour
		}
		since := now.Add(-up)
		sv := snapshot.Service{ID: d.id, Title: d.title, Note: d.note, Group: d.group, Kind: d.kind, State: "up", Since: &since}
		if d.kind == "container" {
			sv.Image = d.image
			sv.Detail = "healthy · up " + snapshot.Ago(up)
		} else {
			sv.Detail = "running · up " + snapshot.Ago(up)
		}
		if d.port > 0 {
			sv.URL = fmt.Sprintf("https://raspberrypi.example-tailnet.ts.net:%d", d.port)
			if d.port == 53 {
				sv.URL = ""
			}
		}
		beats := make([]byte, 90)
		for j := range beats {
			beats[j] = 'u'
		}
		if d.id == "homeassistant" { // a short blip an hour ago, already over
			beats[60], beats[61] = 'd', 'x'
		}
		if d.probe != "" {
			p := &snapshot.Probe{Target: d.probe, OK: true}
			if d.probe[:3] == "dns" {
				p.Target = "dns 127.0.0.1:53"
			} else {
				p.Code = 200
				days := 58
				p.CertDays = &days
			}
			for j := 0; j < 90; j++ {
				v := d.ms * (0.8 + 0.5*r.Float64())
				if r.Float64() < 0.03 {
					v *= 3
				}
				p.Latencies = append(p.Latencies, math.Round(v*10)/10)
			}
			p.LatencyMS = math.Round(d.ms*(0.85+0.4*jitter(now, d.id))*10) / 10
			p.Latencies[89] = p.LatencyMS
			if d.id == "homeassistant" {
				p.Latencies[61] = -1
			}
			sv.Probe = p
			sv.Detail += fmt.Sprintf(" · %.0f ms", p.LatencyMS)
		}
		if g.Scenario == Incident && d.id == "homeassistant" {
			down := now.Add(-4 * time.Minute)
			sv.State, sv.Since = "down", &down
			sv.Detail = "unhealthy · 4 failed checks · https://127.0.0.1:8443 timeout"
			for j := 84; j < 90; j++ {
				beats[j] = 'x'
			}
			if sv.Probe != nil {
				sv.Probe.OK, sv.Probe.Error = false, "timeout"
				for j := 84; j < 90; j++ {
					sv.Probe.Latencies[j] = -1
				}
			}
		}
		if g.Scenario == Blind && d.kind == "container" { // the Docker API cannot be read
			sv.State, sv.Detail, sv.Since, sv.Image = "unknown", "Docker could not be read", nil, d.image
			for j := 84; j < 90; j++ {
				beats[j] = '?'
			}
		}
		sv.Beats = string(beats)
		out = append(out, sv)
	}
	return out
}

// at returns today's (or an earlier day's) wall-clock time in the demo's
// zone, so the nightly jobs land at believable hours.
func at(now time.Time, daysAgo, hh, mm, ss int) time.Time {
	loc := time.FixedZone("UTC+3", 3*3600)
	l := now.In(loc)
	return time.Date(l.Year(), l.Month(), l.Day()-daysAgo, hh, mm, ss, 0, loc).UTC()
}

func lastDaily(now time.Time, hh, mm int) (time.Time, int) {
	t := at(now, 0, hh, mm, 0)
	if t.After(now) {
		return at(now, 1, hh, mm, 0), 1
	}
	return t, 0
}

func (g *Generator) backups(now time.Time, r *rand.Rand) snapshot.Backups {
	last, off := lastDaily(now, 5, 0)
	b := snapshot.Backups{}
	for _, d := range sets {
		bs := snapshot.BackupSet{Name: d.name, Type: d.typ, Keep: d.keep, MaxAgeH: d.maxAge, Checks: d.checks}
		size := float64(d.bytes)
		for i := 0; i < d.keep; i++ {
			t := at(now, off+i, 5, 0, 2+r.IntN(40))
			if d.name == "homeassistant" {
				t = at(now, off+i, 4, 48+r.IntN(8), r.IntN(60))
			}
			v := size * (1 - d.growth*float64(i)) * (1 + 0.01*(r.Float64()-0.5))
			bs.Archives = append(bs.Archives, snapshot.Archive{Time: t, Bytes: int64(v)})
		}
		bs.Bytes = bs.Archives[0].Bytes
		ok := bs.Archives[0].Time
		if d.name != "homeassistant" {
			ok = last.Add(time.Duration(20+len(d.name)*3) * time.Second)
		}
		bs.LastOK = &ok
		b.Sets = append(b.Sets, bs)
	}
	for i := 0; i < 30; i++ {
		start := at(now, off+i, 5, 0, 1)
		dur := time.Duration(140+r.IntN(30)) * time.Second
		run := snapshot.Run{Unit: "homelab-backup.service", Start: start, End: start.Add(dur), Result: "success",
			Summary: "9 of 9 sets written, verified and pruned"}
		if i == 9 {
			run.Result = "failed"
			run.Summary = "[vaultwarden] required file is missing: rsa_key.pem - nothing pruned"
		}
		b.Runs = append(b.Runs, run)
	}
	return b
}

var drillDetails = [][2]string{
	{"adguard", "AdGuardHome.yaml present with http/dns sections, no .bak copies"},
	{"couchdb", "8 .couch files (live 8), docker.ini present"},
	{"kuma", "integrity_check ok, monitor=13 (live now 13)"},
	{"vaultwarden", "integrity_check ok, ciphers=412 (live now 412), rsa_key.pem present and identical to live"},
	{"dockge", "integrity_check ok, user=1 (live now 1)"},
	{"syncthing", "key.pem + parseable cert.pem + config.xml, no index/lock"},
	{"homeassistant", "tar opens, backup.json readable, protected=True, mode 600"},
	{"platform", "bundle clones (94 files, HEAD = live), crontabs + backups.conf present, 33 units"},
	{"secrets", "6 files, all identical to live (contents not shown)"},
}

func (g *Generator) drill(now time.Time) snapshot.Drill {
	loc := time.FixedZone("UTC+3", 3*3600)
	l := now.In(loc)
	back := int(l.Weekday()) // days since Sunday
	first := at(now, back, 5, 45, 0)
	if first.After(now) {
		first = at(now, back+7, 5, 45, 0)
	}
	var d snapshot.Drill
	for w := 0; w < 8; w++ {
		start := first.AddDate(0, 0, -7*w)
		run := snapshot.DrillRun{Start: start, End: start.Add(time.Duration(9+w%3) * time.Second), Result: "success"}
		for _, x := range drillDetails {
			run.Results = append(run.Results, snapshot.DrillResult{Set: x[0], OK: true, Detail: x[1]})
		}
		run.Passed = len(run.Results)
		d.Runs = append(d.Runs, run)
	}
	return d
}

func (g *Generator) alerts(now time.Time) snapshot.Alerts {
	res := func(t time.Time) *time.Time { return &t }
	in := []snapshot.Incident{
		{Key: "caretaker-morning", Title: "Caretaker: what I did", Prio: "low", Opened: at(now, 0, 8, 14, 0), Sends: 1, State: "info"},
		{Key: "health-storage", Title: "Homelab: storage needs attention", Prio: "default", Opened: at(now, 3, 7, 30, 41),
			Resolved: res(at(now, 2, 7, 30, 38)), Sends: 1, State: "resolved"},
		{Key: "kuma-down", Title: "Uptime Kuma: Home Assistant is DOWN", Prio: "high", Opened: now.Add(-63 * time.Minute),
			Resolved: res(now.Add(-59 * time.Minute)), Sends: 1, State: "resolved"},
		{Key: "health-tls", Title: "Homelab: tls needs attention", Prio: "default", Opened: at(now, 6, 7, 30, 40),
			Resolved: res(at(now, 5, 4, 0, 12)), Sends: 1, State: "resolved"},
		{Key: "unit-failed-homelab-backup.service", Title: "homelab-backup.service failed on raspberrypi", Prio: "high",
			Opened: at(now, 9, 5, 2, 31), Resolved: res(at(now, 9, 5, 43, 2)), Sends: 1, State: "resolved"},
		{Key: "health-updates", Title: "Homelab: updates needs attention", Prio: "low", Opened: at(now, 12, 7, 30, 44),
			Resolved: res(at(now, 10, 7, 30, 39)), Sends: 1, Suppressed: 1, State: "resolved"},
		{Key: "netprobe-isp", Title: "Network: international packet loss 18%", Prio: "low", Opened: at(now, 13, 21, 4, 0),
			Resolved: res(at(now, 13, 22, 31, 0)), Sends: 1, State: "resolved"},
		{Key: "health-memory", Title: "Homelab: memory needs attention", Prio: "default", Opened: at(now, 17, 7, 30, 42),
			Resolved: res(at(now, 16, 7, 30, 40)), Sends: 1, State: "resolved"},
	}
	for d := 1; d < 14; d++ {
		if d%3 == 0 {
			in = append(in, snapshot.Incident{Key: "caretaker-morning", Title: "Caretaker: what I did", Prio: "low",
				Opened: at(now, d, 8, 12, 0), Resolved: res(at(now, d, 8, 12, 0)), Sends: 1, State: "info"})
		}
	}
	if g.Scenario == Attention {
		in = append(in, snapshot.Incident{Key: "health-config-drift", Title: "Homelab: config-drift needs attention", Prio: "low",
			Opened: at(now, 0, 7, 30, 44), Sends: 1, State: "open"})
	}
	if g.Scenario == Incident {
		in = append(in, snapshot.Incident{Key: "kuma-down-2", Title: "Uptime Kuma: Home Assistant is DOWN", Prio: "urgent",
			Opened: now.Add(-2 * time.Minute), Sends: 1, State: "open"})
	}
	sortIncidents(in)
	if at(now, 0, 8, 14, 0).After(now) {
		in = in[1:] // the morning note has not happened yet today
	}
	a := snapshot.Alerts{Incidents: in}
	for _, x := range in {
		if now.Sub(x.Opened) <= 24*time.Hour {
			a.Sent24h += x.Sends
		}
		if now.Sub(x.Opened) <= 7*24*time.Hour {
			a.Sent7d += x.Sends
		}
	}
	return a
}

func sortIncidents(in []snapshot.Incident) {
	for i := 1; i < len(in); i++ {
		for j := i; j > 0 && in[j].Opened.After(in[j-1].Opened); j-- {
			in[j], in[j-1] = in[j-1], in[j]
		}
	}
}

type timerDef struct {
	unit, desc string
	every      time.Duration // periodic, or 0 for a daily/weekly wall-clock time
	hh, mm     int
	weekday    int // -1 = daily
	highlight  bool
}

var timers = []timerDef{
	{"homelab-netprobe.timer", "Network probe: loss and latency to near and far targets", time.Minute, 0, 0, -1, true},
	{"kuma-wake.timer", "Wake the operator when Uptime Kuma marks a monitor down", time.Minute, 0, 0, -1, true},
	{"homelab-heartbeat.timer", "Dead-man switch ping, gated on Kuma and the health check", 5 * time.Minute, 0, 0, -1, true},
	{"claude-session-keepalive.timer", "Keep the operator session alive", 10 * time.Minute, 0, 0, -1, true},
	{"homelab-backup-push.timer", "Push the newest archives to the laptop when it is awake", 20 * time.Minute, 0, 0, -1, true},
	{"adguard-pin.timer", "Re-pin AdGuard's rewrite to the LAN address", time.Hour, 0, 0, -1, true},
	{"homelab-backup.timer", "Nightly homelab backups (the sets in backups.conf)", 0, 5, 0, -1, true},
	{"homelab-health.timer", "Daily health check for what Kuma cannot see", 0, 7, 30, -1, true},
	{"caretaker-tick.timer", "The operator's daily round", 0, 8, 10, -1, true},
	{"homelab-restore-test.timer", "Weekly restore drill: unpack every set into RAM and compare with live", 0, 5, 45, 0, true},
	{"tailscale-cert-renew.timer", "Renew the tailnet TLS certificate", 0, 4, 0, 1, true},
	{"apt-daily.timer", "Daily apt download activities", 0, 6, 12, -1, false},
	{"apt-daily-upgrade.timer", "Daily apt upgrade and clean activities", 0, 6, 40, -1, false},
	{"logrotate.timer", "Daily rotation of log files", 0, 0, 0, -1, false},
	{"man-db.timer", "Daily man-db regeneration", 0, 0, 21, -1, false},
	{"fstrim.timer", "Discard unused blocks once a week", 0, 0, 30, 1, false},
	{"systemd-tmpfiles-clean.timer", "Daily cleanup of temporary directories", 0, 3, 3, -1, false},
	{"e2scrub_all.timer", "Periodic ext4 online metadata check", 0, 3, 10, 0, false},
	{"kettle-descale.timer", "Remind the humans to descale the kettle", 0, 9, 0, 6, false},
}

func (g *Generator) timers(now time.Time) []snapshot.Timer {
	var out []snapshot.Timer
	for _, d := range timers {
		var last, next time.Time
		if d.every > 0 {
			step := d.every
			base := now.Truncate(step).Add(7 * time.Second)
			if base.After(now) {
				base = base.Add(-step)
			}
			last, next = base, base.Add(step)
		} else {
			days := 0
			for {
				c := at(now, days, d.hh, d.mm, 0)
				loc := time.FixedZone("UTC+3", 3*3600)
				if !c.After(now) && (d.weekday < 0 || int(c.In(loc).Weekday()) == d.weekday) {
					last = c
					break
				}
				days++
			}
			if d.weekday < 0 {
				next = last.Add(24 * time.Hour)
			} else {
				next = last.AddDate(0, 0, 7)
			}
		}
		l, n := last, next
		t := snapshot.Timer{Unit: d.unit, Activates: d.unit[:len(d.unit)-len(".timer")] + ".service", Description: d.desc,
			Next: &n, Last: &l, Result: "success", Enabled: "enabled", Highlight: d.highlight}
		if d.unit == "homelab-backup.timer" {
			for i := 0; i < 14; i++ {
				s := last.AddDate(0, 0, -i)
				r := snapshot.Run{Start: s, End: s.Add(time.Duration(140+i%5*7) * time.Second), Result: "success",
					Summary: "9 of 9 sets written, verified and pruned"}
				if i == 9 {
					r.Result, r.Summary = "failed", "[vaultwarden] required file is missing: rsa_key.pem - nothing pruned"
				}
				t.Runs = append(t.Runs, r)
			}
		}
		out = append(out, t)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Next.Before(*out[j-1].Next); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

func (g *Generator) drift(now time.Time) snapshot.Drift {
	c := now.Add(-time.Duration(now.Unix()%300) * time.Second)
	d := snapshot.Drift{Checked: &c, Result: "clean", Tracked: 52, Files: []snapshot.DriftFile{}, Disabled: []string{}}
	if g.Scenario == Attention {
		d.Result = "drift"
		d.Files = append(d.Files, snapshot.DriftFile{Path: "/etc/fail2ban/jail.local", State: "differs",
			Note: "maxretry = 3 live, 5 in the repo"})
	}
	return d
}

func (g *Generator) heartbeat(now time.Time) snapshot.Heartbeat {
	last := now.Truncate(5 * time.Minute).Add(7 * time.Second)
	if last.After(now) {
		last = last.Add(-5 * time.Minute)
	}
	return snapshot.Heartbeat{Unit: "homelab-heartbeat.service", Last: &last, OK: true, Pings24h: 288, Runs24h: 288}
}

func (g *Generator) health(now time.Time) snapshot.Health {
	last, _ := lastDaily(now, 7, 30)
	last = last.Add(44 * time.Second)
	h := snapshot.Health{Last: &last, Result: "all healthy - staying quiet"}
	for _, n := range []string{"backups", "mirror", "containers", "memory", "storage", "units", "reboot", "tls",
		"tailscale", "dns", "power", "homeassistant", "updates", "updates-watchtower", "reminders", "guards", "config-drift"} {
		c := snapshot.HealthCategory{Name: n}
		if g.Scenario == Attention && n == "config-drift" {
			c.Open, c.Prio = true, "low"
			t := last
			c.Since = &t
			h.Result = "1 problem(s) found"
		}
		h.Categories = append(h.Categories, c)
	}
	return h
}
