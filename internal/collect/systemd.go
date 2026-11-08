package collect

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// unitProps is one block of `systemctl show` output.
type unitProps map[string]string

// showUnits runs one `systemctl show` for all units and returns their
// properties by unit name. Blocks are separated by blank lines.
func (c *Collector) showUnits(ctx context.Context, units []string, props string) (map[string]unitProps, error) {
	out := map[string]unitProps{}
	if len(units) == 0 {
		return out, nil
	}
	args := append([]string{"show", "--timestamp=unix", "-p", "Id," + props, "--"}, units...)
	b, err := c.Cmd(ctx, "systemctl", args...)
	if err != nil {
		return nil, err
	}
	return parseShow(b), nil
}

func parseShow(b []byte) map[string]unitProps {
	out := map[string]unitProps{}
	cur := unitProps{}
	flush := func() {
		if id := cur["Id"]; id != "" {
			out[id] = cur
		}
		cur = unitProps{}
	}
	sc := bufio.NewScanner(bytes.NewReader(b))
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			flush()
			continue
		}
		if k, v, ok := strings.Cut(line, "="); ok {
			cur[k] = v
		}
	}
	flush()
	return out
}

// unixProp parses "@1794016801" (from --timestamp=unix); empty or 0 is zero.
func unixProp(v string) time.Time {
	v = strings.TrimPrefix(v, "@")
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		return time.Time{}
	}
	return time.Unix(n, 0).UTC()
}

type listedTimer struct {
	Unit      string `json:"unit"`
	Activates string `json:"activates"`
	Next      *int64 `json:"next"`
	Last      *int64 `json:"last"`
}

// listTimers runs `systemctl list-timers --all -o json`.
func (c *Collector) listTimers(ctx context.Context) ([]listedTimer, error) {
	b, err := c.Cmd(ctx, "systemctl", "list-timers", "--all", "--no-pager", "-o", "json")
	if err != nil {
		return nil, err
	}
	var ts []listedTimer
	if err := json.Unmarshal(b, &ts); err != nil {
		return nil, fmt.Errorf("list-timers json: %w", err)
	}
	return ts, nil
}

func usTime(p *int64) *time.Time {
	if p == nil || *p <= 0 {
		return nil
	}
	t := time.UnixMicro(*p).UTC()
	return &t
}

// unitState maps a systemd service to up/degraded/down/off.
func unitState(p unitProps, now time.Time) (state, detail string, since time.Time) {
	active, sub := p["ActiveState"], p["SubState"]
	since = unixProp(p["StateChangeTimestamp"])
	if since.IsZero() {
		since = unixProp(p["ActiveEnterTimestamp"])
	}
	ago := ""
	if !since.IsZero() {
		ago = " · " + agoShort(now.Sub(since))
	}
	restarts := ""
	if n, _ := strconv.Atoi(p["NRestarts"]); n > 0 {
		restarts = fmt.Sprintf(" · %d restarts", n)
	}
	switch active {
	case "active":
		if sub == "exited" { // a oneshot with RemainAfterExit: done, and fine
			return "up", "done" + ago, since
		}
		return "up", sub + ago + restarts, since
	case "reloading", "activating":
		return "degraded", active + ago, since
	case "failed":
		return "down", "failed (" + p["Result"] + ")" + ago, since
	case "inactive":
		if p["LoadState"] == "not-found" {
			return "unknown", "unit not found", since
		}
		if p["UnitFileState"] == "disabled" {
			return "off", "disabled", since
		}
		return "down", "inactive" + ago, since
	}
	return "unknown", active + "/" + sub, since
}
