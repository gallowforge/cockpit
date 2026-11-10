// Package collect gathers the homelab's state into a snapshot. It only reads:
// files, the journal, `systemctl show`, Docker's API with GET requests, and
// the endpoints listed as probes.
package collect

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gallowforge/cockpit/internal/config"
	"github.com/gallowforge/cockpit/internal/journal"
	"github.com/gallowforge/cockpit/internal/snapshot"
)

// CmdRunner runs a command and returns its stdout.
type CmdRunner func(ctx context.Context, name string, args ...string) ([]byte, error)

// ExecCmd is the real CmdRunner.
func ExecCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(os.Environ(), "LC_ALL=C", "SYSTEMD_COLORS=0", "GIT_OPTIONAL_LOCKS=0")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 160 {
			msg = msg[:160]
		}
		return out, fmt.Errorf("%s: %v %s", name, err, msg)
	}
	return out, nil
}

// Collector holds the configuration and the in-memory history between ticks.
type Collector struct {
	Cfg     *config.Config
	Root    string // prefix for every file path; "" in production
	Cmd     CmdRunner
	Journal journal.Runner
	Now     func() time.Time
	Log     *log.Logger

	docker     *dockerClient
	host       hostState
	writesEWMA *float64
	beats      map[string]string
	day        map[string]*dayLine
	lat        map[string][]float64
	hostHist   []snapshot.Sample
	restarts   map[string][]restartMark

	tails    map[string]*journal.Tail
	slow     slowData
	lastSlow time.Time
	lastErr  map[string]string
	stopping atomic.Bool
}

type restartMark struct {
	t     time.Time
	count int
}

type slowData struct {
	backups   []snapshot.BackupSet
	backupRun []snapshot.Run
	drill     []snapshot.DrillRun
	incidents []snapshot.Incident
	sent24h   int
	sent7d    int
	notify    []journal.NotifyState
	runs      map[string][]snapshot.Run
	drift     snapshot.Drift
	runbooks  []snapshot.Runbook
	sources   map[string]snapshot.Source
}

// New prepares a collector and seeds its history from the previous snapshot,
// so a restart does not blank the heartbeat bars.
func New(cfg *config.Config) *Collector {
	c := &Collector{
		Cfg:      cfg,
		Cmd:      ExecCmd,
		Journal:  journal.Exec,
		Now:      time.Now,
		Log:      log.New(os.Stderr, "", 0),
		beats:    map[string]string{},
		day:      map[string]*dayLine{},
		lat:      map[string][]float64{},
		restarts: map[string][]restartMark{},
		tails:    map[string]*journal.Tail{},
		lastErr:  map[string]string{},
	}
	c.slow.sources = map[string]snapshot.Source{}
	c.slow.runs = map[string][]snapshot.Run{}
	if cfg.Docker.Enabled {
		c.docker = newDocker(cfg.Docker.Socket)
	}
	if prev, err := snapshot.Read(cfg.StatePath); err == nil {
		for _, s := range prev.Services {
			c.beats[s.ID] = s.Beats
			c.day[s.ID] = seedDay(s.Day, prev.Generated)
			if s.Probe != nil {
				c.lat[s.ID] = s.Probe.Latencies
			}
		}
		c.hostHist = prev.Host.History
	}
	return c
}

func (c *Collector) path(p string) string {
	if c.Root == "" || p == "" {
		return p
	}
	return filepath.Join(c.Root, p)
}

// Run collects every Interval until ctx ends, writing the snapshot each time.
func (c *Collector) Run(ctx context.Context) error {
	if err := os.MkdirAll(filepath.Dir(c.Cfg.StatePath), 0o755); err != nil {
		return err
	}
	t := time.NewTicker(c.Cfg.Interval)
	defer t.Stop()
	go c.watchStop(ctx)
	for {
		snap := c.Collect(ctx)
		if ctx.Err() != nil {
			return nil // a tick cut short by shutdown is not worth writing
		}
		if err := snapshot.Write(c.Cfg.StatePath, snap); err != nil {
			c.note("write", err)
		} else {
			c.note("write", nil)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
		}
	}
}

// Collect is also called by Run; when ctx ends mid-tick, the errors it causes
// are dropped rather than logged.
func (c *Collector) watchStop(ctx context.Context) {
	<-ctx.Done()
	c.stopping.Store(true)
}

// note logs a source's error only when it starts, changes or clears, so a
// persistent problem costs one journal line, not one per tick.
func (c *Collector) note(src string, err error) {
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	if c.stopping.Load() {
		return // errors caused by our own shutdown are not news
	}
	if c.lastErr[src] == msg {
		return
	}
	c.lastErr[src] = msg
	if msg == "" {
		c.Log.Printf("%s: ok again", src)
	} else {
		c.Log.Printf("%s: %s", src, msg)
	}
}

// Collect runs one tick: the fast sources always, the slow ones when due.
func (c *Collector) Collect(ctx context.Context) *snapshot.Snapshot {
	now := c.Now().UTC()
	s := &snapshot.Snapshot{Schema: snapshot.Schema, Generated: now, Title: c.Cfg.Title}
	sources := map[string]snapshot.Source{}
	track := func(name string, fn func() error) {
		start := time.Now()
		err := fn()
		src := snapshot.Source{Name: name, OK: err == nil, At: now, DurationMS: float64(time.Since(start).Microseconds()) / 1000}
		if err != nil {
			src.Error = err.Error()
		}
		sources[name] = src
		c.note(name, err)
	}

	track("host", func() error {
		h, err := c.readHost(ctx, now)
		s.Host = h
		return err
	})
	c.recordHost(&s.Host, now)

	if c.Cfg.Homelab.Enabled && c.Cfg.Homelab.MaintenanceFlag != "" {
		if info, err := os.Stat(c.path(c.Cfg.Homelab.MaintenanceFlag)); err == nil {
			s.Maintenance = &snapshot.Maintenance{Since: info.ModTime().UTC()}
		}
	}

	track("services", func() error {
		svcs, err := c.readServices(ctx, now)
		s.Services = svcs
		return err
	})
	track("timers", func() error {
		ts, err := c.readTimers(ctx)
		s.Timers = ts
		return err
	})

	if c.lastSlow.IsZero() || now.Sub(c.lastSlow) >= c.Cfg.SlowInterval {
		c.collectSlow(ctx, now)
		c.lastSlow = now
	}
	for k, v := range c.slow.sources {
		sources[k] = v
	}

	s.Backups = snapshot.Backups{Sets: c.slow.backups, Runs: c.slow.backupRun}
	s.Drill = snapshot.Drill{Runs: c.slow.drill}
	s.Alerts = snapshot.Alerts{Incidents: c.slow.incidents, Sent24h: c.slow.sent24h, Sent7d: c.slow.sent7d}
	s.Drift = c.slow.drift
	s.Runbooks = c.slow.runbooks
	for i := range s.Timers {
		s.Timers[i].Runs = c.slow.runs[s.Timers[i].Activates]
	}
	h := c.Cfg.Homelab
	if h.Enabled {
		s.Heartbeat = heartbeat(h.HeartbeatUnit, c.slow.runs[h.HeartbeatUnit], now)
		s.Health = health(h, c.slow.runs[h.HealthUnit], c.slow.notify, c.slow.incidents)
	}
	if s.Services == nil {
		s.Services = []snapshot.Service{}
	}
	if s.Timers == nil {
		s.Timers = []snapshot.Timer{}
	}
	if s.Runbooks == nil {
		s.Runbooks = []snapshot.Runbook{}
	}
	names := make([]string, 0, len(sources))
	for k := range sources {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, k := range names {
		s.Sources = append(s.Sources, sources[k])
	}
	snapshot.Finalize(s, now)
	return s
}

func (c *Collector) recordHost(h *snapshot.Host, now time.Time) {
	if h.CPUPct != nil && h.MemTotal > 0 {
		mem := float64(h.MemTotal-h.MemAvail) / float64(h.MemTotal) * 100
		c.hostHist = append(c.hostHist, snapshot.Sample{T: now, CPU: round1(*h.CPUPct), Mem: round1(mem)})
		if n := len(c.hostHist) - c.Cfg.History; n > 0 {
			c.hostHist = c.hostHist[n:]
		}
	}
	h.History = c.hostHist
}

func round1(v float64) float64 { return float64(int(v*10+0.5)) / 10 }

// readServices merges containers, units and probes into rows.
func (c *Collector) readServices(ctx context.Context, now time.Time) ([]snapshot.Service, error) {
	var errs []string
	var containers []container
	if c.docker != nil {
		cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		cs, err := c.docker.list(cctx)
		cancel()
		if err != nil {
			errs = append(errs, "docker: "+err.Error())
		}
		containers = cs
	}
	byName := map[string]container{}
	for _, ct := range containers {
		byName[ct.Name] = ct
	}

	var units []string
	for _, sv := range c.Cfg.Services {
		if sv.Unit != "" {
			units = append(units, sv.Unit)
		}
	}
	props, err := c.showUnits(ctx, units, "ActiveState,SubState,Result,StateChangeTimestamp,ActiveEnterTimestamp,NRestarts,LoadState,UnitFileState")
	if err != nil {
		errs = append(errs, "systemctl: "+err.Error())
	}

	// two probes at a time: enough to ride out one dead endpoint, few enough
	// that the latency shown is the service's and not our own CPU contention
	probes := map[string]snapshot.Probe{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, 2)
	for _, sv := range c.Cfg.Services {
		if sv.Probe == "" {
			continue
		}
		wg.Add(1)
		go func(sv config.Service) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			p := probe(ctx, sv, now)
			mu.Lock()
			probes[sv.ID] = p
			mu.Unlock()
		}(sv)
	}
	wg.Wait()

	var out []snapshot.Service
	used := map[string]bool{}
	for _, sv := range c.Cfg.Services {
		row := snapshot.Service{ID: sv.ID, Title: sv.Title, Note: sv.Note, Group: sv.Group, URL: sv.URL, Runbook: sv.Runbook, State: "unknown"}
		var parts []string
		switch {
		case sv.Container != "":
			row.Kind = "container"
			used[sv.Container] = true
			if ct, ok := byName[sv.Container]; ok {
				st, detail := containerState(ct, true, now)
				row.State, row.Image, row.Restarts = st, ct.Image, ct.Restarts
				if !ct.StartedAt.IsZero() && ct.State == "running" {
					t := ct.StartedAt.UTC()
					row.Since = &t
				}
				parts = append(parts, detail)
				if n := c.recentRestarts(sv.Container, ct.Restarts, now); n >= 2 && row.State == "up" {
					row.State = "degraded"
					parts = append(parts, fmt.Sprintf("%d restarts in the last hour", n))
				}
			} else if c.docker != nil && len(containers) > 0 {
				row.State = "down"
				parts = append(parts, "container not found")
			}
		case sv.Unit != "":
			row.Kind = "unit"
			if p, ok := props[sv.Unit]; ok {
				st, detail, since := unitState(p, now)
				row.State = st
				if !since.IsZero() {
					row.Since = &since
				}
				parts = append(parts, detail)
			}
		default:
			row.Kind = "probe"
		}
		if p, ok := probes[sv.ID]; ok {
			hist := append(c.lat[sv.ID], round1(p.LatencyMS))
			if !p.OK {
				hist[len(hist)-1] = -1
			}
			if n := len(hist) - c.Cfg.History; n > 0 {
				hist = hist[n:]
			}
			c.lat[sv.ID] = hist
			p.Latencies = hist
			pc := p
			row.Probe = &pc
			switch {
			case !p.OK:
				row.State = "down"
				parts = append(parts, p.Target+" "+p.Error)
			case row.Kind == "probe":
				row.State = "up"
				parts = append(parts, fmt.Sprintf("%s · %.0f ms", p.Target, p.LatencyMS))
			default:
				parts = append(parts, fmt.Sprintf("%.0f ms", p.LatencyMS))
			}
			if p.OK && p.CertDays != nil && *p.CertDays < 14 && row.State == "up" {
				row.State = "degraded"
				parts = append(parts, fmt.Sprintf("certificate expires in %d days", *p.CertDays))
			}
		}
		row.Detail = strings.Join(parts, " · ")
		out = append(out, row)
	}
	var rest []snapshot.Service
	for _, ct := range containers {
		if used[ct.Name] {
			continue
		}
		st, detail := containerState(ct, false, now)
		row := snapshot.Service{ID: ct.Name, Title: ct.Name, Kind: "container", Group: ct.Project, State: st,
			Detail: detail, Image: ct.Image, Restarts: ct.Restarts}
		if ct.State == "running" && !ct.StartedAt.IsZero() {
			t := ct.StartedAt.UTC()
			row.Since = &t
		}
		if n := c.recentRestarts(ct.Name, ct.Restarts, now); n >= 2 && st == "up" {
			row.State = "degraded"
			row.Detail += fmt.Sprintf(" · %d restarts in the last hour", n)
		}
		rest = append(rest, row)
	}
	sort.Slice(rest, func(i, j int) bool { return rest[i].ID < rest[j].ID })
	out = append(out, rest...)
	for i := range out {
		out[i].Beats = c.beat(out[i].ID, out[i].State)
		out[i].Day = c.dayMark(out[i].ID, out[i].Beats, now)
	}
	if len(errs) > 0 {
		return out, fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return out, nil
}

func (c *Collector) beat(id, state string) string {
	ch := "?"
	switch state {
	case "up":
		ch = "u"
	case "degraded":
		ch = "d"
	case "down":
		ch = "x"
	case "off":
		ch = "o"
	}
	b := c.beats[id] + ch
	if n := len(b) - c.Cfg.History; n > 0 {
		b = b[n:]
	}
	c.beats[id] = b
	return b
}

func (c *Collector) recentRestarts(name string, count int, now time.Time) int {
	marks := append(c.restarts[name], restartMark{now, count})
	cut := now.Add(-time.Hour)
	i := 0
	for i < len(marks)-1 && marks[i].t.Before(cut) {
		i++
	}
	marks = marks[i:]
	c.restarts[name] = marks
	if d := count - marks[0].count; d > 0 {
		return d
	}
	return 0
}

func (c *Collector) readTimers(ctx context.Context) ([]snapshot.Timer, error) {
	listed, err := c.listTimers(ctx)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, t := range listed {
		if !config.Matches(c.Cfg.Timers.Show, t.Unit) && !config.Matches(c.Cfg.Timers.Highlight, t.Unit) {
			continue
		}
		// a timer whose service is gone lists an empty "activates"; systemctl
		// show refuses the whole call if handed an empty name
		for _, n := range []string{t.Unit, t.Activates} {
			if n != "" {
				names = append(names, n)
			}
		}
	}
	props, err := c.showUnits(ctx, names, "Description,UnitFileState,Result,ActiveState,SubState")
	if err != nil {
		return nil, err
	}
	var out []snapshot.Timer
	for _, t := range listed {
		if !config.Matches(c.Cfg.Timers.Show, t.Unit) && !config.Matches(c.Cfg.Timers.Highlight, t.Unit) {
			continue
		}
		tp, sp := props[t.Unit], props[t.Activates]
		row := snapshot.Timer{Unit: t.Unit, Activates: t.Activates, Next: usTime(t.Next), Last: usTime(t.Last),
			Description: sp["Description"], Enabled: tp["UnitFileState"],
			Highlight: config.Matches(c.Cfg.Timers.Highlight, t.Unit)}
		switch {
		case sp["ActiveState"] == "activating" || sp["ActiveState"] == "active" && sp["SubState"] == "running":
			row.Result = "running"
		case sp["Result"] == "success":
			if row.Last != nil {
				row.Result = "success"
			}
		case sp["Result"] != "":
			row.Result = "failed"
		}
		if row.Description == "" {
			row.Description = tp["Description"]
		}
		out = append(out, row)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i].Next, out[j].Next
		switch {
		case a == nil:
			return false
		case b == nil:
			return true
		}
		return a.Before(*b)
	})
	return out, nil
}

// collectSlow refreshes the sources that change at most every few minutes.
func (c *Collector) collectSlow(ctx context.Context, now time.Time) {
	track := func(name string, fn func() error) {
		start := time.Now()
		err := fn()
		src := snapshot.Source{Name: name, OK: err == nil, At: now, DurationMS: float64(time.Since(start).Microseconds()) / 1000}
		if err != nil {
			src.Error = err.Error()
		}
		c.slow.sources[name] = src
		c.note(name, err)
	}
	h := c.Cfg.Homelab
	days := func(n int) time.Duration { return time.Duration(n) * 24 * time.Hour }

	units := append([]string(nil), c.Cfg.Timers.History...)
	if h.Enabled {
		for _, u := range []string{h.BackupUnit, h.DrillUnit, h.HealthUnit, h.HeartbeatUnit} {
			if u != "" && !contains(units, u) {
				units = append(units, u)
			}
		}
	}
	track("journal", func() error {
		var errs []string
		for _, u := range units {
			window := days(c.Cfg.Timers.HistoryDays)
			if u == h.DrillUnit && window < 60*24*time.Hour {
				window = 60 * 24 * time.Hour
			}
			if u == h.HeartbeatUnit {
				window = 26 * time.Hour
			}
			t := c.tail("u:"+u, []string{"-u", u}, window, 6000)
			if err := t.Update(ctx, now); err != nil {
				errs = append(errs, u+": "+err.Error())
				continue
			}
			runs := journal.Runs(t.Entries(), u, false)
			if u != h.HeartbeatUnit && len(runs) > 40 {
				runs = runs[:40]
			}
			c.slow.runs[u] = runs
			if u == h.DrillUnit {
				d := journal.DrillRuns(t.Entries(), u)
				if len(d) > 12 {
					d = d[:12]
				}
				c.slow.drill = d
			}
			if u == h.BackupUnit {
				c.slow.backupRun = runs
			}
		}
		if len(errs) > 0 {
			return fmt.Errorf("%s", strings.Join(errs, "; "))
		}
		return nil
	})
	if h.Enabled {
		track("backups", func() error {
			b, err := c.readBackups()
			if err == nil {
				c.slow.backups = b
			}
			return err
		})
		track("alerts", func() error {
			states, err := c.readNotifyStates()
			if err != nil {
				return err
			}
			c.slow.notify = states
			t := c.tail("notify", []string{"SYSLOG_IDENTIFIER=" + h.NotifyTag}, days(h.EventsDays), 20000)
			if err := t.Update(ctx, now); err != nil {
				return err
			}
			events := journal.ParseNotify(t.Entries())
			c.slow.incidents = journal.Incidents(events, states, h.InfoKeys, h.AlertWindow, now)
			c.slow.sent24h, c.slow.sent7d = 0, 0
			for _, e := range events {
				if e.Verb != "sent" {
					continue
				}
				if now.Sub(e.Time) <= 24*time.Hour {
					c.slow.sent24h++
				}
				if now.Sub(e.Time) <= 7*24*time.Hour {
					c.slow.sent7d++
				}
			}
			return nil
		})
		track("drift", func() error {
			c.slow.drift = c.readDrift(ctx, now)
			if c.slow.drift.Error != "" {
				return fmt.Errorf("%s", c.slow.drift.Error)
			}
			return nil
		})
	}
	track("runbooks", func() error {
		rbs, err := c.syncRunbooks()
		c.slow.runbooks = rbs
		return err
	})
}

func (c *Collector) tail(key string, match []string, window time.Duration, max int) *journal.Tail {
	t, ok := c.tails[key]
	if !ok {
		t = &journal.Tail{Match: match, Window: window, MaxEntries: max, Run: c.Journal}
		c.tails[key] = t
	}
	return t
}

// syncRunbooks copies local runbook files into RunbookDir (only when they
// changed) for the web process to serve, and lists them.
func (c *Collector) syncRunbooks() ([]snapshot.Runbook, error) {
	var out []snapshot.Runbook
	var errs []string
	if len(c.Cfg.Runbooks) > 0 {
		if err := os.MkdirAll(c.Cfg.RunbookDir, 0o755); err != nil {
			return nil, err
		}
	}
	for _, rb := range c.Cfg.Runbooks {
		r := snapshot.Runbook{ID: rb.ID, Title: rb.Title, URL: rb.URL, Match: rb.Match}
		if rb.File != "" {
			b, err := readCapped(c.path(rb.File), 1<<20)
			if err != nil {
				errs = append(errs, rb.ID+": "+shortErr(err))
				continue
			}
			dst := filepath.Join(c.Cfg.RunbookDir, rb.ID+".md")
			if old, err := os.ReadFile(dst); err != nil || !bytes.Equal(old, b) {
				if err := snapshot.WriteBytes(dst, b); err != nil {
					errs = append(errs, rb.ID+": "+err.Error())
					continue
				}
			}
			r.Local, r.Bytes = true, len(b)
		}
		out = append(out, r)
	}
	if len(errs) > 0 {
		return out, fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return out, nil
}

func readCapped(p string, max int64) ([]byte, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(io.LimitReader(f, max)); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func heartbeat(unit string, runs []snapshot.Run, now time.Time) snapshot.Heartbeat {
	hb := snapshot.Heartbeat{Unit: unit}
	if unit == "" || len(runs) == 0 {
		return hb
	}
	for _, r := range runs {
		if r.Result == "running" || r.Result == "unknown" {
			continue
		}
		if hb.Last == nil {
			end := r.End
			hb.Last = &end
			hb.OK = r.Result == "success"
			if !hb.OK {
				hb.Reason = r.Summary
			}
		}
		if now.Sub(r.Start) <= 24*time.Hour {
			hb.Runs24h++
			if r.Result == "success" {
				hb.Pings24h++
			}
		}
	}
	return hb
}

func health(h config.Homelab, runs []snapshot.Run, states []journal.NotifyState, incidents []snapshot.Incident) snapshot.Health {
	out := snapshot.Health{Categories: []snapshot.HealthCategory{}}
	for _, r := range runs {
		if r.Result == "success" {
			end := r.End
			out.Last = &end
			out.Result = r.Summary
			break
		}
	}
	open := map[string]journal.NotifyState{}
	for _, st := range states {
		open[st.Key] = st
	}
	prio := map[string]string{}
	for _, in := range incidents {
		if _, ok := prio[in.Key]; !ok && in.Prio != "" {
			prio[in.Key] = in.Prio
		}
	}
	stale := map[string]bool{}
	for _, in := range incidents {
		if in.State == "stale" {
			stale[in.Key] = true
		}
	}
	for _, name := range h.HealthCategories {
		key := "health-" + name
		hc := snapshot.HealthCategory{Name: name}
		if st, ok := open[key]; ok && !stale[key] {
			hc.Open = true
			t := st.Opened
			hc.Since = &t
			hc.Prio = prio[key]
		}
		out.Categories = append(out.Categories, hc)
	}
	return out
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
