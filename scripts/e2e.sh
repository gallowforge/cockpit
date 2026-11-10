#!/usr/bin/env bash
# e2e.sh BINARY - run Cockpit end to end on a real systemd host, the way it runs
# in production: the shipped units with all their sandboxing, a synthetic
# homelab on disk, real journal entries from transient units, real Docker
# containers, and Caddy in front on the unix socket.
#
# Needs root, systemd as PID 1, Docker and curl + jq. Installs nothing
# persistent: units go to /run/systemd/system (gone at reboot) and everything
# is removed on exit. CI runs it on every push.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo $0 $*)" >&2; exit 2; }
BIN=$(realpath "${1:?usage: e2e.sh path/to/cockpit}")
HERE=$(cd "$(dirname "$0")/.." && pwd)
W=/opt/cockpit-e2e              # PrivateTmp hides /tmp and /var/tmp from the units
U=/run/systemd/system
PW='e2e correct horse battery staple'
pass=0 fail=0
ok()  { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }

cleanup() {
  systemctl stop cockpit-web.service cockpit-web.socket cockpit-collect.service 2>/dev/null || true
  rm -f "$U"/cockpit-web.service "$U"/cockpit-web.socket "$U"/cockpit-collect.service
  systemctl daemon-reload
  docker rm -f cockpit-e2e-caddy cockpit-e2e-crashy >/dev/null 2>&1 || true
  rm -rf "$W" /run/cockpit
}
trap cleanup EXIT
cleanup

# ---- a synthetic homelab -----------------------------------------------------
mkdir -p "$W"/{bin,etc/homelab,var/lib/homelab/backup-status,var/lib/homelab/notify,backups/{vaultwarden,kuma,homeassistant},repo/_host/etc}
install -m 755 "$BIN" "$W/bin/cockpit"
now=$(date +%s)
cat > "$W/etc/homelab/backups.conf" <<EOF
[defaults]
base = $W/backups
[vaultwarden]
type = sqlite
keep = 14
[kuma]
type = sqlite
keep = 7
[homeassistant]
type = ha-link
keep = 7
max_age_h = 50
EOF
for s in vaultwarden kuma; do
  printf 'epoch=%s\ntime=x\nfile=%s\nbytes=%s\nmembers=2\nrows_monitor=13\n' "$((now - 3 * 3600))" "$W/backups/$s/x" 224853 > "$W/var/lib/homelab/backup-status/$s"
  for d in 3 2 1; do f="$W/backups/$s/${s}_day$d.tar.gz"; head -c $((1000 + d)) /dev/zero > "$f"; touch -d "@$((now - d * 86400))" "$f"; done
done
printf 'epoch=%s\nbytes=96300000\n' "$((now - 60 * 3600))" > "$W/var/lib/homelab/backup-status/homeassistant"
printf 'opened=%s\nlast_ok=%s\nlast_try=%s\n' "$((now - 600))" "$((now - 600))" "$((now - 600))" > "$W/var/lib/homelab/notify/health-storage"
chmod 700 "$W/var/lib/homelab/backup-status"
# drift: one file identical to live, one changed
cp /etc/hostname "$W/repo/_host/etc/hostname"
{ cat /etc/hosts; echo "# a line only the repo has"; } > "$W/repo/_host/etc/hosts"
printf 'etc/hostname 0644 root root -\netc/hosts 0644 root root -\n' > "$W/repo/_host/MANIFEST"
printf '# Restore a backup\n\n## Steps\n\n1. Pause the watchdogs.\n' > "$W/repo/RESTORE.md"
git -C "$W/repo" init -q && git -C "$W/repo" add -A && git -C "$W/repo" -c user.name=e2e -c user.email=e2e@example.com commit -qm init
echo "scratch" > "$W/repo/uncommitted.txt"
"$W/bin/cockpit" hash-password <<<"$PW" > "$W/password.hash"
chmod 600 "$W/password.hash"

cat > "$W/cockpit.conf" <<EOF
[cockpit]
title = e2e
interval = 3s
slow_interval = 3s
[web]
listen = systemd
username = e2e-owner
password_hash_file = $W/password.hash
[host]
mounts = /
[homelab]
repo = $W/repo
backup_conf = $W/etc/homelab/backups.conf
backup_status = $W/var/lib/homelab/backup-status
notify_state = $W/var/lib/homelab/notify
maintenance_flag = $W/maintenance
backup_unit = cockpit-e2e-backup.service
drill_unit = cockpit-e2e-drill.service
health_unit = cockpit-e2e-health.service
heartbeat_unit = cockpit-e2e-heartbeat.service
notify_tag = cockpit-e2e-notify
health_categories = backups storage dns
[timers]
highlight = systemd-tmpfiles-clean.timer
[service:caddy]
title = Caddy
container = cockpit-e2e-caddy
probe = http://127.0.0.1:18080/
[service:crashy]
container = cockpit-e2e-crashy
[service:journald]
unit = systemd-journald.service
[service:dns]
probe = dns://127.0.0.53:53/localhost
[service:outside]
probe = tcp://1.1.1.1:443
[runbook:restore]
title = Restore a backup
file = $W/repo/RESTORE.md
match = backups backup-*
EOF

# ---- real journal entries from transient units ------------------------------
run() { systemd-run --quiet --collect --wait --unit="$1" /bin/sh -c "$2" || true; }
run cockpit-e2e-backup 'echo "[vaultwarden] written, verified"; echo "2 of 2 sets written, verified and pruned"'
run cockpit-e2e-backup 'echo "[homeassistant] no new backup - nothing pruned"; exit 1'
run cockpit-e2e-drill 'echo "PASS vaultwarden: integrity_check ok, ciphers=412 (live now 412)"; echo "PASS kuma: integrity_check ok, monitor=13"; echo "restore test: 2 passed, 0 failed"'
run cockpit-e2e-health 'echo "1 problem(s) found"'
for _ in 1 2 3; do run cockpit-e2e-heartbeat 'true'; done
logger -t cockpit-e2e-notify 'sent prio=high key=kuma-down title="Uptime Kuma: Home Assistant is DOWN" http=200 attempts=1'
logger -t cockpit-e2e-notify 'resolved key=kuma-down prio=default title="Uptime Kuma: Home Assistant is UP" http=200 attempts=1'
logger -t cockpit-e2e-notify 'sent prio=default key=health-storage title="Homelab: storage needs attention" http=200 attempts=1'
journalctl --sync 2>/dev/null || true

# ---- real containers, Caddy in front -----------------------------------------
mkdir -p /run/cockpit
cat > "$W/Caddyfile" <<'EOF'
{
	admin 127.0.0.1:2019
}
https://localhost:8447 {
	tls internal
	reverse_proxy unix//run/cockpit/web.sock
}
:8080 {
	respond "ok"
}
EOF
docker run -d --name cockpit-e2e-caddy -p 127.0.0.1:18447:8447 -p 127.0.0.1:18080:8080 \
  -v "$W/Caddyfile:/etc/caddy/Caddyfile:ro" -v /run/cockpit:/run/cockpit:ro \
  --health-cmd 'wget -qO /dev/null http://127.0.0.1:2019/config/' --health-interval 2s caddy:2 >/dev/null
docker run --name cockpit-e2e-crashy busybox:stable sh -c 'exit 3' >/dev/null 2>&1 || true

# ---- the shipped units, pointed at the fixture --------------------------------
for f in cockpit-collect.service cockpit-web.socket cockpit-web.service; do
  sed -e "s|/usr/local/bin/cockpit|$W/bin/cockpit|" -e "s|/etc/cockpit/cockpit.conf|$W/cockpit.conf|" \
      -e "s|/etc/cockpit/password.hash|$W/password.hash|" "$HERE/deploy/systemd/$f" > "$U/$f"
done
systemd-tmpfiles --create "$HERE/deploy/tmpfiles.d/cockpit.conf"
systemctl daemon-reload
systemctl start cockpit-collect.service cockpit-web.socket
for _ in $(seq 1 40); do
  docker inspect -f '{{.State.Health.Status}}' cockpit-e2e-caddy 2>/dev/null | grep -q healthy && [ -s /run/cockpit/state.json ] && break
  sleep 0.5
done
S=/run/cockpit/state.json
# wait until the collector has done at least two ticks with Caddy healthy
for _ in $(seq 1 60); do
  jq -e '.host.cpu_pct != null and ([.services[] | select(.id == "caddy") | .probe.ok] == [true])' "$S" >/dev/null 2>&1 && break
  sleep 0.5
done
j() { jq -e "$1" "$S"; }

echo "== collector"
check "collector is running"                    "systemctl is-active --quiet cockpit-collect.service"
check "state.json written, schema 2"            "j '.schema == 2 and .title == \"e2e\"'"
check "collector holds only CAP_DAC_READ_SEARCH"  "[ \"\$(awk '/^CapEff/{print \$2}' /proc/\$(systemctl show -p MainPID --value cockpit-collect)/status)\" = 0000000000000004 ]"
check "host CPU and memory measured"            "j '.host.cpu_pct >= 0 and .host.mem_total > 0'"
check "every source read without error"         "j '[.sources[] | select(.ok | not) | .name] == []'"
echo "== services"
check "healthy container is up, probe ok"       "j '.services[] | select(.id == \"caddy\") | .state == \"up\" and .probe.ok'"
check "exited container is down"                "j '.services[] | select(.id == \"crashy\") | .state == \"down\"'"
check "systemd unit is up"                      "j '.services[] | select(.id == \"journald\") | .state == \"up\"'"
check "day line written for every service"       "j '[.services[] | (.day | length) >= 1 and (.day[-1:] | test(\"[udxo?]\"))] | all'"
check "dns probe answers"                       "j '.services[] | select(.id == \"dns\") | .state == \"up\"'"
check "sandbox blocks probes leaving the host"  "j '.services[] | select(.id == \"outside\") | .state == \"down\"'"
echo "== backups and drill"
check "fresh set is ok, archives listed"        "j '.backups.sets[] | select(.name == \"vaultwarden\") | .level == \"ok\" and (.archives | length) == 3'"
check "set past max_age_h is crit"              "j '.backups.sets[] | select(.name == \"homeassistant\") | .level == \"crit\"'"
check "failed run read from the journal"        "j '.backups.runs[0].result == \"failed\" and (.backups.runs[0].summary | test(\"nothing pruned\"))'"
check "successful run read from the journal"    "j '.backups.runs[1].result == \"success\"'"
check "restore drill parsed"                    "j '.drill.runs[0].passed == 2 and .drill.runs[0].failed == 0'"
echo "== alerts, drift, heartbeat, health"
check "open incident from the state file"       "j '.alerts.incidents[] | select(.key == \"health-storage\") | .state == \"open\"'"
check "resolved incident from the journal"      "j '.alerts.incidents[] | select(.key == \"kuma-down\") | .state == \"resolved\" and .prio == \"high\"'"
check "drift found in /etc/hosts only"          "j '.drift.result == \"drift\" and ([.drift.files[].path] == [\"/etc/hosts\"])'"
check "uncommitted change counted"              "j '.drift.uncommitted == 1'"
check "heartbeat runs counted"                  "j '.heartbeat.ok and .heartbeat.pings_24h >= 3'"
check "health check result and open category"   "j '.health.result == \"1 problem(s) found\" and ([.health.categories[] | select(.open) | .name] == [\"storage\"])'"
check "runbook copied for the web process"      "grep -q 'Restore a backup' /run/cockpit/runbooks/restore.md"
check "rollup is crit with attention items"     "j '.status.level == \"crit\" and (.status.attention | length) >= 4'"
"$W/bin/cockpit" check -state "$S" -color never || true

echo "== web on the unix socket"
sock() { curl -s --unix-socket /run/cockpit/web.sock "$@"; }
check "socket activation starts the web unit"   "sock http://x/healthz | grep -q '^ok'"
check "web runs as a dynamic user, not root"    "[ \"\$(ps -o user= -p \$(systemctl show -p MainPID --value cockpit-web))\" != root ]"
check "web has no network of its own"           "[ \"\$(systemctl show -p PrivateNetwork --value cockpit-web)\" = yes ]"
check "state refused without a session"         "[ \"\$(sock -o /dev/null -w '%{http_code}' http://x/api/state)\" = 401 ]"
bad_pw=$(sock -w ' %{http_code}' -H 'Content-Type: application/json' -d '{"username":"e2e-owner","password":"nope nope nope"}' http://x/api/login)
bad_user=$(sock -w ' %{http_code}' -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$PW\"}" http://x/api/login)
alike=no; [ "$bad_pw" = "$bad_user" ] && [ "${bad_pw##* }" = 401 ] && alike=yes
check "wrong username or password refused alike" "[ $alike = yes ]"
echo "== through Caddy (TLS, X-Forwarded-*, streaming)"
C=$(mktemp)
code=$(curl -sk -c "$C" -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "{\"username\":\"e2e-owner\",\"password\":\"$PW\"}" https://localhost:18447/api/login --resolve localhost:18447:127.0.0.1)
check "login through Caddy"                     "[ $code = 204 ]"
check "session cookie is Secure and HttpOnly"   "grep -q '#HttpOnly_localhost.*TRUE.*cockpit_session' $C"
check "state through Caddy with the cookie"     "curl -sk -b $C --resolve localhost:18447:127.0.0.1 https://localhost:18447/api/state | jq -e '.title == \"e2e\"'"
ev=$(timeout 6 curl -skN -b "$C" --resolve localhost:18447:127.0.0.1 https://localhost:18447/api/events 2>/dev/null | head -c 200000 | grep -m2 -E '^(event|data):' || true)
if grep -q '^event: snapshot' <<<"$ev" && grep -q '"schema":2' <<<"$ev"; then ok "live stream delivers a snapshot event"; else bad "live stream delivers a snapshot event"; fi
check "UI served through Caddy"                 "curl -sk --resolve localhost:18447:127.0.0.1 https://localhost:18447/ | grep -q '<title>Cockpit</title>'"
rm -f "$C"

echo "== hardening (systemd-analyze security, lower is safer)"
for u in cockpit-collect.service cockpit-web.service; do
  printf '%-26s %s\n' "$u" "$(systemd-analyze security "$u" 2>/dev/null | tail -1 | sed 's/.*exposure level for [^:]*: //')"
done

echo "RESULT: $pass passed, $fail failed"
[ "$fail" = 0 ]
