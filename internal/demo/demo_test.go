package demo

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gallowforge/vesper/internal/snapshot"
)

var clockAt = time.Date(2026, 3, 10, 7, 42, 0, 0, time.UTC)

func TestScenarios(t *testing.T) {
	for scen, want := range map[string]string{Calm: snapshot.OK, Attention: snapshot.Warn, Incident: snapshot.Crit, Blind: snapshot.Unknown} {
		s := (&Generator{Scenario: scen}).Snapshot(clockAt)
		if s.Status.Level != want {
			t.Errorf("%s: level %s, want %s (%+v)", scen, s.Status.Level, want, s.Status.Attention)
		}
		if s.Schema != snapshot.Schema || !s.Demo || len(s.Services) == 0 || len(s.Backups.Sets) != 9 || len(s.Timers) < 10 {
			t.Errorf("%s: incomplete snapshot", scen)
		}
	}
}

// The incident's alert names the service that is down, so it is one problem.
func TestIncidentFoldsItsAlert(t *testing.T) {
	s := (&Generator{Scenario: Incident}).Snapshot(clockAt)
	for _, a := range s.Status.Attention {
		if a.Area == "alerts" && strings.Contains(a.Title, "Home Assistant") {
			t.Fatalf("the Kuma alert should fold into the service: %+v", s.Status.Attention)
		}
	}
	if s.Status.Attention[0].Ref != "homeassistant" || s.Status.Attention[0].Evidence == "" {
		t.Fatalf("first item %+v", s.Status.Attention[0])
	}
}

func TestDeterministic(t *testing.T) {
	a, _ := json.Marshal((&Generator{Scenario: Attention}).Snapshot(clockAt))
	b, _ := json.Marshal((&Generator{Scenario: Attention}).Snapshot(clockAt))
	if string(a) != string(b) {
		t.Fatal("the same clock must give the same snapshot")
	}
}

func TestTimersAreInTheFuture(t *testing.T) {
	for _, tm := range (&Generator{}).Snapshot(clockAt).Timers {
		if tm.Next == nil || !tm.Next.After(clockAt) || tm.Last == nil || tm.Last.After(clockAt) {
			t.Errorf("%s: last %v next %v around %v", tm.Unit, tm.Last, tm.Next, clockAt)
		}
	}
}

// The demo ships in a public repo: nothing in it may look like a real address,
// account or secret.
func TestDemoDataIsObviouslyFake(t *testing.T) {
	b, _ := json.Marshal((&Generator{Scenario: Incident}).Snapshot(clockAt))
	s := string(b)
	for _, re := range []string{`192\.168\.(?:[02-9]|\d{2,})\.`, `\b100\.(?:6[5-9]|[7-9]\d|1[01]\d|12[0-7])\.`, `@[a-z0-9-]+\.(com|net|org)`} {
		if m := regexp.MustCompile(re).FindString(s); m != "" {
			t.Errorf("demo data contains %q", m)
		}
	}
	if !strings.Contains(s, "example-tailnet.ts.net") {
		t.Error("service links should use the placeholder tailnet")
	}
}

func TestWriteRunbooks(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "rb")
	if err := WriteRunbooks(dir); err != nil {
		t.Fatal(err)
	}
	for _, rb := range Runbooks() {
		if _, err := os.Stat(filepath.Join(dir, rb.ID+".md")); err != nil {
			t.Errorf("%s: %v", rb.ID, err)
		}
	}
}

// The day line covers 24 hours and tells the same story as the alerts.
func TestDayLine(t *testing.T) {
	day := func(scen, id string) string {
		for _, sv := range (&Generator{Scenario: scen}).Snapshot(clockAt).Services {
			if sv.ID == id {
				return sv.Day
			}
		}
		t.Fatalf("%s: no service %s", scen, id)
		return ""
	}
	calm := day(Calm, "homeassistant")
	// 06:39 to 06:43 straddles a slot boundary, so the blip marks two slots
	if len(calm) != snapshot.DaySlots || strings.Count(calm, "x") != 2 || calm[len(calm)-1] != 'u' {
		t.Errorf("calm: one blip an hour ago and up now, got %q", calm[len(calm)-20:])
	}
	if inc := day(Incident, "homeassistant"); inc[len(inc)-1] != 'x' {
		t.Errorf("incident: down now, got %q", inc[len(inc)-5:])
	}
	if b := day(Blind, "vaultwarden"); b[len(b)-1] != '?' {
		t.Errorf("blind: a container is unknown now, got %q", b[len(b)-5:])
	}
	if b := day(Blind, "tailscale"); strings.Contains(b, "?") {
		t.Errorf("blind: a systemd unit is still seen, got %q", b[len(b)-5:])
	}
}
