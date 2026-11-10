package collect

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// container is what Vesper needs from Docker's API.
type container struct {
	ID        string
	Name      string
	Image     string
	State     string // running, exited, restarting, paused, created, dead
	Health    string // healthy, unhealthy, starting, "" (no healthcheck)
	Streak    int
	ExitCode  int
	Restarts  int
	StartedAt time.Time
	EndedAt   time.Time
	Project   string
}

// dockerClient talks to the Docker Engine API over its unix socket, read-only:
// it only ever sends GET requests.
type dockerClient struct {
	http *http.Client
}

func newDocker(socket string) *dockerClient {
	tr := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", socket)
		},
		MaxIdleConns:    2,
		IdleConnTimeout: 30 * time.Second,
	}
	return &dockerClient{http: &http.Client{Transport: tr, Timeout: 10 * time.Second}}
}

func (d *dockerClient) get(ctx context.Context, path string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+path, nil)
	if err != nil {
		return err
	}
	res, err := d.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return fmt.Errorf("docker %s: %s %s", path, res.Status, strings.TrimSpace(string(b)))
	}
	return json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(v)
}

// list returns every container with the details of an inspect.
func (d *dockerClient) list(ctx context.Context) ([]container, error) {
	var summary []struct {
		ID     string            `json:"Id"`
		Names  []string          `json:"Names"`
		Image  string            `json:"Image"`
		Labels map[string]string `json:"Labels"`
	}
	if err := d.get(ctx, "/containers/json?all=1", &summary); err != nil {
		return nil, err
	}
	out := make([]container, 0, len(summary))
	for _, s := range summary {
		var in struct {
			RestartCount int `json:"RestartCount"`
			State        struct {
				Status     string `json:"Status"`
				ExitCode   int    `json:"ExitCode"`
				StartedAt  string `json:"StartedAt"`
				FinishedAt string `json:"FinishedAt"`
				Health     *struct {
					Status        string `json:"Status"`
					FailingStreak int    `json:"FailingStreak"`
				} `json:"Health"`
			} `json:"State"`
		}
		if err := d.get(ctx, "/containers/"+s.ID+"/json", &in); err != nil {
			return nil, err
		}
		c := container{
			ID: s.ID, Image: s.Image, State: in.State.Status, ExitCode: in.State.ExitCode,
			Restarts: in.RestartCount, Project: s.Labels["com.docker.compose.project"],
		}
		if len(s.Names) > 0 {
			c.Name = strings.TrimPrefix(s.Names[0], "/")
		}
		if in.State.Health != nil {
			c.Health, c.Streak = in.State.Health.Status, in.State.Health.FailingStreak
		}
		c.StartedAt, _ = time.Parse(time.RFC3339Nano, in.State.StartedAt)
		c.EndedAt, _ = time.Parse(time.RFC3339Nano, in.State.FinishedAt)
		out = append(out, c)
	}
	return out, nil
}

// containerState maps Docker's view to Vesper's up/degraded/down/off and a
// one-line detail. configured says the owner listed it in vesper.conf, so a
// stopped container is a problem rather than a finished one-off job.
func containerState(c container, configured bool, now time.Time) (state, detail string) {
	ago := func(t time.Time) string {
		if t.IsZero() || t.Year() < 2000 {
			return ""
		}
		return agoShort(now.Sub(t))
	}
	switch c.State {
	case "running":
		up := ago(c.StartedAt)
		switch c.Health {
		case "unhealthy":
			return "down", fmt.Sprintf("unhealthy · %d failed checks", c.Streak)
		case "starting":
			return "degraded", "health check starting · up " + up
		case "healthy":
			return "up", "healthy · up " + up
		}
		return "up", "running · up " + up
	case "restarting":
		return "down", fmt.Sprintf("restarting · exit %d", c.ExitCode)
	case "paused":
		return "degraded", "paused"
	case "exited", "dead", "created":
		when := ago(c.EndedAt)
		if !configured && c.ExitCode == 0 && c.State == "exited" {
			return "off", "exited 0 · " + when + " ago"
		}
		if when != "" {
			return "down", fmt.Sprintf("%s (%d) · %s ago", c.State, c.ExitCode, when)
		}
		return "down", c.State
	}
	return "unknown", c.State
}

func agoShort(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}
