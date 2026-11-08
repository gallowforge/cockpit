// Package config reads cockpit.conf, a small INI file in the same spirit as the
// homelab's backups.conf: [sections], "key = value" lines, # or ; comments.
// A section can carry a name after a colon ([service:vaultwarden]) and may then
// appear once per name.
package config

import (
	"bufio"
	"fmt"
	"io"
	"strings"
)

// Section is one [kind] or [kind:name] block, with its keys in file order.
type Section struct {
	Kind string
	Name string
	Line int
	keys []string
	vals map[string]string
}

// Get returns the value of key, or def when it is missing or empty.
func (s *Section) Get(key, def string) string {
	if v, ok := s.vals[key]; ok && v != "" {
		return v
	}
	return def
}

// Has reports whether key was set (even to an empty value).
func (s *Section) Has(key string) bool { _, ok := s.vals[key]; return ok }

// Keys returns the keys in the order they appeared.
func (s *Section) Keys() []string { return append([]string(nil), s.keys...) }

// File is a parsed INI document.
type File struct {
	Sections []*Section
}

// Find returns the first section of that kind (unnamed), or nil.
func (f *File) Find(kind string) *Section {
	for _, s := range f.Sections {
		if s.Kind == kind && s.Name == "" {
			return s
		}
	}
	return nil
}

// All returns every section of that kind, named or not, in file order.
func (f *File) All(kind string) []*Section {
	var out []*Section
	for _, s := range f.Sections {
		if s.Kind == kind {
			out = append(out, s)
		}
	}
	return out
}

// ParseINI parses r. Errors carry "line N:" so a typo is easy to find.
func ParseINI(r io.Reader) (*File, error) {
	f := &File{}
	var cur *Section
	seen := map[string]int{}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	n := 0
	for sc.Scan() {
		n++
		line := strings.TrimSpace(sc.Text())
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		if line[0] == '[' {
			if !strings.HasSuffix(line, "]") {
				return nil, fmt.Errorf("line %d: section header must end with ]", n)
			}
			head := strings.TrimSpace(line[1 : len(line)-1])
			kind, name, _ := strings.Cut(head, ":")
			kind, name = strings.TrimSpace(kind), strings.TrimSpace(name)
			if !validIdent(kind) || (name != "" && !validName(name)) {
				return nil, fmt.Errorf("line %d: bad section name [%s]", n, head)
			}
			if prev, dup := seen[head]; dup {
				return nil, fmt.Errorf("line %d: section [%s] already defined on line %d", n, head, prev)
			}
			seen[head] = n
			cur = &Section{Kind: kind, Name: name, Line: n, vals: map[string]string{}}
			f.Sections = append(f.Sections, cur)
			continue
		}
		if cur == nil {
			return nil, fmt.Errorf("line %d: key outside of a [section]", n)
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("line %d: expected key = value", n)
		}
		k = strings.TrimSpace(k)
		if !validIdent(k) {
			return nil, fmt.Errorf("line %d: bad key %q", n, k)
		}
		v = unquote(stripComment(strings.TrimSpace(v)))
		if _, dup := cur.vals[k]; dup {
			return nil, fmt.Errorf("line %d: key %q set twice in [%s]", n, k, cur.Kind)
		}
		cur.keys = append(cur.keys, k)
		cur.vals[k] = v
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return f, nil
}

// stripComment removes a trailing " # comment" (a # preceded by whitespace),
// but leaves URLs with fragments (https://x/#y) and quoted values alone.
func stripComment(v string) string {
	if strings.HasPrefix(v, `"`) {
		return v
	}
	for i := 1; i < len(v); i++ {
		if (v[i] == '#' || v[i] == ';') && (v[i-1] == ' ' || v[i-1] == '\t') {
			return strings.TrimSpace(v[:i])
		}
	}
	return v
}

func unquote(v string) string {
	if len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"' {
		return v[1 : len(v)-1]
	}
	return v
}

func validIdent(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

func validName(s string) bool {
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-' || r == '.' || r == '@') {
			return false
		}
	}
	return s != ""
}
