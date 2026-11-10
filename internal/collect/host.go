package collect

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gallowforge/vesper/internal/snapshot"
)

// hostState carries the counters CPU and write rates are computed from.
type hostState struct {
	cpuTotal, cpuIdle uint64
	sectors           uint64
	sectorsAt         time.Time
}

// readHost fills the host block from /proc and /sys under root ("" in
// production; a testdata directory in tests).
func (c *Collector) readHost(ctx context.Context, now time.Time) (snapshot.Host, error) {
	root := c.Root
	h := snapshot.Host{Name: c.Cfg.Title}
	var errs []string

	if b, err := os.ReadFile(filepath.Join(root, "/proc/loadavg")); err == nil {
		f := strings.Fields(string(b))
		for i := 0; i < 3 && i < len(f); i++ {
			h.Load[i], _ = strconv.ParseFloat(f[i], 64)
		}
	} else {
		errs = append(errs, "loadavg")
	}
	if b, err := os.ReadFile(filepath.Join(root, "/proc/uptime")); err == nil {
		if f := strings.Fields(string(b)); len(f) > 0 {
			v, _ := strconv.ParseFloat(f[0], 64)
			h.UptimeS = int64(v)
		}
	}
	if m, err := meminfo(filepath.Join(root, "/proc/meminfo")); err == nil {
		h.MemTotal, h.MemAvail = m["MemTotal"], m["MemAvailable"]
		h.SwapTotal, h.SwapFree = m["SwapTotal"], m["SwapFree"]
	} else {
		errs = append(errs, "meminfo")
	}
	if total, idle, cpus, err := procStat(filepath.Join(root, "/proc/stat")); err == nil {
		h.CPUs = cpus
		if c.host.cpuTotal > 0 && total > c.host.cpuTotal {
			dt, di := float64(total-c.host.cpuTotal), float64(idle-c.host.cpuIdle)
			pct := (1 - di/dt) * 100
			if pct < 0 {
				pct = 0
			}
			h.CPUPct = &pct
		}
		c.host.cpuTotal, c.host.cpuIdle = total, idle
	}
	if b, err := os.ReadFile(filepath.Join(root, "/proc/sys/kernel/osrelease")); err == nil {
		h.Kernel = strings.TrimSpace(string(b))
	}
	h.OS = osPretty(filepath.Join(root, "/etc/os-release"))
	if c.Cfg.Host.TempFile != "" {
		if b, err := os.ReadFile(filepath.Join(root, c.Cfg.Host.TempFile)); err == nil {
			if v, err := strconv.ParseFloat(strings.TrimSpace(string(b)), 64); err == nil {
				t := v / 1000
				h.TempC = &t
			}
		}
	}
	if args := c.Cfg.Host.ThrottleCmd; len(args) > 0 {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		out, err := c.Cmd(cctx, args[0], args[1:]...)
		cancel()
		if err == nil {
			// "throttled=0x0"
			v := strings.TrimSpace(string(out))
			if _, after, ok := strings.Cut(v, "="); ok {
				v = after
			}
			h.Throttled = &v
		} else {
			errs = append(errs, "throttle_cmd")
		}
	}
	for _, m := range c.Cfg.Host.Mounts {
		var st syscall.Statfs_t
		if err := syscall.Statfs(filepath.Join(root, m), &st); err != nil {
			errs = append(errs, "statfs "+m)
			continue
		}
		size := int64(st.Blocks) * int64(st.Bsize)
		free := int64(st.Bavail) * int64(st.Bsize)
		h.Disks = append(h.Disks, snapshot.Disk{Mount: m, Size: size, Used: size - free})
	}
	if dev := c.Cfg.Host.WriteDevice; dev != "" {
		if b, err := os.ReadFile(filepath.Join(root, "/sys/block", dev, "stat")); err == nil {
			f := strings.Fields(string(b))
			if len(f) > 6 {
				sec, _ := strconv.ParseUint(f[6], 10, 64)
				if !c.host.sectorsAt.IsZero() && sec >= c.host.sectors {
					dt := now.Sub(c.host.sectorsAt).Seconds()
					if dt > 0 {
						// a rate over one interval is noisy; smooth it
						r := float64(sec-c.host.sectors) * 512 / dt * 86400 / (1 << 30)
						if c.writesEWMA == nil {
							c.writesEWMA = &r
						} else {
							v := *c.writesEWMA*0.9 + r*0.1
							c.writesEWMA = &v
						}
						v := *c.writesEWMA
						h.WritesGiBd = &v
					}
				}
				c.host.sectors, c.host.sectorsAt = sec, now
			}
		}
	}
	if len(errs) > 0 {
		return h, fmt.Errorf("could not read %s", strings.Join(errs, ", "))
	}
	return h, nil
}

func meminfo(p string) (map[string]int64, error) {
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	m := map[string]int64{}
	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		f := strings.Fields(v)
		if len(f) == 0 {
			continue
		}
		n, _ := strconv.ParseInt(f[0], 10, 64)
		if len(f) > 1 && f[1] == "kB" {
			n *= 1024
		}
		m[k] = n
	}
	return m, nil
}

func procStat(p string) (total, idle uint64, cpus int, err error) {
	b, err := os.ReadFile(p)
	if err != nil {
		return 0, 0, 0, err
	}
	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "cpu ") {
			f := strings.Fields(line)[1:]
			for i, s := range f {
				v, _ := strconv.ParseUint(s, 10, 64)
				if i >= 8 { // guest time is already in user/nice
					break
				}
				total += v
				if i == 3 || i == 4 { // idle + iowait
					idle += v
				}
			}
		} else if strings.HasPrefix(line, "cpu") {
			cpus++
		}
	}
	return total, idle, cpus, nil
}

func osPretty(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(line, "PRETTY_NAME="); ok {
			return strings.Trim(v, `"`)
		}
	}
	return ""
}
