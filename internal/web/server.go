// Package web serves the dashboard: the embedded UI, the snapshot as JSON, a
// Server-Sent Events stream of changes, local runbooks and the login. It has
// no write path to the system: every route only reads.
package web

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

const cookieName = "vesper_session"

// The web process runs as a DynamicUser with no /etc/mime.types to fall back
// on, so the app manifest's type is registered here.
func init() { _ = mime.AddExtensionType(".webmanifest", "application/manifest+json") }

// Options configure a Server.
type Options struct {
	Title        string
	Version      string
	Demo         bool
	AuthMode     string // "password" or "none"
	Username     string // the owner account's name (password mode)
	PasswordHash string
	MachineID    string
	SessionTTL   time.Duration
	CookieSecure string // auto, always, never
	TrustProxy   bool
	RunbookDir   string
	UI           fs.FS
	Log          *log.Logger
	MaxStreams   int
	Now          func() time.Time
}

// Server is an http.Handler.
type Server struct {
	opt      Options
	store    *Store
	sessions *sessions
	limit    *limiter
	mux      *http.ServeMux
	streams  atomic.Int32
	checking chan struct{} // one password check at a time: a burst cannot outrun the limiter
	static   http.Handler
	index    []byte
	tags     map[string]string // validators for the UI's unhashed files, by URL path
}

// New builds the handler. It refuses to start with password auth and no hash.
func New(store *Store, opt Options) (*Server, error) {
	if opt.Log == nil {
		opt.Log = log.New(io.Discard, "", 0)
	}
	if opt.Now == nil {
		opt.Now = time.Now
	}
	if opt.MaxStreams == 0 {
		opt.MaxStreams = 32
	}
	if opt.SessionTTL == 0 {
		opt.SessionTTL = 365 * 24 * time.Hour
	}
	s := &Server{opt: opt, store: store, limit: newLimiter(), mux: http.NewServeMux(), checking: make(chan struct{}, 1)}
	switch opt.AuthMode {
	case "none":
	case "password":
		if !strings.HasPrefix(opt.PasswordHash, hashPrefix+"$") {
			return nil, errors.New("auth = password, but no valid password hash was found (create one with: vesper hash-password)")
		}
		if opt.Username == "" {
			return nil, errors.New("auth = password needs a username")
		}
		// the session key covers the username too: renaming the account signs every device out
		s.sessions = newSessions(opt.Username+"\n"+opt.PasswordHash, opt.MachineID, opt.SessionTTL)
	default:
		return nil, fmt.Errorf("unknown auth mode %q", opt.AuthMode)
	}
	if opt.UI != nil {
		s.static = http.FileServerFS(opt.UI)
		if b, err := fs.ReadFile(opt.UI, "index.html"); err == nil {
			s.index = b
		}
		s.tags = fileTags(opt.UI)
	}
	s.mux.HandleFunc("GET /healthz", s.healthz)
	s.mux.HandleFunc("GET /api/session", s.session)
	s.mux.HandleFunc("POST /api/login", s.login)
	s.mux.HandleFunc("POST /api/logout", s.logout)
	s.mux.HandleFunc("GET /api/state", s.authed(s.state))
	s.mux.HandleFunc("GET /api/events", s.authed(s.events))
	s.mux.HandleFunc("GET /api/runbooks/{id}", s.authed(s.runbook))
	s.mux.HandleFunc("GET /", s.ui)
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cross-Origin-Opener-Policy", "same-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "+
		"font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	s.mux.ServeHTTP(w, r)
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	body, _, updated := s.store.Get()
	w.Header().Set("Cache-Control", "no-store")
	if len(body) == 0 {
		http.Error(w, "no snapshot yet", http.StatusServiceUnavailable)
		return
	}
	fmt.Fprintf(w, "ok %ds\n", int(s.opt.Now().Sub(updated).Seconds()))
}

func (s *Server) loggedIn(r *http.Request) bool {
	if s.opt.AuthMode == "none" {
		return true
	}
	c, err := r.Cookie(cookieName)
	return err == nil && s.sessions.valid(c.Value, s.opt.Now())
}

func (s *Server) authed(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.loggedIn(r) {
			w.Header().Set("Cache-Control", "no-store")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "sign in first"})
			return
		}
		h(w, r)
	}
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"auth":          s.opt.AuthMode,
		"authenticated": s.loggedIn(r),
		"title":         s.opt.Title,
		"demo":          s.opt.Demo,
		"version":       s.opt.Version,
	})
}

// sameOrigin rejects cross-site form posts: a login must come from the page
// itself, as JSON.
func (s *Server) sameOrigin(r *http.Request) bool {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		return false
	}
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	host := r.Host
	if s.opt.TrustProxy {
		if fh := r.Header.Get("X-Forwarded-Host"); fh != "" {
			host = fh
		}
	}
	_, rest, ok := strings.Cut(o, "://")
	return ok && strings.EqualFold(rest, host)
}

func (s *Server) client(r *http.Request) string {
	if s.opt.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1]) // the hop our proxy added
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) secure(r *http.Request) bool {
	switch s.opt.CookieSecure {
	case "always":
		return true
	case "never":
		return false
	}
	return r.TLS != nil || (s.opt.TrustProxy && r.Header.Get("X-Forwarded-Proto") == "https")
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.opt.AuthMode == "none" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !s.sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "cross-origin login refused"})
		return
	}
	who := s.client(r)
	select {
	case s.checking <- struct{}{}:
		defer func() { <-s.checking }()
	case <-time.After(10 * time.Second):
		w.Header().Set("Retry-After", "10")
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "too many attempts", "retry_after": 10})
		return
	case <-r.Context().Done():
		return
	}
	now := s.opt.Now()
	if ok, wait := s.limit.allow(who, now); !ok {
		w.Header().Set("Retry-After", fmt.Sprint(int(wait.Seconds())+1))
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "too many attempts", "retry_after": int(wait.Seconds()) + 1})
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil || req.Username == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username and password are both needed"})
		return
	}
	// Both halves are always checked, the name in constant time, so a wrong
	// username costs the same time, gets the same answer and the same back-off
	// as a wrong password: nobody learns whether a name exists.
	userOK := SameUsername(req.Username, s.opt.Username)
	passOK := CheckPassword(s.opt.PasswordHash, req.Password)
	now = s.opt.Now() // the check itself takes a while: a back-off must start after it, not before
	if !userOK || !passOK {
		s.limit.fail(who, now)
		s.opt.Log.Printf("login failed from %s", who)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "wrong username or password"})
		return
	}
	s.limit.succeed(who)
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: s.sessions.issue(now), Path: "/", HttpOnly: true,
		Secure: s.secure(r), SameSite: http.SameSiteStrictMode, MaxAge: int(s.opt.SessionTTL.Seconds()),
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "cross-origin request refused"})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true,
		Secure: s.secure(r), SameSite: http.SameSiteStrictMode, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	body, etag, _ := s.store.Get()
	w.Header().Set("Cache-Control", "no-cache")
	if len(body) == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "the collector has not written a snapshot yet"})
		return
	}
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

// events streams the snapshot: once on connect, then after each change, with
// a comment every 20 s so proxies keep the connection open.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	if n := s.streams.Add(1); int(n) > s.opt.MaxStreams {
		s.streams.Add(-1)
		http.Error(w, "too many open streams", http.StatusServiceUnavailable)
		return
	}
	defer s.streams.Add(-1)
	ch, cancel := s.store.Subscribe()
	defer cancel()
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	send := func() bool {
		body, etag, _ := s.store.Get()
		if len(body) == 0 {
			return true
		}
		_ = rc.SetWriteDeadline(time.Now().Add(15 * time.Second))
		if _, err := fmt.Fprintf(w, "event: snapshot\nid: %s\ndata: %s\n\n", strings.Trim(etag, `"`), body); err != nil {
			return false
		}
		fl.Flush()
		return true
	}
	fmt.Fprint(w, "retry: 3000\n\n")
	if !send() {
		return
	}
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ch:
			if !send() {
				return
			}
		case <-ping.C:
			if !s.loggedIn(r) { // the session expired or the password changed: stop streaming
				return
			}
			_ = rc.SetWriteDeadline(time.Now().Add(15 * time.Second))
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

var runbookID = regexp.MustCompile(`^[A-Za-z0-9_.@-]{1,64}$`)

func (s *Server) runbook(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !runbookID.MatchString(id) || strings.Contains(id, "..") || s.opt.RunbookDir == "" {
		http.NotFound(w, r)
		return
	}
	b, err := os.ReadFile(filepath.Join(s.opt.RunbookDir, id+".md"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(b)
}

func (s *Server) ui(w http.ResponseWriter, r *http.Request) {
	if s.static == nil {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, "Vesper's UI is not built into this binary. Run `make` (it builds web/ first).")
		return
	}
	p := path.Clean(r.URL.Path)
	if strings.HasPrefix(p, "/api/") || p == "/api" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such API route"})
		return
	}
	if p == "/" || p == "/index.html" || !strings.Contains(path.Base(p), ".") {
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(s.index)
		return
	}
	if strings.HasPrefix(p, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		// a file outside /assets keeps its name from one release to the next
		// (the theme script, the icons, the manifest), so it is checked every
		// time; its tag lets the answer be "not changed" rather than the file
		w.Header().Set("Cache-Control", "no-cache")
		if tag := s.tags[p]; tag != "" {
			w.Header().Set("ETag", tag)
		}
	}
	s.static.ServeHTTP(w, r)
}

// fileTags makes a validator from the bytes of each file at the top of the UI.
func fileTags(ui fs.FS) map[string]string {
	tags := map[string]string{}
	entries, err := fs.ReadDir(ui, ".")
	if err != nil {
		return tags
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if b, err := fs.ReadFile(ui, e.Name()); err == nil {
			sum := sha256.Sum256(b)
			tags["/"+e.Name()] = `"` + hex.EncodeToString(sum[:8]) + `"`
		}
	}
	return tags
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
