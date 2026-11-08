package collect

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gallowforge/cockpit/internal/config"
	"github.com/gallowforge/cockpit/internal/snapshot"
)

// probe checks one endpoint the way a client would. Results never include
// response bodies.
func probe(ctx context.Context, sv config.Service, now time.Time) snapshot.Probe {
	p := snapshot.Probe{Target: displayTarget(sv.Probe)}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	start := time.Now()
	scheme, rest, _ := strings.Cut(sv.Probe, "://")
	var err error
	switch scheme {
	case "tcp":
		var d net.Dialer
		var conn net.Conn
		conn, err = d.DialContext(ctx, "tcp", rest)
		if err == nil {
			conn.Close()
		}
	case "dns":
		server, name, _ := strings.Cut(rest, "/")
		r := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, server)
		}}
		var addrs []string
		addrs, err = r.LookupHost(ctx, name)
		if err == nil && len(addrs) == 0 {
			err = errors.New("no answer")
		}
	case "http", "https":
		err = httpProbe(ctx, sv, &p, now)
	default:
		err = fmt.Errorf("unknown probe scheme %q", scheme)
	}
	p.LatencyMS = float64(time.Since(start).Microseconds()) / 1000
	if err != nil {
		p.Error = probeErr(err)
		return p
	}
	p.OK = true
	return p
}

func httpProbe(ctx context.Context, sv config.Service, p *snapshot.Probe, now time.Time) error {
	tr := &http.Transport{
		TLSClientConfig:   &tls.Config{ServerName: sv.SNI, MinVersion: tls.VersionTLS12},
		DisableKeepAlives: true,
		Proxy:             nil,
	}
	cl := &http.Client{Transport: tr, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sv.Probe, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "cockpit-probe")
	if sv.SNI != "" {
		req.Host = sv.SNI
	}
	res, err := cl.Do(req)
	if err != nil {
		return err
	}
	res.Body.Close()
	p.Code = res.StatusCode
	if res.TLS != nil && len(res.TLS.PeerCertificates) > 0 {
		days := int(res.TLS.PeerCertificates[0].NotAfter.Sub(now).Hours() / 24)
		p.CertDays = &days
	}
	want := []config.Range{{Lo: 200, Hi: 399}}
	if sv.Expect != "" {
		if r, err := config.ParseExpect(sv.Expect); err == nil {
			want = r
		}
	}
	for _, r := range want {
		if res.StatusCode >= r.Lo && res.StatusCode <= r.Hi {
			return nil
		}
	}
	return fmt.Errorf("HTTP %d", res.StatusCode)
}

// displayTarget drops the path of an HTTP probe; it can carry a token.
func displayTarget(p string) string {
	scheme, rest, _ := strings.Cut(p, "://")
	host, _, _ := strings.Cut(rest, "/")
	if scheme == "dns" {
		return "dns " + host
	}
	return scheme + "://" + host
}

func probeErr(err error) string {
	var ne net.Error
	switch {
	case errors.As(err, &ne) && ne.Timeout():
		return "timeout"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	}
	s := err.Error()
	for _, k := range []string{"connection refused", "no such host", "certificate", "HTTP ", "no answer", "reset by peer", "i/o timeout"} {
		if i := strings.Index(s, k); i >= 0 {
			return s[i:]
		}
	}
	if len(s) > 90 {
		s = s[:90]
	}
	return s
}
