// Package redact removes things that look like credentials from text that
// came out of logs before it is shown in the browser. Cockpit only shows alert
// titles and one-line summaries, which the homelab scripts already keep free of
// secrets; this is the second fence, not the first.
package redact

import "regexp"

var rules = []struct {
	re  *regexp.Regexp
	rep string
}{
	// Bearer tokens.
	{regexp.MustCompile(`(?i)\bbearer\s+[a-z0-9._~+/=-]{8,}`), "Bearer [redacted]"},
	// URLs: keep scheme and host, drop path and query (tokens hide there).
	{regexp.MustCompile(`\b(https?://[^/\s"']+)/[^\s"']*`), "$1/…"},
	// key=value or key: value where the key smells secret.
	{regexp.MustCompile(`(?i)\b([a-z0-9_.-]*(?:pass(?:word)?|secret|token|api[_-]?key|auth|bearer|cookie|session|topic|private[_-]?key)[a-z0-9_.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)`), "$1$2[redacted]"},
	// UUIDs.
	{regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`), "[uuid]"},
	// Long hex or base64-ish runs (keys, hashes, signed blobs).
	{regexp.MustCompile(`\b[A-Fa-f0-9]{32,}\b`), "[hex]"},
	{regexp.MustCompile(`\b[A-Za-z0-9+/_-]{40,}={0,2}`), "[blob]"},
}

// String returns s with likely secrets replaced.
func String(s string) string {
	for _, r := range rules {
		s = r.re.ReplaceAllString(s, r.rep)
	}
	return s
}

// Line also truncates to n runes, for one-line summaries.
func Line(s string, n int) string {
	s = String(s)
	r := []rune(s)
	if len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}
