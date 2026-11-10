package config

import (
	"strings"
	"testing"
	"time"
)

func parse(t *testing.T, s string) (*Config, error) {
	t.Helper()
	f, err := ParseINI(strings.NewReader(s))
	if err != nil {
		return nil, err
	}
	return FromINI(f)
}

func TestDefaultsAndOverrides(t *testing.T) {
	c, err := parse(t, `
# comment
[vesper]
title = pi-one
interval = 15s   # trailing comment
slow_interval = 2m

[web]
listen = systemd
auth = none
username = pilot

[homelab]
repo = /home/alex/docker
alert_window = 3d
info_keys = caretaker-* hotline-*

[service:vault]
title = Vaultwarden
container = vaultwarden
probe = https://127.0.0.1:8452/alive
expect = 200,401
url = https://pi.example-tailnet.ts.net:8452/#/login

[runbook:restore]
file = /home/alex/docker/RESTORE.md
match = backups backup-*
`)
	if err != nil {
		t.Fatal(err)
	}
	if c.Title != "pi-one" || c.Interval != 15*time.Second || c.SlowInterval != 2*time.Minute {
		t.Fatalf("vesper section not applied: %+v", c)
	}
	if c.Web.Listen != "systemd" || c.Web.Auth != "none" || c.Web.Username != "pilot" {
		t.Fatalf("web: %+v", c.Web)
	}
	if c.Homelab.Manifest != "/home/alex/docker/_host/MANIFEST" {
		t.Fatalf("manifest should follow repo, got %q", c.Homelab.Manifest)
	}
	if c.Homelab.AlertWindow != 72*time.Hour || len(c.Homelab.InfoKeys) != 2 {
		t.Fatalf("homelab: %+v", c.Homelab)
	}
	if len(c.Services) != 1 || c.Services[0].URL != "https://pi.example-tailnet.ts.net:8452/#/login" {
		t.Fatalf("a URL fragment must survive comment stripping: %+v", c.Services)
	}
	if len(c.Runbooks) != 1 || len(c.Runbooks[0].Match) != 2 {
		t.Fatalf("runbooks: %+v", c.Runbooks)
	}
	if len(c.Timers.History) != 4 {
		t.Fatalf("timer history should default to the 4 homelab units, got %v", c.Timers.History)
	}
}

// A config written before the rename to Vesper keeps working.
func TestOldSectionName(t *testing.T) {
	c, err := parse(t, "[cockpit]\ntitle = pi\ninterval = 30s\n")
	if err != nil || c.Title != "pi" || c.Interval != 30*time.Second {
		t.Fatalf("[cockpit] not read: %v %+v", err, c)
	}
}

func TestRejectsMistakes(t *testing.T) {
	cases := map[string]string{
		"unknown section":   "[nope]\n",
		"unknown key":       "[vesper]\ntitel = x\n",
		"bad duration":      "[vesper]\ninterval = soon\n",
		"too fast":          "[vesper]\ninterval = 1s\n",
		"service no target": "[service:x]\ntitle = X\n",
		"bad probe scheme":  "[service:x]\nprobe = ftp://host\n",
		"dns probe shape":   "[service:x]\nprobe = dns://127.0.0.1/example.com\n",
		"bad expect":        "[service:x]\nprobe = https://x\nexpect = 99-700\n",
		"runbook both":      "[runbook:r]\nfile = /a.md\nurl = https://x\n",
		"runbook relative":  "[runbook:r]\nfile = a.md\n",
		"auth mode":         "[web]\nauth = maybe\n",
		"username spaces":   "[web]\nusername = the owner\n",
		"unnamed service":   "[service]\ncontainer = x\n",
		"named vesper":      "[vesper:x]\n",
		"named cockpit":     "[cockpit:x]\n",
	}
	for name, src := range cases {
		if _, err := parse(t, src); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestINISyntaxErrors(t *testing.T) {
	for _, src := range []string{"key = 1\n", "[a\n", "[a]\nnovalue\n", "[a]\nk = 1\nk = 2\n", "[a]\n[a]\n"} {
		if _, err := ParseINI(strings.NewReader(src)); err == nil {
			t.Errorf("%q: expected a syntax error", src)
		} else if !strings.Contains(err.Error(), "line ") {
			t.Errorf("%q: error should name the line: %v", src, err)
		}
	}
}

func TestParseExpect(t *testing.T) {
	r, err := ParseExpect("200-299, 401")
	if err != nil || len(r) != 2 || r[0] != (Range{200, 299}) || r[1] != (Range{401, 401}) {
		t.Fatalf("got %v %v", r, err)
	}
}

func TestMatches(t *testing.T) {
	if !Matches([]string{"homelab-*"}, "homelab-backup.timer") || Matches([]string{"homelab-*"}, "apt-daily.timer") {
		t.Fatal("glob matching is wrong")
	}
}
