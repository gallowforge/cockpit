package demo

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gallowforge/cockpit/internal/snapshot"
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
