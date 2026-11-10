package journal

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 3, 8, 2, 45, 0, 0, time.UTC)

// line builds one journalctl -o json record.
func line(at time.Time, msg string, kv ...string) string {
	m := map[string]any{"__REALTIME_TIMESTAMP": fmt.Sprint(at.UnixMicro()), "MESSAGE": msg, "__CURSOR": fmt.Sprintf("c-%d", at.UnixNano())}
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func svc(at time.Time, unit, inv, msg string) string {
	return line(at, msg, "_SYSTEMD_UNIT", unit, "_SYSTEMD_INVOCATION_ID", inv, "_PID", "4242")
}

func pid1(at time.Time, unit, inv, msg, job string) string {
	kv := []string{"UNIT", unit, "INVOCATION_ID", inv, "_PID", "1"}
	if job != "" {
		kv = append(kv, "JOB_RESULT", job)
	}
	return line(at, msg, kv...)
}

func mustParse(t *testing.T, lines ...string) []Entry {
	t.Helper()
	es, err := Parse([]byte(strings.Join(lines, "\n")))
	if err != nil {
		t.Fatal(err)
	}
	return es
}

func TestParseByteArrayMessage(t *testing.T) {
	// journalctl encodes non-UTF-8 messages as arrays of bytes
	es := mustParse(t, `{"__REALTIME_TIMESTAMP":"1000000","MESSAGE":[104,105]}`)
	if len(es) != 1 || es[0].Message != "hi" || !es[0].Time.Equal(time.UnixMicro(1000000)) {
		t.Fatalf("got %+v", es)
	}
}

func TestRunsGroupsInvocations(t *testing.T) {
	u := "homelab-backup.service"
	es := mustParse(t,
		svc(t0, u, "a", "[adguard] written, verified"),
		svc(t0.Add(time.Minute), u, "a", "12 of 12 sets written, verified and pruned"),
		pid1(t0.Add(61*time.Second), u, "a", u+": Deactivated successfully.", ""),
		pid1(t0.Add(61*time.Second), u, "a", "Finished "+u+".", "done"),
		svc(t0.Add(24*time.Hour), u, "b", "[vaultwarden] required file is missing: rsa_key.pem - nothing pruned"),
		svc(t0.Add(24*time.Hour+time.Second), u, "b", "1 set(s) failed"),
		pid1(t0.Add(24*time.Hour+2*time.Second), u, "b", u+": Main process exited, code=exited, status=1/FAILURE", ""),
		pid1(t0.Add(24*time.Hour+2*time.Second), u, "b", u+": Failed with result 'exit-code'.", ""),
		svc(t0.Add(48*time.Hour), "other.service", "z", "not ours"),
	)
	runs := Runs(es, u, false)
	if len(runs) != 2 {
		t.Fatalf("want 2 runs, got %d: %+v", len(runs), runs)
	}
	if runs[0].Result != "failed" || !strings.Contains(runs[0].Summary, "rsa_key.pem") {
		t.Fatalf("newest run should be the failure with its cause: %+v", runs[0])
	}
	if runs[1].Result != "success" || runs[1].Summary != "12 of 12 sets written, verified and pruned" {
		t.Fatalf("older run: %+v", runs[1])
	}
	if d := runs[1].End.Sub(runs[1].Start); d != 61*time.Second {
		t.Fatalf("duration %v", d)
	}
}

func TestRunsRunning(t *testing.T) {
	u := "x.service"
	es := mustParse(t, svc(t0, u, "a", "working"))
	if r := Runs(es, u, true); r[0].Result != "running" {
		t.Fatalf("an unfinished newest run of an active unit is running: %+v", r)
	}
	if r := Runs(es, u, false); r[0].Result != "unknown" {
		t.Fatalf("otherwise unknown: %+v", r)
	}
}

func TestDrillRuns(t *testing.T) {
	u := "homelab-restore-test.service"
	es := mustParse(t,
		svc(t0, u, "w1", "PASS adguard: AdGuardHome.yaml present with http/dns sections"),
		svc(t0.Add(time.Second), u, "w1", "FAIL vaultwarden: rsa_key.pem differs from live"),
		svc(t0.Add(2*time.Second), u, "w1", "restore test: 1 passed, 1 failed (restored copies in /dev/shm/restore-test deleted)"),
		pid1(t0.Add(2*time.Second), u, "w1", u+": Failed with result 'exit-code'.", ""),
		svc(t0.Add(7*24*time.Hour), u, "w2", "PASS adguard: ok"),
		svc(t0.Add(7*24*time.Hour), u, "w2", "PASS vaultwarden: integrity_check ok, ciphers=412 (live now 412)"),
		svc(t0.Add(7*24*time.Hour+time.Second), u, "w2", "restore test: 2 passed, 0 failed (restored copies in /dev/shm/restore-test deleted)"),
		pid1(t0.Add(7*24*time.Hour+time.Second), u, "w2", u+": Deactivated successfully.", ""),
	)
	d := DrillRuns(es, u)
	if len(d) != 2 {
		t.Fatalf("want 2 drills, got %+v", d)
	}
	if d[0].Passed != 2 || d[0].Failed != 0 || d[0].Result != "success" || len(d[0].Results) != 2 {
		t.Fatalf("newest drill: %+v", d[0])
	}
	if d[1].Failed != 1 || d[1].Result != "failed" || d[1].Results[1].OK || d[1].Results[1].Set != "vaultwarden" {
		t.Fatalf("older drill: %+v", d[1])
	}
}

func notify(at time.Time, msg string) string {
	return line(at, msg, "SYSLOG_IDENTIFIER", "homelab-notify")
}

func TestIncidents(t *testing.T) {
	es := mustParse(t,
		notify(t0, `sent prio=high key=unit-failed-homelab-backup.service title="homelab-backup.service failed on raspberrypi" http=200 attempts=1`),
		notify(t0.Add(40*time.Minute), `resolved key=unit-failed-homelab-backup.service prio=default title="homelab-backup.service OK again" http=200 attempts=1`),
		notify(t0.Add(time.Hour), `sent prio=default key=health-storage title="Homelab: storage needs attention" http=200 attempts=1`),
		notify(t0.Add(2*time.Hour), `suppressed key=health-storage title="Homelab: storage needs attention" (already sent 60 min ago; repeat every 20h)`),
		notify(t0.Add(3*time.Hour), `sent prio=low title="Caretaker: what I did" http=200 attempts=1`),
		notify(t0.Add(4*time.Hour), `FAILED prio=low key=operator-report title="Operator: the morning report" http=000 attempts=3`),
		notify(t0.Add(5*time.Hour), `something unrelated`),
	)
	ev := ParseNotify(es)
	if len(ev) != 6 {
		t.Fatalf("want 6 events, got %d: %+v", len(ev), ev)
	}
	now := t0.Add(6 * time.Hour)
	states := []NotifyState{
		{Key: "health-storage", Opened: t0.Add(time.Hour), LastOK: t0.Add(time.Hour)},
		{Key: "operator-report", Opened: t0.Add(4 * time.Hour), LastTry: t0.Add(4 * time.Hour)},
		{Key: "health-reboot", Opened: t0.Add(-30 * 24 * time.Hour), LastOK: t0.Add(-30 * 24 * time.Hour)},
	}
	inc := Incidents(ev, states, []string{"operator-*"}, 8*24*time.Hour, now)
	by := map[string]string{}
	for _, i := range inc {
		by[i.Key+"|"+i.Title] = i.State
	}
	want := map[string]string{
		"unit-failed-homelab-backup.service|homelab-backup.service failed on raspberrypi": "resolved",
		"health-storage|Homelab: storage needs attention":                                 "open",
		"|Caretaker: what I did":                       "sent",
		"operator-report|Operator: the morning report": "info",
		"health-reboot|Health: reboot":                 "stale",
	}
	for k, v := range want {
		if by[k] != v {
			t.Errorf("%s: state %q, want %q (all: %v)", k, by[k], v, by)
		}
	}
	for _, i := range inc {
		if i.Key == "health-storage" && (i.Sends != 1 || i.Suppressed != 1 || i.Prio != "default") {
			t.Errorf("counts: %+v", i)
		}
		if i.Key == "unit-failed-homelab-backup.service" && (i.Resolved == nil || i.Resolved.Sub(i.Opened) != 40*time.Minute || i.Prio != "high") {
			t.Errorf("the all-clear must not lower the incident's priority: %+v", i)
		}
	}
	for j := 1; j < len(inc); j++ {
		if inc[j].Opened.After(inc[j-1].Opened) {
			t.Fatal("incidents must be newest first")
		}
	}
}

func TestIncidentResolvedOutsideWindow(t *testing.T) {
	ev := ParseNotify(mustParse(t, notify(t0, `sent prio=default key=health-tls title="Homelab: tls needs attention" http=200 attempts=1`)))
	inc := Incidents(ev, nil, nil, time.Hour, t0.Add(time.Hour))
	if inc[0].State != "resolved" {
		t.Fatalf("no state file means it was resolved: %+v", inc[0])
	}
}

func TestTailReadsOnlyNewEntries(t *testing.T) {
	var calls [][]string
	batches := [][]string{
		{svc(t0, "u", "a", "one"), svc(t0.Add(time.Minute), "u", "a", "two")},
		{svc(t0.Add(2*time.Minute), "u", "a", "three")},
	}
	tail := &Tail{Match: []string{"-u", "u"}, Window: time.Hour, Run: func(_ context.Context, args []string) ([]byte, error) {
		calls = append(calls, args)
		b := batches[0]
		batches = batches[1:]
		return []byte(strings.Join(b, "\n")), nil
	}}
	if err := tail.Update(context.Background(), t0.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := tail.Update(context.Background(), t0.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if len(tail.Entries()) != 3 {
		t.Fatalf("want 3 entries, got %d", len(tail.Entries()))
	}
	if !strings.HasPrefix(strings.Join(calls[0], " "), "--no-pager -o json") || !containsPrefix(calls[0], "--since=@") {
		t.Fatalf("first read must use --since: %v", calls[0])
	}
	if !containsPrefix(calls[1], "--after-cursor=") {
		t.Fatalf("second read must continue from the cursor: %v", calls[1])
	}
	// the window drops old entries
	tail.Run = func(context.Context, []string) ([]byte, error) { return nil, nil }
	if err := tail.Update(context.Background(), t0.Add(60*time.Minute+30*time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(tail.Entries()) != 2 {
		t.Fatalf("entries older than the window should go, have %d", len(tail.Entries()))
	}
}

func containsPrefix(args []string, p string) bool {
	for _, a := range args {
		if strings.HasPrefix(a, p) {
			return true
		}
	}
	return false
}
