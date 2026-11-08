// Command cockpit is a self-hosted operations dashboard for a homelab.
//
//	cockpit collect        gather state into state.json (privileged, no network listener)
//	cockpit serve          serve the dashboard (unprivileged, reads state.json)
//	cockpit check          print the status in a terminal; exit 0 ok, 1 warn, 2 crit
//	cockpit demo           serve synthetic data, no setup needed
//	cockpit hash-password  hash a password for [web] password_hash_file
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gallowforge/cockpit/internal/collect"
	"github.com/gallowforge/cockpit/internal/config"
	"github.com/gallowforge/cockpit/internal/demo"
	"github.com/gallowforge/cockpit/internal/snapshot"
	"github.com/gallowforge/cockpit/internal/web"
	"github.com/gallowforge/cockpit/internal/web/ui"
)

var version = "dev"

const defaultConfig = "/etc/cockpit/cockpit.conf"

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		usage(os.Stderr)
		os.Exit(2)
	}
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	code := 0
	switch cmd {
	case "collect":
		err = runCollect(args)
	case "serve":
		err = runServe(args)
	case "check":
		code, err = runCheck(args, os.Stdout)
	case "demo":
		err = runDemo(args)
	case "hash-password":
		err = runHash(args)
	case "version", "--version", "-v":
		fmt.Println("cockpit", version)
	case "help", "--help", "-h":
		usage(os.Stdout)
	default:
		fmt.Fprintf(os.Stderr, "cockpit: unknown command %q\n\n", cmd)
		usage(os.Stderr)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "cockpit:", err)
		os.Exit(3)
	}
	os.Exit(code)
}

func usage(w io.Writer) {
	fmt.Fprint(w, `Cockpit: a self-hosted operations dashboard for a homelab.

Usage:
  cockpit collect [-config FILE] [-once]   gather state into state.json (run as root, no listener)
  cockpit serve   [-config FILE]           serve the dashboard (run unprivileged)
  cockpit check   [-config FILE | -state FILE] [-json]
                                           print the status; exit 0 ok, 1 warn, 2 crit
  cockpit demo    [-listen ADDR] [-scenario calm|attention|incident] [-at TIME]
                                           serve synthetic data, nothing to set up
  cockpit hash-password                    read a password on stdin, print its hash
  cockpit version
`)
}

func loadConfig(p string) (*config.Config, error) {
	c, err := config.Load(p)
	if err != nil && errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("%s not found (start from deploy/cockpit.conf.example)", p)
	}
	return c, err
}

func signalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
}

func runCollect(args []string) error {
	fs := flag.NewFlagSet("collect", flag.ExitOnError)
	cfgPath := fs.String("config", defaultConfig, "config file")
	once := fs.Bool("once", false, "collect once, print the snapshot as JSON, write nothing")
	fs.Parse(args)
	cfg, err := loadConfig(*cfgPath)
	if err != nil {
		return err
	}
	c := collect.New(cfg)
	ctx, cancel := signalContext()
	defer cancel()
	if *once {
		snap := c.Collect(ctx)
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(snap)
	}
	log.Printf("cockpit %s collecting every %s (slow sources every %s) into %s", version, cfg.Interval, cfg.SlowInterval, cfg.StatePath)
	return c.Run(ctx)
}

func readPasswordHash(cfg *config.Config) string {
	if dir := os.Getenv("CREDENTIALS_DIRECTORY"); dir != "" {
		if b, err := os.ReadFile(filepath.Join(dir, "password.hash")); err == nil {
			return strings.TrimSpace(string(b))
		}
	}
	b, err := os.ReadFile(cfg.Web.PasswordHashFile)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func runServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	cfgPath := fs.String("config", defaultConfig, "config file")
	listen := fs.String("listen", "", "override [web] listen")
	fs.Parse(args)
	cfg, err := loadConfig(*cfgPath)
	if err != nil {
		return err
	}
	if *listen != "" {
		cfg.Web.Listen = *listen
	}
	machine, _ := os.ReadFile("/etc/machine-id")
	store := web.NewStore()
	srv, err := web.New(store, web.Options{
		Title: cfg.Title, Version: version, AuthMode: cfg.Web.Auth, PasswordHash: readPasswordHash(cfg),
		MachineID: strings.TrimSpace(string(machine)), SessionTTL: time.Duration(cfg.Web.SessionDays) * 24 * time.Hour,
		CookieSecure: cfg.Web.CookieSecure, TrustProxy: cfg.Web.TrustProxy || cfg.Web.Listen == "systemd" || strings.HasPrefix(cfg.Web.Listen, "unix:"),
		RunbookDir: cfg.RunbookDir, UI: ui.FS(), Log: log.Default(),
	})
	if err != nil {
		return err
	}
	ctx, cancel := signalContext()
	defer cancel()
	// load the snapshot before the first request: with socket activation the
	// request that started us is already waiting
	if b, err := os.ReadFile(cfg.StatePath); err == nil && len(b) > 0 {
		store.Set(b, time.Now())
	}
	go store.WatchFile(ctx, cfg.StatePath, time.Second)
	return serveHTTP(ctx, cfg.Web.Listen, srv)
}

func serveHTTP(ctx context.Context, listen string, h http.Handler) error {
	l, err := web.Listen(listen)
	if err != nil {
		return err
	}
	hs := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		hs.Shutdown(sctx)
	}()
	log.Printf("cockpit %s serving on %s", version, l.Addr())
	if err := hs.Serve(l); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func runDemo(args []string) error {
	fs := flag.NewFlagSet("demo", flag.ExitOnError)
	listen := fs.String("listen", "127.0.0.1:8080", "address to serve on")
	scenario := fs.String("scenario", demo.Attention, "calm, attention or incident")
	atFlag := fs.String("at", "", "freeze the clock at this RFC 3339 time (for screenshots)")
	every := fs.Duration("every", 2*time.Second, "how often the synthetic state changes")
	write := fs.String("write", "", "write one snapshot to this file and exit")
	fs.Parse(args)
	switch *scenario {
	case demo.Calm, demo.Attention, demo.Incident:
	default:
		return fmt.Errorf("unknown scenario %q", *scenario)
	}
	clock := time.Now
	if *atFlag != "" {
		t, err := time.Parse(time.RFC3339, *atFlag)
		if err != nil {
			return fmt.Errorf("-at: %w", err)
		}
		clock = func() time.Time { return t }
	}
	gen := &demo.Generator{Scenario: *scenario}
	if *write != "" {
		return snapshot.Write(*write, gen.Snapshot(clock()))
	}
	dir, err := os.MkdirTemp("", "cockpit-demo-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	if err := demo.WriteRunbooks(dir); err != nil {
		return err
	}
	store := web.NewStore()
	srv, err := web.New(store, web.Options{Title: gen.Snapshot(clock()).Title, Version: version, Demo: true, AuthMode: "none",
		RunbookDir: dir, UI: ui.FS(), Log: log.Default(), Now: clock})
	if err != nil {
		return err
	}
	ctx, cancel := signalContext()
	defer cancel()
	go func() {
		t := time.NewTicker(*every)
		defer t.Stop()
		for {
			b, _ := json.Marshal(gen.Snapshot(clock()))
			store.Set(b, time.Now())
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()
	log.Printf("demo (%s scenario): open http://%s", *scenario, strings.Replace(*listen, "0.0.0.0", "localhost", 1))
	return serveHTTP(ctx, *listen, srv)
}

func runHash(args []string) error {
	fs := flag.NewFlagSet("hash-password", flag.ExitOnError)
	fs.Parse(args)
	tty := isTerminal(os.Stdin)
	if tty {
		fmt.Fprint(os.Stderr, "Password (not shown): ")
		stty("-echo")
		defer stty("echo")
	}
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if tty {
		fmt.Fprintln(os.Stderr)
	}
	if err != nil && line == "" {
		return errors.New("no password on stdin")
	}
	h, err := web.HashPassword(strings.TrimRight(line, "\r\n"))
	if err != nil {
		return err
	}
	fmt.Println(h)
	return nil
}

func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func stty(arg string) {
	cmd := exec.Command("stty", arg)
	cmd.Stdin = os.Stdin
	_ = cmd.Run()
}
