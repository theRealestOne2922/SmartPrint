#!/bin/bash
# Oracle VM side of the kiosk tunnel. Run as ubuntu (needs sudo).
#
#   ./oracle-443-setup.sh setup                      one-time: 443 multiplexer + tunnel user
#   ./oracle-443-setup.sh add-key <port> "<pubkey>"  allow one Pi (2201 = AB3/pi-a-vit, 2202 = AB1/pi-b-vit)
#   ./oracle-443-setup.sh status                     show what is connected
#   ./oracle-443-setup.sh rollback                   put nginx back exactly as it was
#
# Why this exists: since ~14 Sep 2026 VIT's campus networks (VITC-MOB, and the
# AB3 lab PC's shared connection) let only ports 80/443 out. The kiosk agents
# need MongoDB Atlas on 27017 and were cut off. This box already talks to Atlas,
# so each Pi opens an SSH tunnel to it — wrapped in TLS on port 443 so it looks
# like HTTPS — and reaches Atlas through that. The website keeps working exactly
# as before: nginx routes by TLS SNI before decrypting anything, and the real
# client IP is preserved with the PROXY protocol so rate limits still work.
set -euo pipefail

IP=140.245.224.137
CERT=/etc/letsencrypt/live/140.245.224.137.nip.io
SITE=/etc/nginx/sites-enabled/smartprint
STREAM=/etc/nginx/stream-tunnel.conf
SHARDS="ac-mpmwjmi-shard-00-00.fzbkawi.mongodb.net ac-mpmwjmi-shard-00-01.fzbkawi.mongodb.net ac-mpmwjmi-shard-00-02.fzbkawi.mongodb.net"

setup() {
  local STAMP; STAMP=$(date +%Y%m%d-%H%M%S)
  sudo mkdir -p /root/nginx-backup-$STAMP
  sudo cp /etc/nginx/nginx.conf $SITE /root/nginx-backup-$STAMP/
  echo "backup: /root/nginx-backup-$STAMP"
  sudo tee /root/nginx-rollback.sh >/dev/null <<EOF
#!/bin/bash
cp /root/nginx-backup-$STAMP/nginx.conf /etc/nginx/nginx.conf
cp /root/nginx-backup-$STAMP/smartprint $SITE
rm -f $STREAM
nginx -t && systemctl reload nginx && echo ROLLED-BACK
EOF
  sudo chmod +x /root/nginx-rollback.sh

  # Tunnel user: no shell, no commands — the keys added later are restricted
  # to port forwarding only.
  id pitunnel >/dev/null 2>&1 || sudo useradd -m -s /usr/sbin/nologin pitunnel
  sudo mkdir -p /home/pitunnel/.ssh
  sudo touch /home/pitunnel/.ssh/authorized_keys
  sudo chown -R pitunnel:pitunnel /home/pitunnel/.ssh
  sudo chmod 700 /home/pitunnel/.ssh
  sudo chmod 600 /home/pitunnel/.ssh/authorized_keys
  echo "user pitunnel ready"
  printf "# SmartPrint kiosk tunnels: drop a dead session fast so its reverse port frees up.
Match User pitunnel
    ClientAliveInterval 15
    ClientAliveCountMax 3
" | sudo tee /etc/ssh/sshd_config.d/10-pitunnel-keepalive.conf >/dev/null
  sudo sshd -t && sudo systemctl reload ssh
  # the stream module is built as a separate package on Ubuntu
  dpkg -s libnginx-mod-stream >/dev/null 2>&1 || sudo apt-get install -y -q libnginx-mod-stream

  sudo tee $STREAM >/dev/null <<EOF
# Port 443 multiplexer — see pi-print-agent/tunnel/oracle-443-setup.sh.
# Routed by TLS SNI before decryption. The website is untouched: it still
# terminates TLS in the http block, now on 127.0.0.1:4443.
stream {
    map \$ssl_preread_server_name \$smartprint_upstream {
        tunnel.${IP}.nip.io  127.0.0.1:8443;
        default              127.0.0.1:4443;
    }
    server {
        listen 443;
        ssl_preread on;
        proxy_pass \$smartprint_upstream;
        proxy_protocol on;
        # A kiosk whose wifi switched leaves a dead socket here; without this
        # nginx holds it 10 min and the reverse port stays taken. The live
        # tunnel sends keepalives every 15-30s, so 90s idle only means dead.
        proxy_timeout 90s;
    }
    # TLS terminated here; the plain SSH inside goes to sshd.
    server {
        listen 127.0.0.1:8443 ssl proxy_protocol;
        ssl_certificate     $CERT/fullchain.pem;
        ssl_certificate_key $CERT/privkey.pem;
        proxy_pass 127.0.0.1:22;
        proxy_timeout 90s;
    }
}
EOF
  grep -q "stream-tunnel.conf" /etc/nginx/nginx.conf || \
    sudo sed -i "s#^include /etc/nginx/modules-enabled/\*.conf;#&\ninclude $STREAM;#" /etc/nginx/nginx.conf

  # Move the https site behind the multiplexer, keeping real client IPs.
  if grep -q "listen 443 ssl;" $SITE; then
    sudo sed -i "s#^\(\s*\)listen 443 ssl; \# managed by Certbot#\1listen 127.0.0.1:4443 ssl proxy_protocol; \# behind $STREAM on :443 (was: listen 443 ssl)\n\1set_real_ip_from 127.0.0.1;\n\1real_ip_header proxy_protocol;#" $SITE
  fi
  echo "--- listen lines now ---"; grep -n "listen\|real_ip" $SITE

  sudo nginx -t
  sudo systemctl reload nginx
  sleep 2
  echo "--- verify: website still answers on 443 ---"
  curl -s -o /dev/null -w "site: HTTP %{http_code}\n" --max-time 10 https://${IP}.nip.io/
  echo "--- verify: SSH banner through the TLS tunnel path ---"
  (echo | timeout 8 openssl s_client -quiet -verify_quiet -connect ${IP}:443 -servername tunnel.${IP}.nip.io 2>/dev/null | head -c 40; echo) || true
  echo "SETUP DONE. If the site line above is not HTTP 200, run: sudo /root/nginx-rollback.sh"
}

add_key() {
  local PORT=$1 KEY=$2
  local OPEN=""
  for h in $SHARDS; do OPEN="$OPEN,permitopen=\"$h:27017\""; done
  # restrict = no pty/agent/X11/rc; port-forwarding re-enables only forwarding;
  # permitopen limits -L targets to the three Atlas shards; permitlisten limits
  # -R to this Pi's own reverse port on loopback.
  local LINE="restrict,port-forwarding${OPEN},permitlisten=\"127.0.0.1:${PORT}\",permitlisten=\"localhost:${PORT}\" ${KEY}"
  sudo grep -qF "$KEY" /home/pitunnel/.ssh/authorized_keys && { echo "key already present"; return; }
  echo "$LINE" | sudo tee -a /home/pitunnel/.ssh/authorized_keys >/dev/null
  echo "added key for reverse port $PORT"
}

status() {
  echo "--- nginx ---"; sudo nginx -t 2>&1 | tail -1
  echo "--- tunnel sessions ---"; sudo ss -tnp 2>/dev/null | grep -c "sshd.*pitunnel" || true
  echo "--- reverse ports listening (2201 = AB3, 2202 = AB1) ---"; sudo ss -ltn | grep -E "127.0.0.1:220[0-9]" || echo "none"
  echo "--- site ---"; curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 10 https://${IP}.nip.io/
}

case "${1:-}" in
  setup) setup ;;
  add-key) add_key "$2" "$3" ;;
  status) status ;;
  rollback) sudo /root/nginx-rollback.sh ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
