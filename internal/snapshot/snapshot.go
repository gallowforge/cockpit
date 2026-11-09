// Package snapshot defines state.json: the one document the collector writes
// and the web UI, the CLI and the tests read. Times are RFC 3339 in UTC.
package snapshot

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Schema is bumped on any incompatible change to the JSON below.
const Schema = 1

// Levels, from best to worst. "off" is a deliberate stop (maintenance, a
// disabled unit) and never raises the overall status.
const (
	OK      = "ok"
	Info    = "info"
	Warn    = "warn"
	Crit    = "crit"
	Unknown = "unknown"
	Off     = "off"
)

// Rank orders levels for "worst of".
func Rank(level string) int {
	switch level {
	case Crit:
		return 4
	case Warn:
		return 3
	case Unknown:
		return 2
	case Info:
		return 1
	}
	return 0
}

// Worst returns the most severe of the given levels.
func Worst(levels ...string) string {
	w := OK
	for _, l := range levels {
		if Rank(l) > Rank(w) {
			w = l
		}
	}
	return w
}

type Snapshot struct {
	Schema      int          `json:"schema"`
	Generated   time.Time    `json:"generated"`
	Title       string       `json:"title"`
	Demo        bool         `json:"demo,omitempty"`
	Status      Status       `json:"status"`
	Host        Host         `json:"host"`
	Maintenance *Maintenance `json:"maintenance,omitempty"`
	Services    []Service    `json:"services"`
	Backups     Backups      `json:"backups"`
	Drill       Drill        `json:"drill"`
	Alerts      Alerts       `json:"alerts"`
	Timers      []Timer      `json:"timers"`
	Drift       Drift        `json:"drift"`
	Heartbeat   Heartbeat    `json:"heartbeat"`
	Health      Health       `json:"health"`
	Runbooks    []Runbook    `json:"runbooks"`
	Sources     []Source     `json:"sources"`
}

// Status is the rollup the Overview leads with.
type Status struct {
	Level     string      `json:"level"`
	Headline  string      `json:"headline"`
	Attention []Attention `json:"attention"`
	// Blind lists what Cockpit cannot see right now (a source it cannot read,
	// services it cannot confirm). Never empty-by-accident: a blind spot keeps
	// the status from reading all clear.
	Blind []Attention `json:"blind"`
}

// Attention is one thing that needs a look, worst first.
type Attention struct {
	Level   string `json:"level"`
	Area    string `json:"area"` // services, backups, drill, alerts, timers, drift, heartbeat, host
	Title   string `json:"title"`
	Detail  string `json:"detail,omitempty"`
	Ref     string `json:"ref,omitempty"` // id inside the area
	// Evidence is a related signal folded into this item instead of being
	// counted again (an alert about a service that is already down).
	Evidence string `json:"evidence,omitempty"`
	Runbook string `json:"runbook,omitempty"`
}

type Host struct {
	Name       string     `json:"name"`
	OS         string     `json:"os,omitempty"`
	Kernel     string     `json:"kernel,omitempty"`
	CPUs       int        `json:"cpus"`
	UptimeS    int64      `json:"uptime_s"`
	Load       [3]float64 `json:"load"`
	CPUPct     *float64   `json:"cpu_pct,omitempty"`
	MemTotal   int64      `json:"mem_total"`
	MemAvail   int64      `json:"mem_available"`
	SwapTotal  int64      `json:"swap_total"`
	SwapFree   int64      `json:"swap_free"`
	TempC      *float64   `json:"temp_c,omitempty"`
	Throttled  *string    `json:"throttled,omitempty"` // raw get_throttled value, e.g. 0x0
	Disks      []Disk     `json:"disks"`
	WritesGiBd *float64   `json:"writes_gib_day,omitempty"`
	Level      string     `json:"level"`
	History    []Sample   `json:"history,omitempty"` // cpu/mem over time
}

type Sample struct {
	T   time.Time `json:"t"`
	CPU float64   `json:"cpu"`
	Mem float64   `json:"mem"`
}

type Disk struct {
	Mount string `json:"mount"`
	Size  int64  `json:"size"`
	Used  int64  `json:"used"`
}

type Maintenance struct {
	Since time.Time `json:"since"`
}

// Service is one row: a container, a systemd unit and/or a probe.
type Service struct {
	ID       string     `json:"id"`
	Title    string     `json:"title"`
	Note     string     `json:"note,omitempty"`
	Group    string     `json:"group,omitempty"`
	Kind     string     `json:"kind"` // container, unit, probe
	State    string     `json:"state"`
	Level    string     `json:"level"`
	Detail   string     `json:"detail"`
	Since    *time.Time `json:"since,omitempty"`
	Image    string     `json:"image,omitempty"`
	Restarts int        `json:"restarts,omitempty"`
	URL      string     `json:"url,omitempty"`
	Runbook  string     `json:"runbook,omitempty"`
	Probe    *Probe     `json:"probe,omitempty"`
	// Beats is the recent state, oldest first: one char per sample,
	// u = up, d = degraded, x = down, o = off, ? = unknown.
	Beats string `json:"beats"`
}

type Probe struct {
	Target    string    `json:"target"`
	OK        bool      `json:"ok"`
	LatencyMS float64   `json:"latency_ms"`
	Code      int       `json:"code,omitempty"`
	Error     string    `json:"error,omitempty"`
	CertDays  *int      `json:"cert_days,omitempty"`
	Latencies []float64 `json:"latencies,omitempty"`
}

type Backups struct {
	Level string      `json:"level"`
	Sets  []BackupSet `json:"sets"`
	Runs  []Run       `json:"runs"`
	Bytes int64       `json:"bytes"` // newest archive of every set, summed
}

type BackupSet struct {
	Name     string         `json:"name"`
	Type     string         `json:"type"`
	Keep     int            `json:"keep"`
	MaxAgeH  int            `json:"max_age_h"`
	LastOK   *time.Time     `json:"last_ok,omitempty"`
	Bytes    int64          `json:"bytes"`
	Checks   map[string]int `json:"checks,omitempty"` // rows_<table>, members, ...
	Archives []Archive      `json:"archives"`
	Level    string         `json:"level"`
	Detail   string         `json:"detail"`
}

type Archive struct {
	Time  time.Time `json:"time"`
	Bytes int64     `json:"bytes"`
}

// Run is one invocation of a systemd service, read from the journal.
type Run struct {
	Unit    string    `json:"unit,omitempty"`
	Start   time.Time `json:"start"`
	End     time.Time `json:"end"`
	Result  string    `json:"result"` // success, failed, running
	Summary string    `json:"summary,omitempty"`
}

type Drill struct {
	Level string     `json:"level"`
	Runs  []DrillRun `json:"runs"`
}

type DrillRun struct {
	Start   time.Time     `json:"start"`
	End     time.Time     `json:"end"`
	Passed  int           `json:"passed"`
	Failed  int           `json:"failed"`
	Result  string        `json:"result"`
	Results []DrillResult `json:"results"`
}

type DrillResult struct {
	Set    string `json:"set"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

type Alerts struct {
	Level     string     `json:"level"`
	Open      []Incident `json:"open"`
	Incidents []Incident `json:"incidents"` // the timeline, newest first
	Sent24h   int        `json:"sent_24h"`
	Sent7d    int        `json:"sent_7d"`
}

type Incident struct {
	Key        string     `json:"key"`
	Title      string     `json:"title"`
	Prio       string     `json:"prio"` // min, low, default, high, urgent
	Opened     time.Time  `json:"opened"`
	Resolved   *time.Time `json:"resolved,omitempty"`
	Sends      int        `json:"sends"`
	Suppressed int        `json:"suppressed"`
	Failed     int        `json:"failed"`
	State      string     `json:"state"` // open, stale, resolved, info
	Runbook    string     `json:"runbook,omitempty"`
}

type Timer struct {
	Unit        string     `json:"unit"`
	Activates   string     `json:"activates"`
	Description string     `json:"description,omitempty"`
	Next        *time.Time `json:"next,omitempty"`
	Last        *time.Time `json:"last,omitempty"`
	Result      string     `json:"result,omitempty"` // success, failed, running, ""
	Enabled     string     `json:"enabled,omitempty"`
	Highlight   bool       `json:"highlight,omitempty"`
	Level       string     `json:"level"`
	Runs        []Run      `json:"runs,omitempty"`
}

type Drift struct {
	Level       string      `json:"level"`
	Checked     *time.Time  `json:"checked,omitempty"`
	Result      string      `json:"result"` // clean, drift, unknown
	Tracked     int         `json:"tracked"`
	Files       []DriftFile `json:"files"` // only the ones that differ
	Uncommitted int         `json:"uncommitted"`
	Disabled    []string    `json:"disabled_timers"`
	Error       string      `json:"error,omitempty"`
}

type DriftFile struct {
	Path  string `json:"path"`
	State string `json:"state"` // differs, missing, mode, owner, not-in-repo
	Note  string `json:"note,omitempty"`
}

type Heartbeat struct {
	Level    string     `json:"level"`
	Unit     string     `json:"unit,omitempty"`
	Last     *time.Time `json:"last,omitempty"`
	OK       bool       `json:"ok"`
	Reason   string     `json:"reason,omitempty"`
	Pings24h int        `json:"pings_24h"`
	Runs24h  int        `json:"runs_24h"`
}

type Health struct {
	Level      string           `json:"level"`
	Last       *time.Time       `json:"last,omitempty"`
	Result     string           `json:"result,omitempty"`
	Categories []HealthCategory `json:"categories"`
}

type HealthCategory struct {
	Name  string     `json:"name"`
	Open  bool       `json:"open"`
	Since *time.Time `json:"since,omitempty"`
	Prio  string     `json:"prio,omitempty"`
}

type Runbook struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	URL   string   `json:"url,omitempty"`
	Local bool     `json:"local,omitempty"`
	Match []string `json:"match,omitempty"`
	Bytes int      `json:"bytes,omitempty"`
}

// Source reports how each collector fared on its last run.
type Source struct {
	Name       string    `json:"name"`
	OK         bool      `json:"ok"`
	Error      string    `json:"error,omitempty"`
	At         time.Time `json:"at"`
	DurationMS float64   `json:"duration_ms"`
}

// Write stores s at p atomically (write a temp file, then rename), so a reader
// never sees half a document.
func Write(p string, s *Snapshot) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return WriteBytes(p, b)
}

// WriteBytes is Write for an already-encoded document.
func WriteBytes(p string, b []byte) error {
	dir := filepath.Dir(p)
	tmp, err := os.CreateTemp(dir, ".state-*.json")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, p)
}

// Read loads a snapshot and checks its schema.
func Read(p string) (*Snapshot, error) {
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var s Snapshot
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, fmt.Errorf("%s: %w", p, err)
	}
	if s.Schema != Schema {
		return nil, fmt.Errorf("%s: schema %d, this build reads %d", p, s.Schema, Schema)
	}
	return &s, nil
}
