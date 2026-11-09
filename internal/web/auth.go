package web

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Password hashes are "pbkdf2-sha256$<iterations>$<salt b64>$<key b64>".
const (
	hashPrefix = "pbkdf2-sha256"
	hashIter   = 600_000 // OWASP's 2023+ figure for PBKDF2-HMAC-SHA256
	keyLen     = 32
)

// HashPassword returns a storable hash of pw with a fresh random salt.
func HashPassword(pw string) (string, error) {
	if len(pw) < 12 {
		return "", errors.New("use at least 12 characters")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, pw, salt, hashIter, keyLen)
	if err != nil {
		return "", err
	}
	enc := base64.RawStdEncoding
	return fmt.Sprintf("%s$%d$%s$%s", hashPrefix, hashIter, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

// SameUsername compares a submitted username with the account's in constant
// time (both are hashed first, so even their lengths do not show). Spaces a
// phone keyboard adds around it are ignored.
func SameUsername(got, want string) bool {
	a := sha256.Sum256([]byte(strings.TrimSpace(got)))
	b := sha256.Sum256([]byte(want))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// CheckPassword reports whether pw matches hash, in constant time.
func CheckPassword(hash, pw string) bool {
	parts := strings.Split(strings.TrimSpace(hash), "$")
	if len(parts) != 4 || parts[0] != hashPrefix {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 10_000 || iter > 10_000_000 {
		return false
	}
	enc := base64.RawStdEncoding
	salt, err1 := enc.DecodeString(parts[2])
	want, err2 := enc.DecodeString(parts[3])
	if err1 != nil || err2 != nil || len(want) == 0 {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, pw, salt, iter, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

// sessions signs and checks session cookies: "<expiry unix>.<hmac>". The key
// is derived from the password hash, so changing the password signs everyone
// out, and no session store is needed on disk.
type sessions struct {
	key []byte
	ttl time.Duration
}

func newSessions(passwordHash, machineSecret string, ttl time.Duration) *sessions {
	m := hmac.New(sha256.New, []byte("cockpit-session-v1"))
	m.Write([]byte(passwordHash))
	m.Write([]byte{0})
	m.Write([]byte(machineSecret))
	return &sessions{key: m.Sum(nil), ttl: ttl}
}

func (s *sessions) issue(now time.Time) string {
	exp := strconv.FormatInt(now.Add(s.ttl).Unix(), 10)
	return exp + "." + s.sign(exp)
}

func (s *sessions) valid(token string, now time.Time) bool {
	exp, sig, ok := strings.Cut(token, ".")
	if !ok {
		return false
	}
	if !hmac.Equal([]byte(sig), []byte(s.sign(exp))) {
		return false
	}
	n, err := strconv.ParseInt(exp, 10, 64)
	return err == nil && now.Unix() < n
}

func (s *sessions) sign(v string) string {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(v))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// limiter slows down password guessing: per client, 5 failures then a
// growing wait, and at most 30 failures a minute in total.
type limiter struct {
	mu      sync.Mutex
	clients map[string]*attempts
	global  []time.Time
}

type attempts struct {
	fails int
	until time.Time
	last  time.Time
}

func newLimiter() *limiter { return &limiter{clients: map[string]*attempts{}} }

// allow reports whether a login attempt from client may proceed now, and if
// not, how long to wait.
func (l *limiter) allow(client string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	cut := now.Add(-time.Minute)
	g := l.global[:0]
	for _, t := range l.global {
		if t.After(cut) {
			g = append(g, t)
		}
	}
	l.global = g
	if len(l.global) >= 30 {
		return false, l.global[0].Add(time.Minute).Sub(now)
	}
	if a := l.clients[client]; a != nil && now.Before(a.until) {
		return false, a.until.Sub(now)
	}
	return true, 0
}

func (l *limiter) fail(client string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.clients[client]
	// a client already serving a wait does not push everyone else out
	if a == nil || !now.Before(a.until) {
		l.global = append(l.global, now)
	}
	if a == nil || now.Sub(a.last) > time.Hour {
		a = &attempts{}
		l.clients[client] = a
	}
	a.fails++
	a.last = now
	if a.fails >= 5 {
		wait := time.Duration(1<<min(a.fails-5, 8)) * time.Second // 1s .. 256s
		a.until = now.Add(wait)
	}
	if len(l.clients) > 10_000 { // bound memory under a spray
		for k, v := range l.clients {
			if now.Sub(v.last) > time.Hour {
				delete(l.clients, k)
			}
		}
	}
}

func (l *limiter) succeed(client string) {
	l.mu.Lock()
	delete(l.clients, client)
	l.mu.Unlock()
}
