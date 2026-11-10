package snapshot

import (
	"fmt"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Finalize derives every level and the overall status from the raw facts the
// collectors (or the demo generator) filled in. It is the only place where
// "is this a problem?" is decided, so the UI, `vesper check` and the tests all
// agree.
func Finalize(s *Snapshot, now time.Time) {
	defer normalize(s)
	var att []Attention
	add := func(level, area, ref, title, detail string, keys ...string) {
		if level != Warn && level != Crit {
			return
		}
		a := Attention{Level: level, Area: area, Ref: ref, Title: title, Detail: detail}
		a.Runbook = RunbookFor(s.Runbooks, append(keys, ref, area)...)
		att = append(att, a)
	}

	// host
	s.Host.Level = OK
	if t := s.Host.TempC; t != nil {
		switch {
		case *t >= 85:
			s.Host.Level = Crit
			add(Crit, "host", "temp", fmt.Sprintf("CPU at %.0f °C", *t), "Throttling starts at 85 °C.", "host-temp")
		case *t >= 80:
			s.Host.Level = Warn
			add(Warn, "host", "temp", fmt.Sprintf("CPU at %.0f °C", *t), "Running hot; throttling starts at 85 °C.", "host-temp")
		}
	}
	if th := s.Host.Throttled; th != nil {
		if v, err := strconv.ParseUint(strings.TrimPrefix(*th, "0x"), 16, 64); err == nil {
			switch {
			case v&0xF != 0:
				s.Host.Level = Worst(s.Host.Level, Crit)
				add(Crit, "host", "power", "Throttled right now", "get_throttled="+*th+": under-voltage or heat. Check the power supply.", "host-power")
			case v&0xF0000 != 0:
				s.Host.Level = Worst(s.Host.Level, Warn)
				add(Warn, "host", "power", "Throttled earlier this boot", "get_throttled="+*th+": check the power supply and cable.", "host-power")
			}
		}
	}
	if s.Host.MemTotal > 0 {
		pct := float64(s.Host.MemAvail) / float64(s.Host.MemTotal) * 100
		switch {
		case pct < 5:
			s.Host.Level = Worst(s.Host.Level, Crit)
			add(Crit, "host", "memory", fmt.Sprintf("Only %.0f%% memory available", pct), "", "host-memory")
		case pct < 10:
			s.Host.Level = Worst(s.Host.Level, Warn)
			add(Warn, "host", "memory", fmt.Sprintf("Only %.0f%% memory available", pct), "", "host-memory")
		}
	}
	for _, d := range s.Host.Disks {
		if d.Size <= 0 {
			continue
		}
		pct := float64(d.Used) / float64(d.Size) * 100
		switch {
		case pct >= 95:
			s.Host.Level = Worst(s.Host.Level, Crit)
			add(Crit, "host", "disk", fmt.Sprintf("%s is %.0f%% full", d.Mount, pct), "", "host-disk")
		case pct >= 90:
			s.Host.Level = Worst(s.Host.Level, Warn)
			add(Warn, "host", "disk", fmt.Sprintf("%s is %.0f%% full", d.Mount, pct), "", "host-disk")
		}
	}

	// services
	for i := range s.Services {
		sv := &s.Services[i]
		sv.Level = stateLevel(sv.State)
		if sv.Runbook == "" {
			sv.Runbook = RunbookFor(s.Runbooks, sv.ID, "services")
		}
		switch sv.Level {
		case Crit:
			add(Crit, "services", sv.ID, sv.Title+" is down", sv.Detail, sv.ID)
		case Warn:
			add(Warn, "services", sv.ID, sv.Title+" is degraded", sv.Detail, sv.ID)
		}
	}

	// backups
	s.Backups.Level = OK
	s.Backups.Bytes = 0
	for i := range s.Backups.Sets {
		b := &s.Backups.Sets[i]
		s.Backups.Bytes += b.Bytes
		limit := time.Duration(b.MaxAgeH) * time.Hour
		switch {
		case b.LastOK == nil:
			b.Level, b.Detail = Crit, "never verified"
		case limit > 0 && now.Sub(*b.LastOK) > limit:
			b.Level = Crit
			b.Detail = fmt.Sprintf("stale: verified %s ago, limit %dh", Ago(now.Sub(*b.LastOK)), b.MaxAgeH)
		default:
			b.Level = OK
			b.Detail = "verified " + Ago(now.Sub(*b.LastOK)) + " ago"
		}
		if b.Level != OK {
			add(b.Level, "backups", b.Name, "Backup set "+b.Name+" is "+firstWord(b.Detail), b.Detail, "backup-"+b.Name)
		}
		s.Backups.Level = Worst(s.Backups.Level, b.Level)
	}
	if n := len(s.Backups.Runs); n > 0 && s.Backups.Runs[0].Result == "failed" {
		s.Backups.Level = Crit
		r := s.Backups.Runs[0]
		add(Crit, "backups", "run", "Last backup run failed", r.Summary, "backup-run")
	}

	// restore drill
	switch {
	case len(s.Drill.Runs) == 0 && s.Drill.Unit == "":
		s.Drill.Level = Off // none is set up: nothing to expect
	case len(s.Drill.Runs) == 0:
		s.Drill.Level = Unknown
	default:
		r := s.Drill.Runs[0]
		s.Drill.Level = OK
		if r.Failed > 0 || r.Result == "failed" {
			s.Drill.Level = Crit
			add(Crit, "drill", "last", fmt.Sprintf("Restore drill: %d of %d sets failed", r.Failed, r.Passed+r.Failed),
				firstFailure(r), "drill")
		} else if age := now.Sub(r.End); age > 8*24*time.Hour {
			s.Drill.Level = Warn
			add(Warn, "drill", "last", "No restore drill for "+Ago(age), "The drill runs weekly.", "drill")
		}
	}

	// alerts
	s.Alerts.Level = OK
	s.Alerts.Open = []Incident{}
	failedSends := 0
	for i := range s.Alerts.Incidents {
		in := &s.Alerts.Incidents[i]
		if in.Runbook == "" {
			in.Runbook = RunbookFor(s.Runbooks, in.Key, "alerts")
		}
		if now.Sub(in.Opened) <= 24*time.Hour {
			failedSends += in.Failed
		}
		if in.State != "open" {
			continue
		}
		s.Alerts.Open = append(s.Alerts.Open, *in)
		l := PrioLevel(in.Prio)
		s.Alerts.Level = Worst(s.Alerts.Level, l)
		// one fault, one item: an alert that names a service already down or
		// degraded becomes evidence on that service instead of a second problem
		if j := foldInto(att, s.Services, in.Title); j >= 0 {
			att[j].Evidence = in.Title + ", open since " + Ago(now.Sub(in.Opened)) + " ago"
			continue
		}
		add(l, "alerts", in.Key, in.Title, "Open since "+Ago(now.Sub(in.Opened))+" ago", in.Key)
	}
	if failedSends > 0 {
		s.Alerts.Level = Worst(s.Alerts.Level, Warn)
		add(Warn, "alerts", "delivery", "Alerts may not reach your phone",
			fmt.Sprintf("%s failed to send in the last 24 hours.", plural(failedSends, "push", "pushes")), "alert-delivery", "alerts")
	}

	// timers
	for i := range s.Timers {
		t := &s.Timers[i]
		t.Level = OK
		if t.Result == "failed" {
			t.Level = Warn
			if t.Highlight {
				add(Warn, "timers", t.Unit, t.Activates+" failed on its last run", "", t.Unit, t.Activates)
			}
		}
		if t.Highlight && t.Enabled != "" && t.Enabled != "enabled" && t.Enabled != "static" {
			t.Level = Warn
			add(Warn, "timers", t.Unit, t.Unit+" is "+t.Enabled, "It will not start again after a reboot.", t.Unit)
		}
	}

	// drift
	switch s.Drift.Result {
	case "drift":
		s.Drift.Level = Warn
		add(Warn, "drift", "files", "Config drift: "+filesDiffer(len(s.Drift.Files)+len(s.Drift.Disabled))+" from the repo",
			driftDetail(s.Drift), "config-drift")
	case "clean":
		s.Drift.Level = OK
		if s.Drift.Uncommitted > 0 {
			s.Drift.Level = Info
		}
	default:
		s.Drift.Level = Unknown
	}

	// heartbeat
	hb := &s.Heartbeat
	switch {
	case hb.Unit == "":
		hb.Level = Off
	case hb.Last == nil:
		hb.Level = Unknown
	case !hb.OK:
		hb.Level = Crit
		add(Crit, "heartbeat", "withheld", "Heartbeat withheld", hb.Reason, "heartbeat")
	case now.Sub(*hb.Last) > 30*time.Minute:
		hb.Level = Warn
		add(Warn, "heartbeat", "late", "No heartbeat for "+Ago(now.Sub(*hb.Last)), "The dead-man switch will alert soon.", "heartbeat")
	default:
		hb.Level = OK
	}

	// daily health check
	h := &s.Health
	h.Level = OK
	if h.Unit == "" && h.Last == nil && len(h.Categories) == 0 {
		h.Level = Off // none is set up
	}
	for _, c := range h.Categories {
		if c.Open {
			h.Level = Worst(h.Level, PrioLevel(c.Prio))
		}
	}
	if h.Unit != "" && h.Last == nil {
		h.Level = Unknown
	}
	if h.Last != nil && now.Sub(*h.Last) > 29*time.Hour {
		h.Level = Worst(h.Level, Warn)
		add(Warn, "health", "late", "The daily health check has not run for "+Ago(now.Sub(*h.Last)), "", "health")
	}

	sort.SliceStable(att, func(i, j int) bool { return Rank(att[i].Level) > Rank(att[j].Level) })
	s.Status.Attention = att
	s.Status.Blind = blindSpots(s)
	s.Status.Level = OK
	for _, a := range att {
		s.Status.Level = Worst(s.Status.Level, a.Level)
	}
	// not knowing is never shown as fine
	if s.Status.Level == OK && len(s.Status.Blind) > 0 {
		s.Status.Level = Unknown
	}
	s.Status.Headline = headline(att, s.Status.Blind)
	if s.Maintenance != nil {
		s.Status.Headline = "Maintenance mode. " + s.Status.Headline
	}
}

// headline says the state of the server in one plain sentence.
func headline(att, blind []Attention) string {
	switch n := len(att); {
	case n == 0 && len(blind) == 0:
		return "Nothing needs you."
	case n == 0 && len(blind) == 1:
		return sentence(blind[0].Title)
	case n == 0:
		return fmt.Sprintf("Vesper can't see %d things.", len(blind))
	case n == 1:
		return sentence(att[0].Title)
	}
	return fmt.Sprintf("%d things need you.", len(att))
}

func sentence(s string) string {
	s = strings.TrimSpace(s)
	if s == "" || strings.HasSuffix(s, ".") || strings.HasSuffix(s, "?") || strings.HasSuffix(s, "!") {
		return s
	}
	return s + "."
}

// sourceTitles names, in plain words, what Vesper loses when a source fails.
var sourceTitles = map[string][3]string{
	"services": {"services", "Vesper can't read the service states", "Services can't be confirmed."},
	"timers":   {"timers", "Vesper can't read the timers", "Scheduled jobs can't be confirmed."},
	"journal":  {"backups", "Vesper can't read the journal", "Backup runs, restore drills and the heartbeat can't be confirmed."},
	"backups":  {"backups", "Vesper can't read the backup status", "Backups can't be confirmed as verified."},
	"alerts":   {"alerts", "Vesper can't read the alert history", "Open alerts can't be confirmed."},
	"drift":    {"drift", "Vesper can't check for config drift", "The live files can't be compared with the repo."},
	"host":     {"host", "Vesper can't read the host", "Temperature, memory and disks can't be confirmed."},
	"runbooks": {"runbooks", "Vesper can't copy the checklists", "Checklists may be out of date."},
}

// blindSpots lists what Vesper cannot see: every source that failed, every
// service it cannot confirm, and the checks that have nothing to go on yet.
func blindSpots(s *Snapshot) []Attention {
	out := []Attention{}
	byArea := map[string]int{}
	// put adds a blind spot, or folds it into the one already there for the area.
	// A failing source names the spot (its title wins); the raw error is kept as
	// evidence for the System page, the plain sentence is the detail.
	put := func(area, ref, title, detail, evidence string, names bool) {
		if i, ok := byArea[area]; ok {
			if names {
				out[i].Title, out[i].Ref = title, ref
			}
			if detail != "" && !strings.Contains(out[i].Detail, detail) {
				out[i].Detail = strings.TrimSpace(detail + " " + out[i].Detail)
			}
			if evidence != "" {
				out[i].Evidence = evidence
			}
			return
		}
		byArea[area] = len(out)
		out = append(out, Attention{Level: Unknown, Area: area, Ref: ref, Title: title, Detail: detail, Evidence: evidence})
	}
	var unknown []string
	for _, sv := range s.Services {
		if sv.State == "unknown" {
			unknown = append(unknown, sv.Title)
		}
	}
	if n := len(unknown); n > 0 {
		names := strings.Join(unknown, ", ")
		if n > 3 {
			names = strings.Join(unknown[:3], ", ") + fmt.Sprintf(" and %d more", n-3)
		}
		put("services", "unknown", fmt.Sprintf("Vesper can't confirm %s", plural(n, "service", "services")),
			fmt.Sprintf("%s can't be confirmed: %s.", plural(n, "service", "services"), names), "", false)
	}
	for _, src := range s.Sources {
		if src.OK {
			continue
		}
		t, ok := sourceTitles[src.Name]
		if !ok {
			t = [3]string{src.Name, "Vesper can't read " + src.Name, ""}
		}
		title := t[1]
		if src.Name == "services" && strings.Contains(strings.ToLower(src.Error), "docker") {
			title = "Vesper can't read Docker"
		}
		detail := t[2]
		if _, has := byArea[t[0]]; has {
			detail = "" // the area's own sentence already says what can't be confirmed
		}
		put(t[0], "source-"+src.Name, title, detail, firstLine(src.Error), true)
	}
	if s.Drift.Result != "clean" && s.Drift.Result != "drift" {
		put("drift", "manifest", "Vesper can't check for config drift", "The live files can't be compared with the repo.", firstLine(s.Drift.Error), false)
	}
	if s.Heartbeat.Unit != "" && s.Heartbeat.Last == nil {
		put("heartbeat", "none", "No heartbeat in the journal yet", "The dead-man switch has not pinged since the journal begins.", "", false)
	}
	if s.Drill.Unit != "" && len(s.Drill.Runs) == 0 {
		put("drill", "none", "No restore drill in the journal yet", "The drill runs weekly; until one has run, no backup has been proven restorable.", "", false)
	}
	if s.Health.Unit != "" && s.Health.Last == nil {
		put("health", "none", "No daily health check in the journal yet", "The checks Uptime Kuma can't make have not run since the journal begins.", "", false)
	}
	return out
}

func firstLine(s string) string {
	l, _, _ := strings.Cut(strings.TrimSpace(s), "\n")
	return l
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

// foldInto returns the index of the service item an alert is about, or -1.
// An alert is about a service when its title names the service and that
// service is already down or degraded.
func foldInto(att []Attention, svcs []Service, alertTitle string) int {
	t := strings.ToLower(alertTitle)
	for j, a := range att {
		if a.Area != "services" {
			continue
		}
		for _, sv := range svcs {
			if sv.ID == a.Ref && sv.Title != "" && strings.Contains(t, strings.ToLower(sv.Title)) {
				return j
			}
		}
	}
	return -1
}

func stateLevel(state string) string {
	switch state {
	case "up":
		return OK
	case "degraded":
		return Warn
	case "down":
		return Crit
	case "off":
		return Off
	}
	return Unknown
}

// PrioLevel maps an ntfy priority to a level.
func PrioLevel(prio string) string {
	switch prio {
	case "urgent", "high", "max", "5", "4":
		return Crit
	case "default", "3", "":
		return Warn
	}
	return Info
}

// RunbookFor returns the id of the first runbook whose patterns match any of
// the candidate names (alert keys, service ids, areas, unit names).
func RunbookFor(rbs []Runbook, candidates ...string) string {
	for _, rb := range rbs {
		for _, m := range rb.Match {
			for _, c := range candidates {
				if c == "" {
					continue
				}
				if ok, _ := path.Match(m, c); ok {
					return rb.ID
				}
			}
		}
	}
	return ""
}

// Ago renders a duration the way a person says it: 45s, 12m, 3h, 2d.
func Ago(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}

func firstWord(s string) string {
	w, _, _ := strings.Cut(s, ":")
	return w
}

func firstFailure(r DrillRun) string {
	for _, x := range r.Results {
		if !x.OK {
			return x.Set + ": " + x.Detail
		}
	}
	return ""
}

func driftDetail(d Drift) string {
	var parts []string
	for i, f := range d.Files {
		if i == 3 {
			parts = append(parts, fmt.Sprintf("and %d more", len(d.Files)-3))
			break
		}
		parts = append(parts, f.Path+" ("+f.State+")")
	}
	for _, t := range d.Disabled {
		parts = append(parts, t+" (disabled)")
	}
	return strings.Join(parts, ", ")
}

// normalize turns every nil list the UI reads into an empty one, so state.json
// never carries null where a list is expected (a quiet day has no attention
// items and no open alerts, and must still render).
func normalize(s *Snapshot) {
	if s.Status.Attention == nil {
		s.Status.Attention = []Attention{}
	}
	if s.Services == nil {
		s.Services = []Service{}
	}
	if s.Host.Disks == nil {
		s.Host.Disks = []Disk{}
	}
	if s.Backups.Sets == nil {
		s.Backups.Sets = []BackupSet{}
	}
	for i := range s.Backups.Sets {
		if s.Backups.Sets[i].Archives == nil {
			s.Backups.Sets[i].Archives = []Archive{}
		}
	}
	if s.Backups.Runs == nil {
		s.Backups.Runs = []Run{}
	}
	if s.Drill.Runs == nil {
		s.Drill.Runs = []DrillRun{}
	}
	for i := range s.Drill.Runs {
		if s.Drill.Runs[i].Results == nil {
			s.Drill.Runs[i].Results = []DrillResult{}
		}
	}
	if s.Alerts.Open == nil {
		s.Alerts.Open = []Incident{}
	}
	if s.Alerts.Incidents == nil {
		s.Alerts.Incidents = []Incident{}
	}
	if s.Timers == nil {
		s.Timers = []Timer{}
	}
	if s.Drift.Files == nil {
		s.Drift.Files = []DriftFile{}
	}
	if s.Drift.Disabled == nil {
		s.Drift.Disabled = []string{}
	}
	if s.Health.Categories == nil {
		s.Health.Categories = []HealthCategory{}
	}
	if s.Runbooks == nil {
		s.Runbooks = []Runbook{}
	}
	if s.Sources == nil {
		s.Sources = []Source{}
	}
}

// filesDiffer says "1 file differs" or "3 files differ".
func filesDiffer(n int) string {
	if n == 1 {
		return "1 file differs"
	}
	return fmt.Sprintf("%d files differ", n)
}

// FilesDiffer is filesDiffer for other packages (vesper check).
func FilesDiffer(n int) string { return filesDiffer(n) }
