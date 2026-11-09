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
	// Credentials inside any URL: scheme://user:pass@host
	{regexp.MustCompile(`(?i)\b([a-z][a-z0-9+.-]*://)[^/\s:@"']+:[^/\s@"']*@`), "${1}[redacted]@"},
	// Bearer and Basic authorization values.
	{regexp.MustCompile(`(?i)\b(bearer|basic)\s+[a-z0-9._~+/=-]{8,}`), "$1 [redacted]"},
	// JSON web tokens and AWS access key ids.
	{regexp.MustCompile(`\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}`), "[jwt]"},
	{regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`), "[aws-key]"},
	// command-line flags: --password hunter2
	{regexp.MustCompile(`(?i)(--?(?:password|passwd|pwd|token|secret|api[_-]?key))(\s+|=)("[^"]*"|'[^']*'|\S+)`), "$1$2[redacted]"},
	// URLs: keep scheme and host, drop path and query (tokens hide there).
	{regexp.MustCompile(`\b(https?://[^/\s"']+)/[^\s"']*`), "$1/…"},
	// key=value or key: value where the key smells secret.
	{regexp.MustCompile(`(?i)\b([a-z0-9_.-]*(?:pass(?:word)?|passwd|pwd|secret|token|api[_-]?key|auth|cookie|session|topic|private[_-]?key)[a-z0-9_.-]*)("?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)`), "$1$2[redacted]"},
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
