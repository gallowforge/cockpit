// Package journal reads systemd's journal through `journalctl -o json` and
// turns it into the facts Vesper shows: runs of a service, restore-drill
// results and alert events. It never writes to the journal.
package journal

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"time"
)

// Entry is one journal record, reduced to the fields Vesper uses.
type Entry struct {
	Time       time.Time
	Message    string
	Invocation string // _SYSTEMD_INVOCATION_ID (the service) or INVOCATION_ID (systemd about it)
	FromPID1   bool   // systemd's own line about the unit (Started, Finished, Failed...)
	JobResult  string
	Unit       string
	Cursor     string
}

// Runner runs journalctl with args and returns its stdout. Tests replace it.
type Runner func(ctx context.Context, args []string) ([]byte, error)

// Exec is the real Runner.
func Exec(ctx context.Context, args []string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "journalctl", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := bytes.TrimSpace(stderr.Bytes())
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return nil, fmt.Errorf("journalctl: %v %s", err, msg)
	}
	return out, nil
}

// Fields is passed to --output-fields so the JSON stays small.
const Fields = "MESSAGE,_SYSTEMD_INVOCATION_ID,INVOCATION_ID,JOB_RESULT,UNIT,_SYSTEMD_UNIT,_PID"

// Parse decodes journalctl -o json output (one object per line).
func Parse(b []byte) ([]Entry, error) {
	var out []Entry
	sc := bufio.NewScanner(bytes.NewReader(b))
	sc.Buffer(make([]byte, 256*1024), 8*1024*1024)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(line, &raw); err != nil {
			return out, fmt.Errorf("journal json: %w", err)
		}
		e := Entry{
			Message:   field(raw, "MESSAGE"),
			JobResult: field(raw, "JOB_RESULT"),
			Cursor:    field(raw, "__CURSOR"),
		}
		if us, err := strconv.ParseInt(field(raw, "__REALTIME_TIMESTAMP"), 10, 64); err == nil {
			e.Time = time.UnixMicro(us).UTC()
		}
		if inv := field(raw, "_SYSTEMD_INVOCATION_ID"); inv != "" {
			e.Invocation = inv
			e.Unit = field(raw, "_SYSTEMD_UNIT")
		} else {
			e.Invocation = field(raw, "INVOCATION_ID")
			e.Unit = field(raw, "UNIT")
			e.FromPID1 = field(raw, "_PID") == "1" || e.Unit != ""
		}
		out = append(out, e)
	}
	return out, sc.Err()
}

// field returns a journal field as text. journalctl encodes non-UTF-8 values
// as an array of byte values; those are decoded too.
func field(raw map[string]json.RawMessage, k string) string {
	v, ok := raw[k]
	if !ok {
		return ""
	}
	var s string
	if err := json.Unmarshal(v, &s); err == nil {
		return s
	}
	var bs []byte
	var nums []int
	if err := json.Unmarshal(v, &nums); err == nil {
		for _, n := range nums {
			bs = append(bs, byte(n))
		}
		return string(bs)
	}
	return ""
}

// Tail keeps a rolling window of one journal query in memory and reads only
// what is new on each Update, using the journal cursor.
type Tail struct {
	Match      []string      // e.g. ["-u", "homelab-backup.service"] or ["SYSLOG_IDENTIFIER=homelab-notify"]
	Window     time.Duration // how far back to keep
	MaxEntries int
	Run        Runner

	entries []Entry
	cursor  string
}

// Update reads new entries and drops ones that left the window.
func (t *Tail) Update(ctx context.Context, now time.Time) error {
	args := []string{"--no-pager", "-o", "json", "--output-fields=" + Fields}
	if t.cursor != "" {
		args = append(args, "--after-cursor="+t.cursor)
	} else {
		args = append(args, "--since=@"+strconv.FormatInt(now.Add(-t.Window).Unix(), 10))
	}
	args = append(args, t.Match...)
	run := t.Run
	if run == nil {
		run = Exec
	}
	out, err := run(ctx, args)
	if err != nil {
		return err
	}
	fresh, err := Parse(out)
	if err != nil {
		return err
	}
	t.entries = append(t.entries, fresh...)
	if n := len(t.entries); n > 0 && t.entries[n-1].Cursor != "" {
		t.cursor = t.entries[n-1].Cursor
	}
	cut := now.Add(-t.Window)
	i := 0
	for i < len(t.entries) && t.entries[i].Time.Before(cut) {
		i++
	}
	if t.MaxEntries > 0 && len(t.entries)-i > t.MaxEntries {
		i = len(t.entries) - t.MaxEntries
	}
	if i > 0 {
		t.entries = append([]Entry(nil), t.entries[i:]...)
	}
	return nil
}

// Entries returns the current window, oldest first.
func (t *Tail) Entries() []Entry { return t.entries }
