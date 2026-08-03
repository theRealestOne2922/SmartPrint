#!/usr/bin/env bash
# Start, stop, restart and inspect SmartPrint's services.
#
# The same script runs on the backend VM and on the Raspberry Pi — they run
# different things, so it works out which machine it is on rather than making
# you remember. Nothing here is destructive.
#
#   ./services.sh status | start | stop | restart | logs | doctor
set -u

CMD="${1:-status}"
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; }
inf() { printf '    %s\n' "$1"; }

# --- which machine is this? --------------------------------------------------
# Decided by what is actually installed, not by hostname, which can be anything.
ROLE="unknown"; APP_DIR=""; PM2_NAME=""
for d in "$HOME/smartprintvit/student web app" "$HOME/SmartPrint/student web app" "/opt/smartprint/student web app"; do
  [ -f "$d/package.json" ] && { ROLE="backend"; APP_DIR="$d"; PM2_NAME="smartprint"; break; }
done
if [ "$ROLE" = "unknown" ]; then
  for d in "$HOME/Desktop/smartprintvit" "$HOME/smartprint-agent" "$HOME/smartprintvit/pi-print-agent" "$HOME/SmartPrint/pi-print-agent"; do
    [ -f "$d/index.js" ] && { ROLE="pi"; APP_DIR="$d"; break; }
  done
  # Trust PM2 over a directory guess: several stale copies of the agent often
  # exist, and only one of them is the one actually running.
  if command -v pm2 >/dev/null 2>&1; then
    RUNNING=$(pm2 jlist 2>/dev/null | tr ',' '\n' | grep -oE '"pm_exec_path":"[^"]+"' | head -1 | cut -d'"' -f4)
    [ -n "${RUNNING:-}" ] && [ -f "$RUNNING" ] && { APP_DIR="$(dirname "$RUNNING")"; ROLE="pi"; }
    PM2_NAME=$(pm2 jlist 2>/dev/null | tr ',' '\n' | grep -oE '"name":"[^"]*agent[^"]*"' | head -1 | cut -d'"' -f4)
    [ -z "${PM2_NAME:-}" ] && PM2_NAME="smartprint-agent"
  fi
fi

[ "$ROLE" = "unknown" ] && { bad "Cannot tell what this machine runs — no backend or agent found."; exit 1; }

status() {
  say "SmartPrint — $ROLE"
  inf "directory: ${APP_DIR:-unknown}"

  if command -v pm2 >/dev/null 2>&1; then
    say "process"
    if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
      pm2 list --no-color 2>/dev/null | grep -E "id|$PM2_NAME" | head -3
      RUN=$(pm2 jlist 2>/dev/null | tr ',' '\n' | grep -oE '"pm_exec_path":"[^"]+"' | head -1 | cut -d'"' -f4)
      [ -n "${RUN:-}" ] && inf "running: $RUN"
    else
      bad "PM2 process '$PM2_NAME' not found"
    fi
    systemctl is-enabled "pm2-$(whoami)" >/dev/null 2>&1 \
      && ok "survives reboot (pm2-$(whoami) enabled)" \
      || bad "will NOT survive reboot — run: pm2 startup && pm2 save"
    pm2 list --no-color 2>/dev/null | grep -q logrotate \
      && ok "log rotation installed" \
      || bad "no log rotation — logs grow forever: pm2 install pm2-logrotate"
  fi

  if [ "$ROLE" = "backend" ]; then
    say "web"
    systemctl is-active nginx >/dev/null 2>&1 && ok "nginx active" || bad "nginx not active"
    curl -sS -o /dev/null -w "    api localhost:5000 → %{http_code}\n" \
      --max-time 5 http://127.0.0.1:5000/api/settings 2>/dev/null || bad "api not answering"
  else
    say "printing"
    systemctl is-active cups >/dev/null 2>&1 && ok "cups active" || bad "cups not active"
    lpstat -p 2>/dev/null | sed 's/^/    /' | head -4
    QUEUED=$(lpstat -o 2>/dev/null | wc -l); inf "queued jobs: $QUEUED"
    say "touchscreen"
    if grep -qiE "^N: Name=.*(touch|ilitek|goodix|egalax|waveshare|silead|digitizer)" /proc/bus/input/devices 2>/dev/null; then
      ok "touch device present"
    else
      bad "no touch device — the panel's USB carries touch; check it reaches the Pi with a DATA cable"
    fi
    say "kiosk display"
    pgrep -f "chromium.*--kiosk" >/dev/null 2>&1 && ok "kiosk browser running" || bad "kiosk browser not running"
  fi

  say "disk"
  df -h / | tail -1 | awk '{print "    "$3" used, "$4" free ("$5")"}'
  for p in "$HOME/.pm2/logs" /var/log/journal "$HOME/.cache/chromium"; do
    [ -d "$p" ] && inf "$(du -sh "$p" 2>/dev/null)"
  done
}

case "$CMD" in
  status) status ;;
  start)   pm2 start "$PM2_NAME" 2>/dev/null || pm2 resurrect
           [ "$ROLE" = "backend" ] && sudo systemctl start nginx
           sleep 3; status ;;
  stop)    pm2 stop "$PM2_NAME"; say "stopped (nginx left running)" ;;
  restart) say "restarting $PM2_NAME"
           pm2 restart "$PM2_NAME" --update-env
           [ "$ROLE" = "backend" ] && sudo systemctl reload nginx 2>/dev/null
           sleep 5; status ;;
  logs)    pm2 logs "$PM2_NAME" --lines 40 --nostream ;;
  doctor)
    say "checks"
    [ -f "$APP_DIR/.env" ] && ok ".env present" || bad ".env missing at $APP_DIR"
    for k in MONGODB_URI MASTER_KEY APP_SECRET; do
      grep -qE "^$k=.+" "$APP_DIR/.env" 2>/dev/null && ok "$k set" || bad "$k missing"
    done
    if [ "$ROLE" = "pi" ]; then
      grep -qE "^PUBLIC_BASE_URL=.+" "$APP_DIR/.env" 2>/dev/null \
        && ok "PUBLIC_BASE_URL set" \
        || bad "PUBLIC_BASE_URL unset — the agent cannot confirm documents are ours"
      V=$(grep -m1 -oE "PI PRINT AGENT v[0-9.]+" "$APP_DIR/index.js" 2>/dev/null)
      inf "${V:-version unknown}"
      pm2 logs "$PM2_NAME" --lines 60 --nostream 2>/dev/null | grep -q "MASTER_KEY missing" \
        && bad "MASTER_KEY warning in log — confidential jobs will NOT print" \
        || ok "no MASTER_KEY warning"
    fi
    say "log growth"
    SZ=$(du -sm "$HOME/.pm2/logs" 2>/dev/null | cut -f1)
    if [ -n "${SZ:-}" ] && [ "$SZ" -gt 500 ] 2>/dev/null; then
      bad "PM2 logs are ${SZ}MB — this is what fills the card. Run: pm2 flush && pm2 install pm2-logrotate"
    else
      ok "PM2 logs ${SZ:-0}MB"
    fi
    ;;
  *) echo "usage: $0 [status|start|stop|restart|logs|doctor]"; exit 1 ;;
esac
