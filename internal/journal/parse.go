package journal

import (
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gallowforge/cockpit/internal/redact"
	"github.com/gallowforge/cockpit/internal/snapshot"
)

// Runs groups entries by invocation into runs of unit, newest first.
// Lines from other units (when one query matched several) are skipped.
func Runs(entries []Entry, unit string, active bool) []snapshot.Run {
	type acc struct {
		run      snapshot.Run
		lastOut  string
		firstBad string
		ok, bad  bool
	}
	var order []string
	groups := map[string]*acc{}
	for _, e := range entries {
		if e.Invocation == "" || (unit != "" && e.Unit != unit) {
			continue
		}
		g, ok := groups[e.Invocation]
		if !ok {
			g = &acc{run: snapshot.Run{Unit: e.Unit, Start: e.Time}}
			groups[e.Invocation] = g
			order = append(order, e.Invocation)
		}
		g.run.End = e.Time
		m := e.Message
		if e.FromPID1 {
			switch {
			case e.JobResult == "done", strings.HasSuffix(m, ": Deactivated successfully."):
				g.ok = true
			case e.JobResult == "failed", strings.Contains(m, ": Failed with result"),
				strings.Contains(m, "status=") && strings.Contains(m, "FAILURE"):
				g.bad = true
				if g.firstBad == "" {
					g.firstBad = strings.TrimPrefix(m, unit+": ")
				}
			}
			continue
		}
		if strings.TrimSpace(m) != "" {
			g.lastOut = m
			if g.firstBad == "" && looksBad(m) {
				g.firstBad = m
			}
		}
	}
	out := make([]snapshot.Run, 0, len(order))
	for i, inv := range order {
		g := groups[inv]
		switch {
		case g.bad:
			g.run.Result = "failed"
			g.run.Summary = redact.Line(firstNonEmpty(g.firstBad, g.lastOut), 180)
		case g.ok:
			g.run.Result = "success"
			g.run.Summary = redact.Line(g.lastOut, 180)
		case i == len(order)-1 && active:
			g.run.Result = "running"
			g.run.Summary = redact.Line(g.lastOut, 180)
		default:
			g.run.Result = "unknown"
			g.run.Summary = redact.Line(g.lastOut, 180)
		}
		out = append(out, g.run)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start.After(out[j].Start) })
	return out
}

var badWords = regexp.MustCompile(`(?i)\b(fail(ed|ure)?|error|fatal|missing|refus(ed|ing)|cannot|could not|denied|not found|nothing pruned)\b`)

func looksBad(s string) bool {
	if strings.HasPrefix(s, "PASS ") || strings.Contains(s, " 0 failed") {
		return false
	}
	return badWords.MatchString(s)
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

var (
	drillLine    = regexp.MustCompile(`^(PASS|FAIL) ([A-Za-z0-9_.@-]+): (.*)$`)
	drillSummary = regexp.MustCompile(`restore test: (\d+) passed, (\d+) failed`)
)

// DrillRuns reads the weekly restore drill's PASS/FAIL report, newest first.
func DrillRuns(entries []Entry, unit string) []snapshot.DrillRun {
	runs := Runs(entries, unit, false)
	byStart := map[time.Time]*snapshot.DrillRun{}
	var out []snapshot.DrillRun
	for _, r := range runs {
		out = append(out, snapshot.DrillRun{Start: r.Start, End: r.End, Result: r.Result})
	}
	for i := range out {
		byStart[out[i].Start] = &out[i]
	}
	// second pass: attach the lines to their run by invocation
	inv := map[string]time.Time{}
	for _, e := range entries {
		if e.Invocation == "" || (unit != "" && e.Unit != unit) {
			continue
		}
		if _, ok := inv[e.Invocation]; !ok {
			inv[e.Invocation] = e.Time
		}
		d := byStart[inv[e.Invocation]]
		if d == nil || e.FromPID1 {
			continue
		}
		if m := drillLine.FindStringSubmatch(e.Message); m != nil {
			d.Results = append(d.Results, snapshot.DrillResult{Set: m[2], OK: m[1] == "PASS", Detail: redact.Line(m[3], 220)})
			continue
		}
		if m := drillSummary.FindStringSubmatch(e.Message); m != nil {
			d.Passed, _ = strconv.Atoi(m[1])
			d.Failed, _ = strconv.Atoi(m[2])
		}
	}
	for i := range out {
		d := &out[i]
		if d.Passed == 0 && d.Failed == 0 {
			for _, r := range d.Results {
				if r.OK {
					d.Passed++
				} else {
					d.Failed++
				}
			}
		}
		if d.Failed > 0 {
			d.Result = "failed"
		}
	}
	// drop runs that never produced a report (e.g. a start that was cancelled)
	kept := out[:0]
	for _, d := range out {
		if len(d.Results) > 0 || d.Passed+d.Failed > 0 || d.Result == "failed" {
			kept = append(kept, d)
		}
	}
	return kept
}

// Event is one line of homelab-notify's log.
type Event struct {
	Time  time.Time
	Verb  string // sent, failed, resolved, resolve-failed, suppressed, closed
	Key   string
	Prio  string
	Title string
}

var (
	kvKey   = regexp.MustCompile(`\bkey=([A-Za-z0-9_.@:-]+)`)
	kvPrio  = regexp.MustCompile(`\bprio=([a-z0-9]+)`)
	kvTitle = regexp.MustCompile(`\btitle="(.*?)"(?: http=| \(|$)`)
)

// ParseNotify turns homelab-notify log lines into events. Lines it does not
// recognise are ignored.
func ParseNotify(entries []Entry) []Event {
	var out []Event
	for _, e := range entries {
		m := e.Message
		verb, rest, _ := strings.Cut(m, " ")
		ev := Event{Time: e.Time}
		switch verb {
		case "sent":
			ev.Verb = "sent"
		case "resolved":
			ev.Verb = "resolved"
		case "suppressed":
			ev.Verb = "suppressed"
		case "closed":
			ev.Verb = "closed"
		case "FAILED":
			ev.Verb = "failed"
			if strings.HasPrefix(rest, "all-clear") {
				ev.Verb = "resolve-failed"
			}
		default:
			continue
		}
		if k := kvKey.FindStringSubmatch(m); k != nil {
			ev.Key = k[1]
		}
		if p := kvPrio.FindStringSubmatch(m); p != nil {
			ev.Prio = p[1]
		}
		if t := kvTitle.FindStringSubmatch(m); t != nil {
			ev.Title = redact.Line(t[1], 140)
		}
		out = append(out, ev)
	}
	return out
}

// NotifyState is one file in homelab-notify's state directory: an incident
// that has been opened and not yet resolved.
type NotifyState struct {
	Key     string
	Opened  time.Time
	LastOK  time.Time
	LastTry time.Time
}

// Incidents builds the alert timeline from events plus the current state
// files. infoKeys are periodic notes (never "open"); window decides when an
// unresolved incident whose push has not repeated is called stale.
func Incidents(events []Event, states []NotifyState, infoKeys []string, window time.Duration, now time.Time) []snapshot.Incident {
	var list []*snapshot.Incident
	open := map[string]*snapshot.Incident{}
	for _, ev := range events {
		if ev.Key == "" {
			if ev.Verb == "sent" || ev.Verb == "failed" {
				t := ev.Time
				in := &snapshot.Incident{Title: ev.Title, Prio: ev.Prio, Opened: ev.Time, Resolved: &t, State: "sent", Sends: 1}
				if ev.Verb == "failed" {
					in.Sends, in.Failed = 0, 1
				}
				list = append(list, in)
			}
			continue
		}
		in := open[ev.Key]
		switch ev.Verb {
		case "sent", "failed":
			if in == nil {
				in = &snapshot.Incident{Key: ev.Key, Title: ev.Title, Prio: ev.Prio, Opened: ev.Time, State: "open"}
				open[ev.Key] = in
				list = append(list, in)
			}
			if ev.Verb == "sent" {
				in.Sends++
			} else {
				in.Failed++
			}
			if ev.Title != "" {
				in.Title = ev.Title
			}
			if rankPrio(ev.Prio) > rankPrio(in.Prio) {
				in.Prio = ev.Prio
			}
		case "suppressed":
			if in == nil {
				in = &snapshot.Incident{Key: ev.Key, Title: ev.Title, Opened: ev.Time, State: "open"}
				open[ev.Key] = in
				list = append(list, in)
			}
			in.Suppressed++
		case "resolved", "closed":
			if in != nil {
				t := ev.Time
				in.Resolved = &t
				in.State = "resolved"
				delete(open, ev.Key)
			}
		case "resolve-failed":
			if in != nil {
				in.Failed++
			}
		}
	}
	live := map[string]NotifyState{}
	for _, st := range states {
		live[st.Key] = st
	}
	// incidents still open in the log: the state file decides
	for k, in := range open {
		st, ok := live[k]
		if !ok {
			// resolved outside the window we read, or the state was cleared
			in.State = "resolved"
			continue
		}
		in.State = openOrStale(st, window, now)
	}
	// open incidents older than the log window come from the state files alone
	for _, st := range states {
		if _, seen := open[st.Key]; seen {
			continue
		}
		in := &snapshot.Incident{Key: st.Key, Title: humanKey(st.Key), Opened: st.Opened, State: openOrStale(st, window, now), Sends: 1}
		list = append(list, in)
	}
	out := make([]snapshot.Incident, 0, len(list))
	for _, in := range list {
		if in.Key != "" && matchesAny(infoKeys, in.Key) && in.State != "resolved" {
			in.State = "info"
		}
		if in.Title == "" {
			in.Title = humanKey(in.Key)
		}
		out = append(out, *in)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Opened.After(out[j].Opened) })
	return out
}

func openOrStale(st NotifyState, window time.Duration, now time.Time) string {
	last := st.LastOK
	if st.LastTry.After(last) {
		last = st.LastTry
	}
	if last.IsZero() {
		last = st.Opened
	}
	if window > 0 && now.Sub(last) > window {
		return "stale"
	}
	return "open"
}

func rankPrio(p string) int {
	switch p {
	case "min", "1":
		return 1
	case "low", "2":
		return 2
	case "default", "3":
		return 3
	case "high", "4":
		return 4
	case "urgent", "max", "5":
		return 5
	}
	return 0
}

var pathMatch = path.Match

func matchesAny(patterns []string, s string) bool {
	for _, p := range patterns {
		if ok, _ := pathMatch(p, s); ok {
			return true
		}
	}
	return false
}

// humanKey turns "health-storage" into "Health: storage".
func humanKey(k string) string {
	if k == "" {
		return "Notification"
	}
	head, tail, ok := strings.Cut(k, "-")
	if !ok {
		return strings.ToUpper(k[:1]) + k[1:]
	}
	return strings.ToUpper(head[:1]) + head[1:] + ": " + strings.ReplaceAll(tail, "-", " ")
}
