package snapshot

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 3, 10, 7, 42, 0, 0, time.UTC)

func tp(t time.Time) *time.Time { return &t }

func healthy() *Snapshot {
	temp := 52.0
	thr := "0x0"
	return &Snapshot{
		Schema: Schema, Generated: now, Title: "pi",
		Host:     Host{MemTotal: 8e9, MemAvail: 3e9, TempC: &temp, Throttled: &thr, Disks: []Disk{{Mount: "/", Size: 100, Used: 40}}},
		Services: []Service{{ID: "vault", Title: "Vaultwarden", State: "up"}, {ID: "old-job", Title: "old-job", State: "off"}},
		Backups: Backups{Sets: []BackupSet{{Name: "vault", MaxAgeH: 48, LastOK: tp(now.Add(-3 * time.Hour)), Bytes: 10}},
			Runs: []Run{{Result: "success"}}},
		Drill:     Drill{Runs: []DrillRun{{End: now.Add(-48 * time.Hour), Passed: 9}}},
		Alerts:    Alerts{Incidents: []Incident{{Key: "caretaker-morning", State: "info", Prio: "low"}}},
		Timers:    []Timer{{Unit: "homelab-backup.timer", Activates: "homelab-backup.service", Result: "success", Enabled: "enabled", Highlight: true}},
		Drift:     Drift{Result: "clean"},
		Heartbeat: Heartbeat{Unit: "hb.service", Last: tp(now.Add(-2 * time.Minute)), OK: true},
		Health:    Health{Last: tp(now.Add(-time.Hour)), Categories: []HealthCategory{{Name: "dns"}}},
		Runbooks:  []Runbook{{ID: "restore", Match: []string{"backups", "backup-*"}}, {ID: "dns", Match: []string{"vault"}}},
	}
}

func TestHealthyIsAllNormal(t *testing.T) {
	s := healthy()
	Finalize(s, now)
	if s.Status.Level != OK || s.Status.Headline != "All systems normal" || len(s.Status.Attention) != 0 {
		t.Fatalf("status %+v", s.Status)
	}
	if s.Services[1].Level != Off {
		t.Fatal("a stopped one-off job is off, not a problem")
	}
	if s.Backups.Bytes != 10 || s.Backups.Sets[0].Detail != "verified 3h ago" {
		t.Fatalf("backups %+v", s.Backups)
	}
}

func TestProblemsAreRankedAndLinked(t *testing.T) {
	s := healthy()
	s.Services[0].State = "down"
	s.Services[0].Detail = "unhealthy · 3 failed checks"
	s.Backups.Sets[0].LastOK = tp(now.Add(-50 * time.Hour))
	s.Drift = Drift{Result: "drift", Files: []DriftFile{{Path: "/etc/fail2ban/jail.local", State: "differs"}}}
	s.Alerts.Incidents = append(s.Alerts.Incidents, Incident{Key: "health-dns", Title: "Homelab: dns needs attention", Prio: "low", State: "open", Opened: now})
	Finalize(s, now)
	if s.Status.Level != Crit {
		t.Fatalf("level %s", s.Status.Level)
	}
	if got := len(s.Status.Attention); got != 3 {
		t.Fatalf("down service + stale backup + drift = 3 (a low alert is info), got %d: %+v", got, s.Status.Attention)
	}
	if s.Status.Attention[0].Level != Crit || s.Status.Attention[2].Level != Warn {
		t.Fatalf("worst first: %+v", s.Status.Attention)
	}
	if s.Status.Headline != "3 things need attention" {
		t.Fatalf("headline %q", s.Status.Headline)
	}
	for _, a := range s.Status.Attention {
		switch a.Area {
		case "services":
			if a.Runbook != "dns" {
				t.Errorf("service runbook by id: %+v", a)
			}
		case "backups":
			if a.Runbook != "restore" {
				t.Errorf("backup runbook by pattern: %+v", a)
			}
		}
	}
	if len(s.Alerts.Open) != 1 || s.Alerts.Level != Info {
		t.Fatalf("open alerts %+v level %s", s.Alerts.Open, s.Alerts.Level)
	}
}

func TestHostThresholds(t *testing.T) {
	s := healthy()
	hot, thr := 86.0, "0x50005"
	s.Host.TempC, s.Host.Throttled = &hot, &thr
	s.Host.MemAvail = 3e8
	s.Host.Disks[0].Used = 92
	Finalize(s, now)
	if s.Host.Level != Crit || len(s.Status.Attention) != 4 {
		t.Fatalf("temp, throttle, memory, disk: %+v", s.Status.Attention)
	}
}

func TestDrillAndHeartbeat(t *testing.T) {
	s := healthy()
	s.Drill.Runs[0].End = now.Add(-9 * 24 * time.Hour)
	s.Heartbeat.OK, s.Heartbeat.Reason = false, "uptime-kuma is 'unhealthy' - withholding heartbeat"
	Finalize(s, now)
	if s.Drill.Level != Warn || s.Heartbeat.Level != Crit {
		t.Fatalf("drill %s heartbeat %s", s.Drill.Level, s.Heartbeat.Level)
	}
	s = healthy()
	s.Drill.Runs[0].Failed = 1
	s.Timers[0].Enabled = "disabled"
	s.Maintenance = &Maintenance{Since: now}
	Finalize(s, now)
	if s.Drill.Level != Crit || s.Timers[0].Level != Warn {
		t.Fatalf("drill %s timer %s", s.Drill.Level, s.Timers[0].Level)
	}
	if s.Status.Headline != "Maintenance · 2 things need attention" {
		t.Fatalf("headline %q", s.Status.Headline)
	}
}

func TestAgo(t *testing.T) {
	for d, want := range map[time.Duration]string{30 * time.Second: "30s", 5 * time.Minute: "5m", 30 * time.Hour: "30h", 72 * time.Hour: "3d", -time.Second: "0s"} {
		if got := Ago(d); got != want {
			t.Errorf("Ago(%v) = %s, want %s", d, got, want)
		}
	}
}

func TestWriteReadAtomic(t *testing.T) {
	p := filepath.Join(t.TempDir(), "state.json")
	s := healthy()
	Finalize(s, now)
	if err := Write(p, s); err != nil {
		t.Fatal(err)
	}
	got, err := Read(p)
	if err != nil || got.Title != "pi" || got.Status.Level != OK {
		t.Fatalf("read back %+v %v", got, err)
	}
	s.Schema = 99
	_ = Write(p, s)
	if _, err := Read(p); err == nil {
		t.Fatal("a newer schema must be refused")
	}
}

// A quiet, empty snapshot must not put null where the UI expects a list.
func TestNoNullLists(t *testing.T) {
	for _, s := range []*Snapshot{{Schema: Schema, Generated: now}, healthy()} {
		Finalize(s, now)
		b, _ := json.Marshal(s)
		if strings.Contains(string(b), "null") {
			t.Fatalf("null in %s", b)
		}
	}
}
