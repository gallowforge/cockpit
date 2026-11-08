package collect

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io/fs"
	"os"
	"os/user"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gallowforge/cockpit/internal/config"
	"github.com/gallowforge/cockpit/internal/journal"
	"github.com/gallowforge/cockpit/internal/snapshot"
)

// backupSetConf is one [set] of the homelab's backups.conf.
type backupSetConf struct {
	Name    string
	Type    string
	Keep    int
	MaxAgeH int
}

// parseBackupsConf reads backups.conf leniently: it only needs the base
// directory and each set's type, keep and max_age_h. The backup engine's own
// --check-config is the strict validator.
func parseBackupsConf(b []byte) (base string, sets []backupSetConf) {
	var cur *backupSetConf
	sc := bufio.NewScanner(bytes.NewReader(b))
	section := ""
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		if line[0] == '[' && strings.HasSuffix(line, "]") {
			section = strings.TrimSpace(line[1 : len(line)-1])
			cur = nil
			if section != "defaults" {
				sets = append(sets, backupSetConf{Name: section, MaxAgeH: 48})
				cur = &sets[len(sets)-1]
			}
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if section == "defaults" && k == "base" {
			base = v
		}
		if cur == nil {
			continue
		}
		switch k {
		case "type":
			cur.Type = v
		case "keep":
			cur.Keep, _ = strconv.Atoi(v)
		case "max_age_h":
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				cur.MaxAgeH = n
			}
		}
	}
	return base, sets
}

// readKV reads a key=value file such as a backup status or notify state.
func readKV(p string) (map[string]string, error) {
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	m := map[string]string{}
	for _, line := range strings.Split(string(b), "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), "="); ok {
			m[k] = v
		}
	}
	return m, nil
}

// readBackups builds the backup sets: config, last verified status, and the
// archives still on disk.
func (c *Collector) readBackups() ([]snapshot.BackupSet, error) {
	h := c.Cfg.Homelab
	conf, err := os.ReadFile(c.path(h.BackupConf))
	if err != nil {
		return nil, fmt.Errorf("backup config: %w", err)
	}
	base, sets := parseBackupsConf(conf)
	out := make([]snapshot.BackupSet, 0, len(sets))
	for _, s := range sets {
		bs := snapshot.BackupSet{Name: s.Name, Type: s.Type, Keep: s.Keep, MaxAgeH: s.MaxAgeH}
		if st, err := readKV(filepath.Join(c.path(h.BackupStatus), s.Name)); err == nil {
			if n, err := strconv.ParseInt(st["epoch"], 10, 64); err == nil && n > 0 {
				t := time.Unix(n, 0).UTC()
				bs.LastOK = &t
			}
			bs.Bytes, _ = strconv.ParseInt(st["bytes"], 10, 64)
			for k, v := range st {
				if k == "members" || strings.HasPrefix(k, "rows_") {
					if n, err := strconv.Atoi(v); err == nil {
						if bs.Checks == nil {
							bs.Checks = map[string]int{}
						}
						bs.Checks[k] = n
					}
				}
			}
		}
		if base != "" {
			bs.Archives = listArchives(filepath.Join(c.path(base), s.Name), 60)
		}
		out = append(out, bs)
	}
	return out, nil
}

// listArchives returns the newest n regular files in dir, newest first.
func listArchives(dir string, n int) []snapshot.Archive {
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []snapshot.Archive
	for _, e := range ents {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") || !e.Type().IsRegular() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, snapshot.Archive{Time: info.ModTime().UTC(), Bytes: info.Size()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Time.After(out[j].Time) })
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// readNotifyStates lists homelab-notify's open incidents.
func (c *Collector) readNotifyStates() ([]journal.NotifyState, error) {
	dir := c.path(c.Cfg.Homelab.NotifyState)
	ents, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []journal.NotifyState
	for _, e := range ents {
		name := e.Name()
		if e.IsDir() || strings.HasPrefix(name, ".") || strings.Contains(name, ".tmp") {
			continue
		}
		kv, err := readKV(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		st := journal.NotifyState{Key: name, Opened: epoch(kv["opened"]), LastOK: epoch(kv["last_ok"]), LastTry: epoch(kv["last_try"])}
		if st.Opened.IsZero() {
			continue
		}
		out = append(out, st)
	}
	return out, nil
}

func epoch(v string) time.Time {
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil || n <= 0 {
		return time.Time{}
	}
	return time.Unix(n, 0).UTC()
}

// manifestEntry is one line of _host/MANIFEST.
type manifestEntry struct {
	Path, Mode, Owner, Group string
}

func parseManifest(b []byte) (entries []manifestEntry, ignored []string) {
	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 0 || strings.HasPrefix(f[0], "#") {
			continue
		}
		if f[0] == "ignore" {
			if len(f) > 1 {
				ignored = append(ignored, f[1])
			}
			continue
		}
		if len(f) < 4 {
			continue
		}
		entries = append(entries, manifestEntry{Path: f[0], Mode: f[1], Owner: f[2], Group: f[3]})
	}
	return entries, ignored
}

// readDrift compares every MANIFEST entry with the live file, as the homelab's
// install.sh and daily health check do, plus mode, owner and timer state. It
// only reads.
func (c *Collector) readDrift(ctx context.Context, now time.Time) snapshot.Drift {
	h := c.Cfg.Homelab
	d := snapshot.Drift{Result: "unknown", Files: []snapshot.DriftFile{}, Disabled: []string{}}
	t := now
	d.Checked = &t
	mb, err := os.ReadFile(c.path(h.Manifest))
	if err != nil {
		d.Error = "MANIFEST not readable: " + shortErr(err)
		return d
	}
	entries, _ := parseManifest(mb)
	hostDir := filepath.Dir(c.path(h.Manifest))
	var timers []string
	for _, e := range entries {
		if e.Mode == "crontab" {
			continue // crontabs are compared by install.sh as the owner
		}
		d.Tracked++
		src := filepath.Join(hostDir, e.Path)
		live := c.path("/" + e.Path)
		want, err := os.ReadFile(src)
		if err != nil {
			d.Files = append(d.Files, snapshot.DriftFile{Path: "/" + e.Path, State: "not-in-repo"})
			continue
		}
		info, err := os.Stat(live)
		if err != nil {
			d.Files = append(d.Files, snapshot.DriftFile{Path: "/" + e.Path, State: "missing"})
			continue
		}
		have, err := os.ReadFile(live)
		if err != nil {
			d.Files = append(d.Files, snapshot.DriftFile{Path: "/" + e.Path, State: "unreadable", Note: shortErr(err)})
			continue
		}
		if !bytes.Equal(want, have) {
			d.Files = append(d.Files, snapshot.DriftFile{Path: "/" + e.Path, State: "differs",
				Note: fmt.Sprintf("%d lines in the repo, %d live", lines(want), lines(have))})
			continue
		}
		if m, err := strconv.ParseUint(e.Mode, 8, 32); err == nil && fs.FileMode(m)&fs.ModePerm != info.Mode().Perm() {
			d.Files = append(d.Files, snapshot.DriftFile{Path: "/" + e.Path, State: "mode",
				Note: fmt.Sprintf("%04o live, %s in MANIFEST", info.Mode().Perm(), e.Mode)})
			continue
		}
		if st, ok := info.Sys().(*syscall.Stat_t); ok && c.Root == "" {
			if u := userName(st.Uid); u != "" && u != e.Owner {
				d.Files = append(d.Files, snapshot.DriftFile{Path: "/" + e.Path, State: "owner",
					Note: u + " live, " + e.Owner + " in MANIFEST"})
				continue
			}
		}
		if strings.HasPrefix(e.Path, "etc/systemd/system/") && strings.HasSuffix(e.Path, ".timer") {
			timers = append(timers, filepath.Base(e.Path))
		}
	}
	if len(timers) > 0 {
		props, err := c.showUnits(ctx, timers, "UnitFileState")
		if err == nil {
			for _, t := range timers {
				if config.Matches(h.SelfDisabling, t) {
					continue // disables itself when its job is done (install.sh SELF_DISABLING)
				}
				if s := props[t]["UnitFileState"]; s != "" && s != "enabled" && s != "static" && s != "linked" {
					d.Disabled = append(d.Disabled, t)
				}
			}
		}
	}
	d.Uncommitted = -1
	if h.Repo != "" {
		out, err := c.Cmd(ctx, "git", "--no-optional-locks", "-c", "safe.directory=*", "-C", c.path(h.Repo), "status", "--porcelain")
		if err == nil {
			d.Uncommitted = 0
			for _, l := range strings.Split(string(out), "\n") {
				if strings.TrimSpace(l) != "" {
					d.Uncommitted++
				}
			}
		}
	}
	d.Result = "clean"
	if len(d.Files) > 0 || len(d.Disabled) > 0 {
		d.Result = "drift"
	}
	return d
}

func lines(b []byte) int { return bytes.Count(b, []byte("\n")) }

func userName(uid uint32) string {
	u, err := user.LookupId(strconv.FormatUint(uint64(uid), 10))
	if err != nil {
		return ""
	}
	return u.Username
}

func shortErr(err error) string {
	var pe *fs.PathError
	if e, ok := err.(*fs.PathError); ok {
		pe = e
		return pe.Err.Error()
	}
	return err.Error()
}
