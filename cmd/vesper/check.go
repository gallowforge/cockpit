package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/gallowforge/vesper/internal/collect"
	"github.com/gallowforge/vesper/internal/snapshot"
)

// runCheck prints the snapshot as a short terminal report. Exit status: 0 all
// normal, 1 something to look at, 2 something is down or failed.
func runCheck(args []string, w io.Writer) (int, error) {
	fs := flag.NewFlagSet("check", flag.ExitOnError)
	cfgPath := fs.String("config", defaultConfig, "config file (its state path is read)")
	statePath := fs.String("state", "", "read this snapshot instead")
	fresh := fs.Bool("collect", false, "collect now instead of reading the last snapshot")
	asJSON := fs.Bool("json", false, "print the status block as JSON")
	color := fs.String("color", "auto", "auto, always or never")
	fs.Parse(args)

	var snap *snapshot.Snapshot
	var err error
	switch {
	case *statePath != "":
		snap, err = snapshot.Read(*statePath)
	default:
		cfg, cerr := loadConfig(*cfgPath)
		if cerr != nil {
			return 3, cerr
		}
		if *fresh {
			snap = collect.New(cfg).Collect(context.Background())
		} else {
			snap, err = snapshot.Read(cfg.StatePath)
		}
	}
	if err != nil {
		return 3, err
	}
	if *asJSON {
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return exitFor(snap.Status.Level), enc.Encode(snap.Status)
	}
	useColor := *color == "always" || (*color == "auto" && isTerminal(os.Stdout) && os.Getenv("NO_COLOR") == "")
	report(w, snap, time.Now(), useColor)
	return exitFor(snap.Status.Level), nil
}

func exitFor(level string) int {
	switch level {
	case snapshot.Crit:
		return 2
	case snapshot.Warn, snapshot.Unknown:
		return 1 // a blind spot is not all clear
	}
	return 0
}

type painter struct{ on bool }

func (p painter) c(code, s string) string {
	if !p.on {
		return s
	}
	return "\x1b[" + code + "m" + s + "\x1b[0m"
}
func (p painter) level(l, s string) string {
	switch l {
	case snapshot.OK:
		return p.c("32", s)
	case snapshot.Warn:
		return p.c("33", s)
	case snapshot.Crit:
		return p.c("31", s)
	}
	return p.c("90", s)
}
func (p painter) dim(s string) string  { return p.c("90", s) }
func (p painter) bold(s string) string { return p.c("1", s) }

func report(w io.Writer, s *snapshot.Snapshot, wall time.Time, color bool) {
	p := painter{color}
	now := s.Generated
	dot := map[string]string{snapshot.OK: "●", snapshot.Warn: "▲", snapshot.Crit: "■", snapshot.Unknown: "◌"}[s.Status.Level]
	if dot == "" {
		dot = "●"
	}
	age := ""
	if d := wall.Sub(s.Generated); d > 2*time.Minute {
		age = p.c("33", fmt.Sprintf("  (snapshot is %s old)", snapshot.Ago(d)))
	}
	fmt.Fprintf(w, "%s %s %s %s%s\n", p.level(s.Status.Level, dot), p.bold(s.Title), p.dim("·"), p.level(s.Status.Level, s.Status.Headline), age)
	for _, a := range s.Status.Attention {
		tag := map[string]string{snapshot.Warn: "warn", snapshot.Crit: "crit"}[a.Level]
		fmt.Fprintf(w, "  %s  %s\n", p.level(a.Level, tag), a.Title)
		if a.Detail != "" {
			fmt.Fprintf(w, "        %s\n", p.dim(a.Detail))
		}
		if a.Evidence != "" {
			fmt.Fprintf(w, "        %s\n", p.dim("also: "+a.Evidence))
		}
		if a.Runbook != "" {
			fmt.Fprintf(w, "        %s\n", p.dim("runbook: "+runbookTitle(s, a.Runbook)))
		}
	}
	for _, b := range s.Status.Blind {
		fmt.Fprintf(w, "  %s  %s\n", p.dim("can't see"), b.Title)
		if b.Detail != "" {
			fmt.Fprintf(w, "        %s\n", p.dim(b.Detail))
		}
	}
	fmt.Fprintln(w)
	row := func(level, name, text string) {
		fmt.Fprintf(w, "  %s %-10s %s\n", p.level(level, "●"), name, text)
	}

	up, total, probes, slow := 0, 0, 0, 0.0
	for _, sv := range s.Services {
		if sv.State == "off" {
			continue
		}
		total++
		if sv.State == "up" {
			up++
		}
		if sv.Probe != nil && sv.Probe.OK {
			probes++
			if sv.Probe.LatencyMS > slow {
				slow = sv.Probe.LatencyMS
			}
		}
	}
	svLevel := snapshot.OK
	for _, sv := range s.Services {
		svLevel = snapshot.Worst(svLevel, sv.Level)
	}
	text := fmt.Sprintf("%d/%d up", up, total)
	if probes > 0 {
		text += p.dim(fmt.Sprintf(" · %d probes ok, slowest %.0f ms", probes, slow))
	}
	row(svLevel, "services", text)

	if n := len(s.Backups.Sets); n > 0 {
		ok := 0
		var newest time.Time
		for _, b := range s.Backups.Sets {
			if b.Level == snapshot.OK {
				ok++
			}
			if b.LastOK != nil && b.LastOK.After(newest) {
				newest = *b.LastOK
			}
		}
		text := fmt.Sprintf("%d/%d verified", ok, n)
		if !newest.IsZero() {
			text += p.dim(fmt.Sprintf(" · newest %s ago · %s", snapshot.Ago(now.Sub(newest)), bytes(s.Backups.Bytes)))
		}
		row(s.Backups.Level, "backups", text)
	}
	if len(s.Drill.Runs) > 0 {
		r := s.Drill.Runs[0]
		row(s.Drill.Level, "drill", fmt.Sprintf("%d passed, %d failed", r.Passed, r.Failed)+p.dim(" · "+snapshot.Ago(now.Sub(r.End))+" ago"))
	}
	open := len(s.Alerts.Open)
	row(s.Alerts.Level, "alerts", fmt.Sprintf("%d open", open)+p.dim(fmt.Sprintf(" · %d sent in 24 h, %d in 7 days", s.Alerts.Sent24h, s.Alerts.Sent7d)))
	if len(s.Timers) > 0 {
		failed := 0
		tl := snapshot.OK
		for _, t := range s.Timers {
			if t.Result == "failed" {
				failed++
			}
			if t.Highlight {
				tl = snapshot.Worst(tl, t.Level)
			}
		}
		text := fmt.Sprintf("%d timers, %d failed", len(s.Timers), failed)
		if t := s.Timers[0]; t.Next != nil {
			text += p.dim(fmt.Sprintf(" · next %s in %s", strings.TrimSuffix(t.Activates, ".service"), snapshot.Ago(t.Next.Sub(now))))
		}
		row(tl, "timers", text)
	}
	switch s.Drift.Result {
	case "clean":
		row(s.Drift.Level, "drift", "no drift"+p.dim(fmt.Sprintf(" · %d files tracked · %d uncommitted", s.Drift.Tracked, max(s.Drift.Uncommitted, 0))))
	case "drift":
		row(s.Drift.Level, "drift", snapshot.FilesDiffer(len(s.Drift.Files)+len(s.Drift.Disabled))+p.dim(fmt.Sprintf(" · %d files tracked", s.Drift.Tracked)))
	}
	if hb := s.Heartbeat; hb.Unit != "" && hb.Last != nil {
		text := fmt.Sprintf("%d/%d pings in 24 h", hb.Pings24h, hb.Runs24h) + p.dim(" · last "+snapshot.Ago(now.Sub(*hb.Last))+" ago")
		if !hb.OK {
			text = "withheld" + p.dim(" · "+hb.Reason)
		}
		row(hb.Level, "heartbeat", text)
	}
	h := s.Host
	text = ""
	if h.CPUPct != nil {
		text += fmt.Sprintf("cpu %.0f%%", *h.CPUPct)
	}
	if h.MemTotal > 0 {
		text += fmt.Sprintf(" · mem %.0f%%", float64(h.MemTotal-h.MemAvail)/float64(h.MemTotal)*100)
	}
	if h.TempC != nil {
		text += fmt.Sprintf(" · %.0f °C", *h.TempC)
	}
	for _, d := range h.Disks {
		if d.Size > 0 {
			text += fmt.Sprintf(" · %s %.0f%%", d.Mount, float64(d.Used)/float64(d.Size)*100)
		}
	}
	text += p.dim(" · up " + snapshot.Ago(time.Duration(h.UptimeS)*time.Second))
	row(h.Level, "host", strings.TrimPrefix(text, " · "))
}

func runbookTitle(s *snapshot.Snapshot, id string) string {
	for _, r := range s.Runbooks {
		if r.ID == id {
			return r.Title
		}
	}
	return id
}

func bytes(n int64) string {
	f := float64(n)
	for _, u := range []string{"B", "KB", "MB", "GB", "TB"} {
		if f < 1000 || u == "TB" {
			if u == "B" {
				return fmt.Sprintf("%d B", n)
			}
			return fmt.Sprintf("%.1f %s", f, u)
		}
		f /= 1000
	}
	return ""
}
