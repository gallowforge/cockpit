package web

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

const testPassword = "correct horse battery staple"

var testHash string

func init() {
	h, err := HashPassword(testPassword)
	if err != nil {
		panic(err)
	}
	testHash = h
}

func TestHashAndCheck(t *testing.T) {
	if !strings.HasPrefix(testHash, "pbkdf2-sha256$600000$") {
		t.Fatalf("hash format %q", testHash)
	}
	if !CheckPassword(testHash, testPassword) || CheckPassword(testHash, testPassword+"x") || CheckPassword("garbage", testPassword) {
		t.Fatal("password check is wrong")
	}
	if _, err := HashPassword("short"); err == nil {
		t.Fatal("short passwords must be refused")
	}
	other, _ := HashPassword(testPassword)
	if other == testHash {
		t.Fatal("salts must differ")
	}
}

func TestSessions(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	s := newSessions(testHash, "machine", time.Hour)
	tok := s.issue(now)
	if !s.valid(tok, now.Add(59*time.Minute)) || s.valid(tok, now.Add(61*time.Minute)) {
		t.Fatal("expiry is wrong")
	}
	if s.valid(tok+"x", now) || s.valid("123.abc", now) || s.valid("", now) {
		t.Fatal("tampered tokens must fail")
	}
	if newSessions(testHash+"different", "machine", time.Hour).valid(tok, now) {
		t.Fatal("a new password must sign everyone out")
	}
}

func TestLimiter(t *testing.T) {
	l := newLimiter()
	now := time.Unix(1_800_000_000, 0)
	for i := 0; i < 4; i++ {
		if ok, _ := l.allow("a", now); !ok {
			t.Fatalf("attempt %d should be allowed", i)
		}
		l.fail("a", now)
	}
	l.fail("a", now)
	if ok, wait := l.allow("a", now); ok || wait <= 0 {
		t.Fatal("the fifth failure must start a wait")
	}
	if ok, _ := l.allow("b", now); !ok {
		t.Fatal("other clients are not affected")
	}
	if ok, _ := l.allow("a", now.Add(2*time.Second)); !ok {
		t.Fatal("the wait ends")
	}
	l.succeed("a")
	if ok, _ := l.allow("a", now); !ok {
		t.Fatal("success clears the record")
	}
	g := newLimiter()
	for i := 0; i < 30; i++ {
		g.fail(string(rune('A'+i)), now)
	}
	if ok, _ := g.allow("fresh", now); ok {
		t.Fatal("30 failures a minute in total stops everyone")
	}
}

func newServer(t *testing.T, auth string) (*Server, *Store, string) {
	t.Helper()
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "restore.md"), []byte("# Restore\n"), 0o644)
	os.WriteFile(filepath.Join(filepath.Dir(dir), "secret.md"), []byte("nope"), 0o644)
	st := NewStore()
	st.Set([]byte(`{"schema":1,"title":"pi"}`), time.Now())
	ui := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>Cockpit</title>")}, "assets/app.js": {Data: []byte("1")}, "manifest.webmanifest": {Data: []byte("{}")}}
	s, err := New(st, Options{Title: "pi", Version: "test", AuthMode: auth, Username: "owner", PasswordHash: testHash, MachineID: "m",
		RunbookDir: dir, UI: ui, TrustProxy: true})
	if err != nil {
		t.Fatal(err)
	}
	return s, st, dir
}

func do(s http.Handler, method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	return rec
}

func TestRefusesPasswordModeWithoutHash(t *testing.T) {
	if _, err := New(NewStore(), Options{AuthMode: "password"}); err == nil {
		t.Fatal("must refuse to start without a hash")
	}
}

func TestLoginFlow(t *testing.T) {
	s, _, _ := newServer(t, "password")
	if r := do(s, "GET", "/api/state", "", nil); r.Code != 401 {
		t.Fatalf("state without a session: %d", r.Code)
	}
	if r := do(s, "GET", "/api/session", "", nil); !strings.Contains(r.Body.String(), `"authenticated":false`) {
		t.Fatalf("session: %s", r.Body)
	}
	json := map[string]string{"Content-Type": "application/json", "X-Forwarded-For": "192.168.1.20", "X-Forwarded-Proto": "https"}
	if r := do(s, "POST", "/api/login", `{"username":"owner","password":"wrong one here"}`, json); r.Code != 401 {
		t.Fatalf("wrong password: %d", r.Code)
	}
	cross := map[string]string{"Content-Type": "application/json", "Origin": "https://evil.example"}
	if r := do(s, "POST", "/api/login", `{"username":"owner","password":"`+testPassword+`"}`, cross); r.Code != 403 {
		t.Fatalf("cross-origin login must be refused: %d", r.Code)
	}
	form := map[string]string{"Content-Type": "application/x-www-form-urlencoded"}
	if r := do(s, "POST", "/api/login", "password=x", form); r.Code != 403 {
		t.Fatalf("form posts must be refused: %d", r.Code)
	}
	r := do(s, "POST", "/api/login", `{"username":"owner","password":"`+testPassword+`"}`, json)
	if r.Code != 204 {
		t.Fatalf("login: %d %s", r.Code, r.Body)
	}
	c := r.Result().Cookies()
	if len(c) != 1 || !c[0].HttpOnly || !c[0].Secure || c[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie flags: %+v", c)
	}
	cookie := map[string]string{"Cookie": c[0].Name + "=" + c[0].Value}
	if r := do(s, "GET", "/api/state", "", cookie); r.Code != 200 || !strings.Contains(r.Body.String(), `"title":"pi"`) {
		t.Fatalf("state with a session: %d", r.Code)
	}
	etag := do(s, "GET", "/api/state", "", cookie).Header().Get("ETag")
	if r := do(s, "GET", "/api/state", "", map[string]string{"Cookie": cookie["Cookie"], "If-None-Match": etag}); r.Code != 304 {
		t.Fatalf("conditional GET: %d", r.Code)
	}
}

func TestLoginRateLimit(t *testing.T) {
	s, _, _ := newServer(t, "password")
	h := map[string]string{"Content-Type": "application/json", "X-Forwarded-For": "10.0.0.9"}
	for i := 0; i < 5; i++ {
		do(s, "POST", "/api/login", `{"username":"owner","password":"nope nope nope"}`, h)
	}
	r := do(s, "POST", "/api/login", `{"username":"owner","password":"`+testPassword+`"}`, h)
	if r.Code != 429 || r.Header().Get("Retry-After") == "" {
		t.Fatalf("expected 429 with Retry-After, got %d", r.Code)
	}
}

func TestHeadersAndStatic(t *testing.T) {
	s, _, _ := newServer(t, "none")
	r := do(s, "GET", "/", "", nil)
	if r.Code != 200 || !strings.Contains(r.Body.String(), "<title>Cockpit</title>") {
		t.Fatalf("index: %d", r.Code)
	}
	for _, h := range []string{"Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"} {
		if r.Header().Get(h) == "" {
			t.Errorf("missing %s", h)
		}
	}
	if !strings.Contains(r.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Error("CSP must forbid framing")
	}
	if r := do(s, "GET", "/assets/app.js", "", nil); !strings.Contains(r.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("hashed assets are immutable: %q", r.Header().Get("Cache-Control"))
	}
	if r := do(s, "GET", "/healthz", "", nil); r.Code != 200 {
		t.Errorf("healthz %d", r.Code)
	}
}

func TestRunbooks(t *testing.T) {
	s, _, _ := newServer(t, "none")
	if r := do(s, "GET", "/api/runbooks/restore", "", nil); r.Code != 200 || r.Body.String() != "# Restore\n" {
		t.Fatalf("runbook: %d %q", r.Code, r.Body)
	}
	for _, p := range []string{"/api/runbooks/..%2Fsecret", "/api/runbooks/missing", "/api/runbooks/a..b"} {
		if r := do(s, "GET", p, "", nil); r.Code != 404 {
			t.Errorf("%s: %d", p, r.Code)
		}
	}
}

func TestEventsStream(t *testing.T) {
	s, st, _ := newServer(t, "none")
	ts := httptest.NewServer(s)
	defer ts.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", ts.URL+"/api/events", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}
	rd := bufio.NewReader(res.Body)
	readEvent := func() string {
		var data string
		for {
			line, err := rd.ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			if strings.HasPrefix(line, "data: ") {
				data = strings.TrimSpace(strings.TrimPrefix(line, "data: "))
			}
			if line == "\n" && data != "" {
				return data
			}
		}
	}
	if got := readEvent(); !strings.Contains(got, `"title":"pi"`) {
		t.Fatalf("first event: %s", got)
	}
	st.Set([]byte(`{"schema":1,"title":"pi","generated":"later"}`), time.Now())
	if got := readEvent(); !strings.Contains(got, `"later"`) {
		t.Fatalf("update event: %s", got)
	}
}

func TestStoreSkipsIdenticalContent(t *testing.T) {
	st := NewStore()
	ch, cancel := st.Subscribe()
	defer cancel()
	st.Set([]byte("a"), time.Now())
	<-ch
	st.Set([]byte("a"), time.Now())
	select {
	case <-ch:
		t.Fatal("identical content must not wake subscribers")
	default:
	}
}

func TestWatchFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "state.json")
	os.WriteFile(p, []byte(`{"v":1}`), 0o644)
	st := NewStore()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go st.WatchFile(ctx, p, 20*time.Millisecond)
	waitFor(t, func() bool { b, _, _ := st.Get(); return string(b) == `{"v":1}` })
	os.WriteFile(p, []byte(`{"v":22}`), 0o644)
	waitFor(t, func() bool { b, _, _ := st.Get(); return string(b) == `{"v":22}` })
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if ok() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not met in time")
}

func TestListenUnixAndSystemd(t *testing.T) {
	p := filepath.Join(t.TempDir(), "web.sock")
	l, err := Listen("unix:" + p)
	if err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(p)
	if info.Mode().Perm() != 0o660 {
		t.Fatalf("socket mode %v", info.Mode().Perm())
	}
	l.Close()
	os.WriteFile(p, []byte("x"), 0o644)
	if _, err := Listen("unix:" + p); err == nil {
		t.Fatal("must not delete a regular file in the socket's place")
	}
	t.Setenv("LISTEN_PID", "1")
	t.Setenv("LISTEN_FDS", "1")
	if _, err := Listen("systemd"); err == nil {
		t.Fatal("a socket for another PID must be refused")
	}
}

func TestParallelLoginsCannotOutrunTheLimiter(t *testing.T) {
	s, _, _ := newServer(t, "password")
	h := map[string]string{"Content-Type": "application/json", "X-Forwarded-For": "10.0.0.66"}
	codes := make(chan int, 12)
	for i := 0; i < 12; i++ {
		go func() {
			codes <- do(s, "POST", "/api/login", `{"username":"owner","password":"wrong wrong wrong"}`, h).Code
		}()
	}
	wrong, limited := 0, 0
	for i := 0; i < 12; i++ {
		switch <-codes {
		case 401:
			wrong++
		case 429:
			limited++
		}
	}
	if wrong > 5 || limited < 7 {
		t.Fatalf("a burst of 12 got %d password checks (want at most 5) and %d refusals", wrong, limited)
	}
}

func TestUnknownAPIRouteIs404(t *testing.T) {
	s, _, _ := newServer(t, "none")
	if r := do(s, "GET", "/api/typo", "", nil); r.Code != 404 || !strings.Contains(r.Header().Get("Content-Type"), "json") {
		t.Fatalf("got %d %q", r.Code, r.Header().Get("Content-Type"))
	}
}

func TestManifestHasItsType(t *testing.T) {
	s, _, _ := newServer(t, "none")
	r := do(s, "GET", "/manifest.webmanifest", "", nil)
	if r.Code != 200 || r.Header().Get("Content-Type") != "application/manifest+json" {
		t.Fatalf("manifest: %d %q", r.Code, r.Header().Get("Content-Type"))
	}
}

func TestWrongUsernameLooksLikeWrongPassword(t *testing.T) {
	s, _, _ := newServer(t, "password")
	h := map[string]string{"Content-Type": "application/json", "X-Forwarded-For": "10.0.0.77"}
	badUser := do(s, "POST", "/api/login", `{"username":"admin","password":"`+testPassword+`"}`, h)
	badPass := do(s, "POST", "/api/login", `{"username":"owner","password":"not the password"}`, h)
	if badUser.Code != 401 || badPass.Code != 401 || badUser.Body.String() != badPass.Body.String() {
		t.Fatalf("wrong username %d %q, wrong password %d %q: must be identical", badUser.Code, badUser.Body, badPass.Code, badPass.Body)
	}
	// wrong usernames feed the same back-off: three more and the right login waits
	for i := 0; i < 3; i++ {
		do(s, "POST", "/api/login", `{"username":"root","password":"`+testPassword+`"}`, h)
	}
	if r := do(s, "POST", "/api/login", `{"username":"owner","password":"`+testPassword+`"}`, h); r.Code != 429 {
		t.Fatalf("after 5 failures the next try must wait, got %d", r.Code)
	}
	// a password manager's padding around the name is fine; a missing name is refused outright
	s2, _, _ := newServer(t, "password")
	if r := do(s2, "POST", "/api/login", `{"username":" owner ","password":"`+testPassword+`"}`, map[string]string{"Content-Type": "application/json"}); r.Code != 204 {
		t.Fatalf("padded username: %d", r.Code)
	}
	if r := do(s2, "POST", "/api/login", `{"password":"`+testPassword+`"}`, map[string]string{"Content-Type": "application/json"}); r.Code != 400 {
		t.Fatalf("missing username: %d", r.Code)
	}
	if _, err := New(NewStore(), Options{AuthMode: "password", PasswordHash: testHash}); err == nil {
		t.Fatal("password mode must refuse to start without a username")
	}
}
