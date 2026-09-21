#!/bin/bash
# Pi side of the kiosk tunnel. Run as the kiosk user (student). Two phases:
#
#   ./pi-tunnel-setup.sh key       make this Pi's tunnel key and print the
#                                  add-key command to run on the Oracle VM
#   ./pi-tunnel-setup.sh install   after the VM has the key: hosts entries,
#                                  systemd tunnel service, new MONGODB_URI,
#                                  agent restart, verification
#   ./pi-tunnel-setup.sh status    is the tunnel up, is the agent connected
#   ./pi-tunnel-setup.sh rollback  restore the SRV connection string, stop tunnel
#
# What it does, and why each piece is needed:
#  - /etc/hosts maps the three Atlas shard hostnames to 127.0.0.2/3/4. The Mongo
#    driver discovers replica-set members by those hostnames, so every one of
#    them has to land on a tunnel — not just the first.
#  - A systemd service keeps `ssh -N` to the Oracle VM, wrapped in TLS on 443
#    by openssl so campus firewalls see HTTPS. It forwards the three shard
#    ports out, and one reverse port in so the Pi can be reached remotely
#    without Tailscale or a hotspot.
#  - MONGODB_URI is rewritten from mongodb+srv:// (needs SRV DNS + 27017
#    directly) to mongodb:// naming the three shards (only needs /etc/hosts).
#    TLS is end-to-end with Atlas through the tunnel: the certificate is still
#    checked against the real shard hostname.
set -euo pipefail

VM=140.245.224.137
SNI=tunnel.${VM}.nip.io
S0=ac-mpmwjmi-shard-00-00.fzbkawi.mongodb.net
S1=ac-mpmwjmi-shard-00-01.fzbkawi.mongodb.net
S2=ac-mpmwjmi-shard-00-02.fzbkawi.mongodb.net
RS=atlas-50cf9h-shard-0
KEY=$HOME/.ssh/smartprint-tunnel
SVC=/etc/systemd/system/smartprint-tunnel.service

agent_dir() { pm2 jlist | python3 -c 'import json,sys,os; print(os.path.dirname([p["pm2_env"]["pm_exec_path"] for p in json.load(sys.stdin) if "agent" in p["name"]][0]))'; }
agent_name() { pm2 jlist | python3 -c 'import json,sys; print([p["name"] for p in json.load(sys.stdin) if "agent" in p["name"]][0])'; }
reverse_port() {
  case "$(grep -o 'KIOSK_ID=.*' "$(agent_dir)/.env" | cut -d= -f2 | tr -d '[:space:]')" in
    pi-a-vit) echo 2201 ;; pi-b-vit) echo 2202 ;; *) echo "unknown KIOSK_ID" >&2; exit 1 ;;
  esac
}

phase_key() {
  mkdir -p ~/.ssh; chmod 700 ~/.ssh
  [ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "smartprint-tunnel-$(hostname)-$(reverse_port)" -f "$KEY" >/dev/null
  echo "Run this on the Oracle VM (as ubuntu), then come back and run: $0 install"
  echo
  echo "./oracle-443-setup.sh add-key $(reverse_port) \"$(cat $KEY.pub)\""
}

phase_install() {
  local DIR NAME PORT; DIR=$(agent_dir); NAME=$(agent_name); PORT=$(reverse_port)
  echo "agent: $NAME in $DIR   reverse port: $PORT"
  [ -f "$KEY" ] || { echo "no key yet — run: $0 key"; exit 1; }

  # 1. shard hostnames -> loopback tunnel endpoints
  if ! grep -q "$S0" /etc/hosts; then
    printf '\n# SmartPrint: Atlas shards via the 443 tunnel (pi-tunnel-setup.sh)\n127.0.0.2 %s\n127.0.0.3 %s\n127.0.0.4 %s\n' "$S0" "$S1" "$S2" | sudo tee -a /etc/hosts >/dev/null
  fi
  echo "hosts: ok"

  # 2. the tunnel service
  sudo tee $SVC >/dev/null <<EOF
[Unit]
Description=SmartPrint tunnel to Oracle VM over 443 (MongoDB out, SSH in)
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
# openssl wraps the SSH stream in TLS with an SNI the VM's nginx routes to sshd.
# ExitOnForwardFailure + ServerAlive make a dead link exit, and systemd restarts it.
ExecStart=/usr/bin/ssh -N \\
  -o "ProxyCommand=openssl s_client -quiet -verify_quiet -connect $VM:443 -servername $SNI" \\
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \\
  -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new \\
  -o UserKnownHostsFile=$HOME/.ssh/known_hosts \\
  -i $KEY \\
  -L 127.0.0.2:27017:$S0:27017 \\
  -L 127.0.0.3:27017:$S1:27017 \\
  -L 127.0.0.4:27017:$S2:27017 \\
  -R 127.0.0.1:$PORT:127.0.0.1:22 \\
  pitunnel@$VM
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  # The reverse port needs an SSH server on this Pi. Loopback only, keys only:
  # it is reachable solely through the tunnel, never over wifi.
  sudo mkdir -p /etc/ssh/sshd_config.d
  printf "# SmartPrint: only reachable through the 443 reverse tunnel, never over wifi.
ListenAddress 127.0.0.1
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
" | sudo tee /etc/ssh/sshd_config.d/10-smartprint-loopback.conf >/dev/null
  sudo systemctl enable --now ssh >/dev/null 2>&1; sudo systemctl restart ssh
  sudo systemctl daemon-reload
  sudo systemctl enable --now smartprint-tunnel.service
  echo "waiting for the tunnel..."
  for i in $(seq 1 20); do
    if timeout 3 bash -c "</dev/tcp/127.0.0.2/27017" 2>/dev/null; then echo "tunnel: UP after ${i}s"; break; fi
    sleep 1
    [ $i -eq 20 ] && { echo "tunnel did not come up:"; systemctl status smartprint-tunnel --no-pager | tail -8; exit 1; }
  done

  # 3. Atlas reachable through it, with the certificate checked against the real hostname
  echo | timeout 12 openssl s_client -connect 127.0.0.2:27017 -servername $S0 -verify_hostname $S0 -verify_return_error 2>/dev/null >/dev/null \
    && echo "tls to atlas via tunnel: OK (hostname verified)" || { echo "TLS through tunnel FAILED"; exit 1; }

  # 4. rewrite MONGODB_URI (srv -> direct shards). Secrets never printed.
  local ENV="$DIR/.env" STAMP; STAMP=$(date +%Y%m%d-%H%M%S)
  cp "$ENV" "$ENV.bak-tunnel-$STAMP"; echo "env backup: $ENV.bak-tunnel-$STAMP"
  node - "$ENV" "$S0" "$S1" "$S2" "$RS" <<'EOF'
const fs = require('fs'); const [env, s0, s1, s2, rs] = process.argv.slice(2);
let txt = fs.readFileSync(env, 'utf8');
const m = txt.match(/^MONGODB_URI=(.*)$/m); if (!m) { console.error('no MONGODB_URI'); process.exit(1); }
let raw = m[1].trim().replace(/^"|"$/g, '');
if (raw.startsWith('mongodb://')) { console.log('uri: already direct, unchanged'); process.exit(0); }
const u = new URL(raw);
if (!u.protocol.startsWith('mongodb+srv')) { console.error('unexpected scheme'); process.exit(1); }
const p = new URLSearchParams(u.search);
p.set('tls', 'true'); p.set('replicaSet', rs); if (!p.has('authSource')) p.set('authSource', 'admin');
const auth = u.username ? `${u.username}${u.password ? ':' + u.password : ''}@` : '';
const next = `mongodb://${auth}${s0}:27017,${s1}:27017,${s2}:27017${u.pathname || '/'}?${p.toString()}`;
txt = txt.replace(/^MONGODB_URI=.*$/m, `MONGODB_URI=${next}`);
fs.writeFileSync(env, txt);
console.log('uri: rewritten to direct shards (db=' + (u.pathname || '/') + ', opts=' + p.toString().replace(/\S*password\S*/g, '') + ')');
EOF

  # 5. restart the agent and prove it connected through the tunnel
  pm2 restart "$NAME" >/dev/null; sleep 12
  pm2 logs "$NAME" --lines 15 --nostream 2>&1 | grep -a -o "MongoDB connected\|Agent ready\|connection failed.*" | tail -3
  status
}

status() {
  echo "tunnel service: $(systemctl is-active smartprint-tunnel 2>/dev/null)"
  for ip in 127.0.0.2 127.0.0.3 127.0.0.4; do printf "  %s:27017 " $ip; timeout 3 bash -c "</dev/tcp/$ip/27017" 2>/dev/null && echo open || echo CLOSED; done
  echo "agent: $(pm2 jlist | python3 -c 'import json,sys; print([p["pm2_env"]["status"] for p in json.load(sys.stdin) if "agent" in p["name"]][0])')"
  echo "last agent error: $(tail -n 1 ~/.pm2/logs/*agent*-error.log 2>/dev/null | cut -c1-100)"
}

rollback() {
  local DIR; DIR=$(agent_dir)
  local B; B=$(ls -t "$DIR"/.env.bak-tunnel-* 2>/dev/null | head -1)
  [ -n "$B" ] && cp "$B" "$DIR/.env" && echo "restored $B"
  sudo systemctl disable --now smartprint-tunnel 2>/dev/null || true
  sudo sed -i '/SmartPrint: Atlas shards via the 443 tunnel/,+3d' /etc/hosts
  pm2 restart "$(agent_name)" >/dev/null; echo "agent restarted on the original SRV string"
}

case "${1:-}" in
  key) phase_key ;;
  install) phase_install ;;
  status) status ;;
  rollback) rollback ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
