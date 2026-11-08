package redact

import (
	"strings"
	"testing"
)

func TestRedacts(t *testing.T) {
	cases := map[string]string{
		"push to https://ntfy.sh/my-secret-topic failed":      "my-secret-topic",
		"token=abcdef123456 rejected":                         "abcdef123456",
		"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload":  "eyJhbGciOiJIUzI1NiJ9",
		"manifest 3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6 moved": "3f2a9c1e",
		"password: hunter2hunter2":                            "hunter2",
		"key 0123456789abcdef0123456789abcdef0123 leaked":     "0123456789abcdef0123",
	}
	for in, secret := range cases {
		if out := String(in); strings.Contains(out, secret) {
			t.Errorf("%q -> %q still contains %q", in, out, secret)
		}
	}
}

func TestKeepsOrdinaryText(t *testing.T) {
	for _, s := range []string{
		"Homelab: storage needs attention",
		"homelab-backup.service failed on raspberrypi",
		"integrity_check ok, ciphers=412 (live now 412)",
		"Uptime Kuma: Home Assistant is DOWN",
	} {
		if got := String(s); got != s {
			t.Errorf("%q changed to %q", s, got)
		}
	}
}

func TestLineTruncates(t *testing.T) {
	if got := Line(strings.Repeat("word ", 10), 10); len([]rune(got)) != 10 || !strings.HasSuffix(got, "…") {
		t.Fatalf("got %q", got)
	}
}
