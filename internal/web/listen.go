package web

import (
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"strconv"
	"strings"
)

// Listen opens the configured listener:
//
//	systemd               a socket passed by systemd socket activation (fd 3)
//	unix:/path/web.sock   a unix socket (an old socket file is replaced)
//	host:port             TCP
func Listen(spec string) (net.Listener, error) {
	if spec == "systemd" {
		return systemdListener()
	}
	if p, ok := strings.CutPrefix(spec, "unix:"); ok {
		if info, err := os.Lstat(p); err == nil {
			if info.Mode()&fs.ModeSocket == 0 {
				return nil, fmt.Errorf("%s exists and is not a socket", p)
			}
			os.Remove(p)
		}
		l, err := net.Listen("unix", p)
		if err != nil {
			return nil, err
		}
		if err := os.Chmod(p, 0o660); err != nil {
			l.Close()
			return nil, err
		}
		return l, nil
	}
	return net.Listen("tcp", spec)
}

// systemdListener takes the first socket from LISTEN_FDS (sd_listen_fds(3)).
func systemdListener() (net.Listener, error) {
	pid, err := strconv.Atoi(os.Getenv("LISTEN_PID"))
	if err != nil || pid != os.Getpid() {
		return nil, errors.New("listen = systemd, but no socket was passed (start it through cockpit-web.socket)")
	}
	n, err := strconv.Atoi(os.Getenv("LISTEN_FDS"))
	if err != nil || n < 1 {
		return nil, errors.New("LISTEN_FDS is not a positive number")
	}
	os.Unsetenv("LISTEN_PID")
	os.Unsetenv("LISTEN_FDS")
	os.Unsetenv("LISTEN_FDNAMES")
	f := os.NewFile(3, "systemd-socket")
	defer f.Close()
	return net.FileListener(f)
}
