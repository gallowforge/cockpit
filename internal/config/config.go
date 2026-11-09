package config

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config is everything cockpit.conf can set. Zero values are filled with the
// defaults in Default(), which match the homelab layout this tool was built for.
type Config struct {
	Title        string
	StatePath    string
	RunbookDir   string
	Interval     time.Duration
	SlowInterval time.Duration
	History      int

	Web      Web
	Host     Host
	Docker   Docker
	Homelab  Homelab
	Timers   Timers
	Services []Service
	Runbooks []Runbook
}

type Web struct {
	Listen           string // "127.0.0.1:8080", "unix:/run/cockpit/web.sock" or "systemd"
	Auth             string // "password" or "none"
	Username         string // the one owner account's name; the password hash is in PasswordHashFile
	PasswordHashFile string
	CookieSecure     string // auto, always, never
	SessionDays      int
	TrustProxy       bool
}

type Host struct {
	Mounts      []string
	TempFile    string
	ThrottleCmd []string
	WriteDevice string
}

type Docker struct {
	Enabled bool
	Socket  string
}

type Homelab struct {
	Enabled          bool
	BackupConf       string
	BackupStatus     string
	NotifyState      string
	MaintenanceFlag  string
	Repo             string
	Manifest         string
	HealthUnit       string
	HealthCategories []string
	BackupUnit       string
	DrillUnit        string
	HeartbeatUnit    string
	NotifyTag        string
	InfoKeys         []string
	SelfDisabling    []string // MANIFEST timers allowed to be disabled
	AlertWindow      time.Duration
	EventsDays       int
}

type Timers struct {
	Show        []string // glob patterns; "*" shows every timer
	Highlight   []string
	History     []string // services whose runs are read from the journal
	HistoryDays int
}

// Service is a [service:<id>] block: a friendly name for a container, a
// systemd unit and/or a probe, merged into one row.
type Service struct {
	ID        string
	Title     string
	Note      string
	Group     string
	Container string
	Unit      string
	Probe     string // https://..., http://..., tcp://host:port, dns://server:port/name
	SNI       string
	Expect    string // HTTP status ranges, e.g. "200-399" (default) or "200,401"
	URL       string // where "Open" goes
	Runbook   string
}

// Runbook is a [runbook:<id>] block.
type Runbook struct {
	ID    string
	Title string
	File  string
	URL   string
	Match []string
}

// Default returns the defaults, tuned for a Raspberry Pi homelab.
func Default() *Config {
	return &Config{
		Title:        hostname(),
		StatePath:    "/run/cockpit/state.json",
		RunbookDir:   "/run/cockpit/runbooks",
		Interval:     20 * time.Second,
		SlowInterval: 5 * time.Minute,
		History:      90,
		Web: Web{
			Listen:           "127.0.0.1:8080",
			Auth:             "password",
			Username:         "owner",
			PasswordHashFile: "/etc/cockpit/password.hash",
			CookieSecure:     "auto",
			SessionDays:      365,
		},
		Host: Host{
			Mounts:   []string{"/"},
			TempFile: "/sys/class/thermal/thermal_zone0/temp",
		},
		Docker: Docker{Enabled: true, Socket: "/var/run/docker.sock"},
		Homelab: Homelab{
			Enabled:         true,
			BackupConf:      "/etc/homelab/backups.conf",
			BackupStatus:    "/var/lib/homelab/backup-status",
			NotifyState:     "/var/lib/homelab/notify",
			MaintenanceFlag: "/run/homelab/maintenance",
			Repo:            "/home/pi/docker",
			HealthUnit:      "homelab-health.service",
			HealthCategories: strings.Fields("backups mirror containers memory storage units reboot tls " +
				"tailscale dns power homeassistant updates updates-watchtower reminders guards config-drift"),
			BackupUnit:    "homelab-backup.service",
			DrillUnit:     "homelab-restore-test.service",
			HeartbeatUnit: "homelab-heartbeat.service",
			NotifyTag:     "homelab-notify",
			AlertWindow:   8 * 24 * time.Hour,
			EventsDays:    30,
		},
		Timers: Timers{
			Show:        []string{"*"},
			Highlight:   []string{"homelab-*"},
			HistoryDays: 30,
		},
	}
}

// Load reads and validates the file at p.
func Load(p string) (*Config, error) {
	fh, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	ini, err := ParseINI(fh)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", p, err)
	}
	c, err := FromINI(ini)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", p, err)
	}
	return c, nil
}

// FromINI applies a parsed file on top of the defaults.
func FromINI(f *File) (*Config, error) {
	c := Default()
	var errs []string
	bad := func(s *Section, format string, a ...any) {
		errs = append(errs, fmt.Sprintf("line %d [%s]: %s", s.Line, s.Kind, fmt.Sprintf(format, a...)))
	}
	known := map[string]map[string]bool{
		"cockpit": set("title state runbook_dir interval slow_interval history"),
		"web":     set("listen auth username password_hash_file cookie_secure session_days trust_proxy"),
		"host":    set("mounts temp_file throttle_cmd write_device"),
		"docker":  set("enabled socket"),
		"homelab": set("enabled backup_conf backup_status notify_state maintenance_flag repo manifest health_unit " +
			"health_categories backup_unit drill_unit heartbeat_unit notify_tag info_keys self_disabling alert_window events_days"),
		"timers":  set("show highlight history history_days"),
		"service": set("title note group container unit probe sni expect url runbook"),
		"runbook": set("title file url match"),
	}
	for _, s := range f.Sections {
		keys, ok := known[s.Kind]
		if !ok {
			bad(s, "unknown section")
			continue
		}
		for _, k := range s.Keys() {
			if !keys[k] {
				bad(s, "unknown key %q", k)
			}
		}
		named := s.Kind == "service" || s.Kind == "runbook"
		if named && s.Name == "" {
			bad(s, "needs a name, e.g. [%s:example]", s.Kind)
		}
		if !named && s.Name != "" {
			bad(s, "takes no name")
		}
	}

	if s := f.Find("cockpit"); s != nil {
		c.Title = s.Get("title", c.Title)
		c.StatePath = s.Get("state", c.StatePath)
		c.RunbookDir = s.Get("runbook_dir", c.RunbookDir)
		c.Interval = dur(s, "interval", c.Interval, bad)
		c.SlowInterval = dur(s, "slow_interval", c.SlowInterval, bad)
		c.History = num(s, "history", c.History, bad)
	}
	if s := f.Find("web"); s != nil {
		c.Web.Listen = s.Get("listen", c.Web.Listen)
		c.Web.Auth = s.Get("auth", c.Web.Auth)
		c.Web.Username = s.Get("username", c.Web.Username)
		c.Web.PasswordHashFile = s.Get("password_hash_file", c.Web.PasswordHashFile)
		c.Web.CookieSecure = s.Get("cookie_secure", c.Web.CookieSecure)
		c.Web.SessionDays = num(s, "session_days", c.Web.SessionDays, bad)
		c.Web.TrustProxy = boolean(s, "trust_proxy", c.Web.TrustProxy, bad)
	}
	if s := f.Find("host"); s != nil {
		c.Host.Mounts = fields(s, "mounts", c.Host.Mounts)
		c.Host.TempFile = s.Get("temp_file", c.Host.TempFile)
		c.Host.ThrottleCmd = fields(s, "throttle_cmd", c.Host.ThrottleCmd)
		c.Host.WriteDevice = s.Get("write_device", c.Host.WriteDevice)
	}
	if s := f.Find("docker"); s != nil {
		c.Docker.Enabled = boolean(s, "enabled", c.Docker.Enabled, bad)
		c.Docker.Socket = s.Get("socket", c.Docker.Socket)
	}
	if s := f.Find("homelab"); s != nil {
		h := &c.Homelab
		h.Enabled = boolean(s, "enabled", h.Enabled, bad)
		h.BackupConf = s.Get("backup_conf", h.BackupConf)
		h.BackupStatus = s.Get("backup_status", h.BackupStatus)
		h.NotifyState = s.Get("notify_state", h.NotifyState)
		h.MaintenanceFlag = s.Get("maintenance_flag", h.MaintenanceFlag)
		h.Repo = s.Get("repo", h.Repo)
		h.Manifest = s.Get("manifest", h.Manifest)
		h.HealthUnit = s.Get("health_unit", h.HealthUnit)
		h.HealthCategories = fields(s, "health_categories", h.HealthCategories)
		h.BackupUnit = s.Get("backup_unit", h.BackupUnit)
		h.DrillUnit = s.Get("drill_unit", h.DrillUnit)
		h.HeartbeatUnit = s.Get("heartbeat_unit", h.HeartbeatUnit)
		h.NotifyTag = s.Get("notify_tag", h.NotifyTag)
		h.InfoKeys = fields(s, "info_keys", h.InfoKeys)
		h.SelfDisabling = fields(s, "self_disabling", h.SelfDisabling)
		h.AlertWindow = dur(s, "alert_window", h.AlertWindow, bad)
		h.EventsDays = num(s, "events_days", h.EventsDays, bad)
	}
	if c.Homelab.Manifest == "" {
		c.Homelab.Manifest = filepath.Join(c.Homelab.Repo, "_host", "MANIFEST")
	}
	if s := f.Find("timers"); s != nil {
		c.Timers.Show = fields(s, "show", c.Timers.Show)
		c.Timers.Highlight = fields(s, "highlight", c.Timers.Highlight)
		c.Timers.History = fields(s, "history", c.Timers.History)
		c.Timers.HistoryDays = num(s, "history_days", c.Timers.HistoryDays, bad)
	}
	if len(c.Timers.History) == 0 && c.Homelab.Enabled {
		c.Timers.History = nonEmpty(c.Homelab.BackupUnit, c.Homelab.DrillUnit, c.Homelab.HealthUnit, c.Homelab.HeartbeatUnit)
	}
	for _, s := range f.All("service") {
		sv := Service{
			ID: s.Name, Title: s.Get("title", s.Name), Note: s.Get("note", ""), Group: s.Get("group", ""),
			Container: s.Get("container", ""), Unit: s.Get("unit", ""), Probe: s.Get("probe", ""),
			SNI: s.Get("sni", ""), Expect: s.Get("expect", ""), URL: s.Get("url", ""), Runbook: s.Get("runbook", ""),
		}
		if sv.Container == "" && sv.Unit == "" && sv.Probe == "" {
			bad(s, "needs at least one of container, unit or probe")
		}
		if sv.Probe != "" {
			if err := ValidateProbe(sv.Probe); err != nil {
				bad(s, "probe: %v", err)
			}
		}
		if sv.Expect != "" {
			if _, err := ParseExpect(sv.Expect); err != nil {
				bad(s, "expect: %v", err)
			}
		}
		c.Services = append(c.Services, sv)
	}
	for _, s := range f.All("runbook") {
		rb := Runbook{ID: s.Name, Title: s.Get("title", s.Name), File: s.Get("file", ""), URL: s.Get("url", ""),
			Match: fields(s, "match", nil)}
		if (rb.File == "") == (rb.URL == "") {
			bad(s, "needs exactly one of file or url")
		}
		if rb.File != "" && !filepath.IsAbs(rb.File) {
			bad(s, "file must be an absolute path")
		}
		for _, m := range rb.Match {
			if _, err := path.Match(m, ""); err != nil {
				bad(s, "bad match pattern %q", m)
			}
		}
		c.Runbooks = append(c.Runbooks, rb)
	}

	switch c.Web.Auth {
	case "password", "none":
	default:
		errs = append(errs, fmt.Sprintf("[web] auth must be password or none, not %q", c.Web.Auth))
	}
	if !validUsername(c.Web.Username) {
		errs = append(errs, "[web] username must be 1 to 64 characters with no spaces")
	}
	switch c.Web.CookieSecure {
	case "auto", "always", "never":
	default:
		errs = append(errs, fmt.Sprintf("[web] cookie_secure must be auto, always or never, not %q", c.Web.CookieSecure))
	}
	if c.Interval < 2*time.Second {
		errs = append(errs, "[cockpit] interval must be at least 2s")
	}
	if c.SlowInterval < c.Interval {
		errs = append(errs, "[cockpit] slow_interval must not be shorter than interval")
	}
	if c.History < 10 || c.History > 1000 {
		errs = append(errs, "[cockpit] history must be between 10 and 1000 samples")
	}
	if !filepath.IsAbs(c.StatePath) {
		errs = append(errs, "[cockpit] state must be an absolute path")
	}
	if len(errs) > 0 {
		head := "1 problem"
		if len(errs) > 1 {
			head = fmt.Sprintf("%d problems", len(errs))
		}
		return nil, fmt.Errorf("%s:\n  %s", head, strings.Join(errs, "\n  "))
	}
	return c, nil
}

// ValidateProbe checks a probe URL's scheme and shape.
func ValidateProbe(p string) error {
	scheme, rest, ok := strings.Cut(p, "://")
	if !ok || rest == "" {
		return fmt.Errorf("%q is not scheme://target", p)
	}
	switch scheme {
	case "http", "https":
		return nil
	case "tcp":
		if !strings.Contains(rest, ":") {
			return fmt.Errorf("tcp probe needs host:port")
		}
		return nil
	case "dns":
		server, name, ok := strings.Cut(rest, "/")
		if !ok || name == "" || !strings.Contains(server, ":") {
			return fmt.Errorf("dns probe is dns://server:port/name")
		}
		return nil
	}
	return fmt.Errorf("unknown probe scheme %q (http, https, tcp, dns)", scheme)
}

// Range is an inclusive status-code range.
type Range struct{ Lo, Hi int }

// ParseExpect parses "200-399,401" into ranges.
func ParseExpect(s string) ([]Range, error) {
	var out []Range
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		lo, hi, isRange := strings.Cut(part, "-")
		a, err := strconv.Atoi(lo)
		if err != nil {
			return nil, fmt.Errorf("bad status %q", part)
		}
		b := a
		if isRange {
			if b, err = strconv.Atoi(hi); err != nil || b < a {
				return nil, fmt.Errorf("bad range %q", part)
			}
		}
		if a < 100 || b > 599 {
			return nil, fmt.Errorf("status out of range in %q", part)
		}
		out = append(out, Range{a, b})
	}
	return out, nil
}

// Matches reports whether any of the glob patterns matches name.
func Matches(patterns []string, name string) bool {
	for _, p := range patterns {
		if ok, _ := path.Match(p, name); ok {
			return true
		}
	}
	return false
}

func set(words string) map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(words) {
		m[w] = true
	}
	return m
}

func dur(s *Section, k string, def time.Duration, bad func(*Section, string, ...any)) time.Duration {
	v := s.Get(k, "")
	if v == "" {
		return def
	}
	if strings.HasSuffix(v, "d") {
		if n, err := strconv.Atoi(strings.TrimSuffix(v, "d")); err == nil && n > 0 {
			return time.Duration(n) * 24 * time.Hour
		}
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		bad(s, "%s: %q is not a duration like 20s, 5m or 8d", k, v)
		return def
	}
	return d
}

func num(s *Section, k string, def int, bad func(*Section, string, ...any)) int {
	v := s.Get(k, "")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		bad(s, "%s: %q is not a whole number", k, v)
		return def
	}
	return n
}

func boolean(s *Section, k string, def bool, bad func(*Section, string, ...any)) bool {
	switch strings.ToLower(s.Get(k, "")) {
	case "":
		return def
	case "true", "yes", "on", "1":
		return true
	case "false", "no", "off", "0":
		return false
	}
	bad(s, "%s: expected true or false", k)
	return def
}

func fields(s *Section, k string, def []string) []string {
	if !s.Has(k) {
		return def
	}
	return strings.Fields(s.Get(k, ""))
}

func nonEmpty(v ...string) []string {
	var out []string
	for _, s := range v {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "cockpit"
	}
	return h
}

// validUsername accepts what a password manager stores as a login name:
// 1 to 64 printable characters, no spaces.
func validUsername(u string) bool {
	if u == "" || len(u) > 64 {
		return false
	}
	for _, r := range u {
		if r <= ' ' || r == 0x7f {
			return false
		}
	}
	return true
}
