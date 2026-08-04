#!/bin/bash
# SmartPrint Pi — lock WiFi to one network + gate kiosk launch on real connectivity
#
# Problem this fixes:
#  1. The Pi has saved WiFi credentials for other networks (from earlier testing),
#     one of which has since had its access revoked. On boot it can try those
#     first, or fall back to them, instead of the one network it should ever
#     use on this deployment.
#  2. The kiosk launcher used a fixed `sleep 3` before starting Chromium. That
#     is a guess, not a check — too short and Chromium opens before WiFi has
#     actually finished associating and getting an IP (shows an offline page,
#     nobody at a kiosk knows to refresh it), too long and it wastes boot time
#     on a network that was actually ready sooner.
#
# What this does:
#  - Detects whether the Pi is on NetworkManager (Bookworm/Trixie, the
#    default on any Pi imaged in the last ~2 years) or wpa_supplicant/dhcpcd
#    (older Buster/Bullseye), and configures whichever is actually present.
#  - Deletes every other saved WiFi network and (re)creates just the one
#    target network, set to autoconnect.
#  - Writes a kiosk launcher that blocks in a real connectivity-check loop
#    (an actual request to the site, not just "wifi says associated") before
#    starting Chromium, and wires it into every autostart mechanism this
#    project's installers already use (XDG/Wayfire/Labwc/LXDE-pi) — so it
#    fires correctly regardless of which desktop environment this specific
#    Pi image is running, and replaces any old direct Chromium launch line
#    so it doesn't start twice.
#
# Safe to re-run. Run as: sudo bash setup-wifi-and-kiosk-startup.sh
#
# Before running: if you are not certain this is the SmartPrint VIT Pi and
# not the other college's deployment, verify first — see SECURITY.md,
# "Working on the right Pi" (node whichdeployment.mjs --expect <hash>).
# This script only touches WiFi and the kiosk launcher, not print data, but
# confirm anyway before changing anything on shared hardware.

set -euo pipefail

TARGET_SSID="AB3SCOPE172 0783"
KIOSK_URL="https://smartprintvit.web.app/kiosk-app"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo bash $0" >&2
  exit 1
fi

REAL_USER="${SUDO_USER:-pi}"
USER_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
if [ -z "$USER_HOME" ] || [ ! -d "$USER_HOME" ]; then
  echo "Could not resolve a home directory for user '$REAL_USER'. Edit REAL_USER above and re-run." >&2
  exit 1
fi
WRAPPER_SCRIPT="$USER_HOME/kiosk.sh"

echo "== SmartPrint Kiosk: WiFi lockdown + startup fix =="
echo "Target network : $TARGET_SSID"
echo "Kiosk user     : $REAL_USER ($USER_HOME)"
echo

# ---------------------------------------------------------------------------
# 1. WiFi: keep only the target network, set it to autoconnect
# ---------------------------------------------------------------------------
NETWORK_BACKEND="unknown"

if command -v nmcli >/dev/null 2>&1 && systemctl is-active --quiet NetworkManager; then
  NETWORK_BACKEND="NetworkManager"
  echo "[wifi] NetworkManager detected."

  WIFI_IFACE=$(nmcli -t -f DEVICE,TYPE device status | awk -F: '$2=="wifi"{print $1; exit}')
  if [ -z "$WIFI_IFACE" ]; then
    echo "[wifi] No WiFi interface found via nmcli. Aborting WiFi setup." >&2
    exit 1
  fi
  echo "[wifi] Interface: $WIFI_IFACE"

  read -r -s -p "[wifi] Enter the password for \"$TARGET_SSID\": " WIFI_PASSWORD
  echo
  if [ -z "$WIFI_PASSWORD" ]; then
    echo "[wifi] Empty password entered, aborting." >&2
    exit 1
  fi

  echo "[wifi] Removing every other saved WiFi profile..."
  while IFS=: read -r name type; do
    if [ "$type" = "802-11-wireless" ] && [ "$name" != "$TARGET_SSID" ]; then
      echo "  - removing: $name"
      nmcli connection delete "$name" >/dev/null 2>&1 || true
    fi
  done < <(nmcli -t -f NAME,TYPE connection show)

  # Drop and recreate the target profile too, so a stale saved profile (e.g.
  # from before a password change on that network) can't block reconnection.
  nmcli connection delete "$TARGET_SSID" >/dev/null 2>&1 || true

  echo "[wifi] Adding \"$TARGET_SSID\"..."
  nmcli connection add type wifi con-name "$TARGET_SSID" ifname "$WIFI_IFACE" ssid "$TARGET_SSID" \
    802-11-wireless-security.key-mgmt wpa-psk \
    802-11-wireless-security.psk "$WIFI_PASSWORD" \
    connection.autoconnect yes \
    connection.autoconnect-priority 100 >/dev/null
  unset WIFI_PASSWORD

  echo "[wifi] Connecting..."
  if nmcli connection up "$TARGET_SSID" >/dev/null; then
    echo "[wifi] Connected."
  else
    echo "[wifi] Could not connect right now — double check the password and that the network is in range. The profile is saved and will keep retrying on its own." >&2
  fi

elif [ -f /etc/wpa_supplicant/wpa_supplicant.conf ]; then
  NETWORK_BACKEND="wpa_supplicant"
  echo "[wifi] wpa_supplicant detected (no NetworkManager on this image)."

  read -r -s -p "[wifi] Enter the password for \"$TARGET_SSID\": " WIFI_PASSWORD
  echo
  if [ -z "$WIFI_PASSWORD" ]; then
    echo "[wifi] Empty password entered, aborting." >&2
    exit 1
  fi

  WPA_CONF=/etc/wpa_supplicant/wpa_supplicant.conf
  BACKUP="$WPA_CONF.bak.$(date +%s)"
  cp "$WPA_CONF" "$BACKUP"
  echo "[wifi] Backed up existing config to $BACKUP"

  {
    echo "country=IN"
    echo "ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev"
    echo "update_config=1"
    echo
    # wpa_passphrase emits the psk as a hash, not the plaintext password, and
    # strips the commented plaintext line — nothing readable is left on disk.
    wpa_passphrase "$TARGET_SSID" "$WIFI_PASSWORD" | grep -v '^\s*#'
  } > "$WPA_CONF"
  unset WIFI_PASSWORD
  chmod 600 "$WPA_CONF"

  echo "[wifi] Restarting networking..."
  systemctl restart wpa_supplicant 2>/dev/null || true
  systemctl restart dhcpcd 2>/dev/null || true
  echo "[wifi] Done — this is now the only saved network."

else
  echo "[wifi] Neither NetworkManager nor wpa_supplicant found. Skipping WiFi setup — configure it manually, then re-run this script to fix the kiosk startup ordering." >&2
fi

echo

# ---------------------------------------------------------------------------
# 2. Kiosk launcher: block on real connectivity, then start Chromium
# ---------------------------------------------------------------------------
echo "[kiosk] Writing $WRAPPER_SCRIPT..."
cat > "$WRAPPER_SCRIPT" << EOF
#!/bin/bash
# SmartPrint kiosk launcher. Waits for genuine connectivity (a real request
# to the site, not just "wifi associated" — that can be true before DHCP/DNS
# actually work) before starting Chromium, instead of a blind sleep.
export DISPLAY=:0
export XAUTHORITY="\$HOME/.Xauthority"

xset s noblank 2>/dev/null
xset s off 2>/dev/null
xset -dpms 2>/dev/null
command -v unclutter >/dev/null 2>&1 && unclutter -idle 0.5 -root &

LOG="\$HOME/kiosk-startup.log"
: > "\$LOG"
echo "[\$(date)] kiosk.sh starting, waiting for network..." >> "\$LOG"

until curl -fsS --max-time 3 -o /dev/null "$KIOSK_URL"; do
  echo "[\$(date)] no connectivity yet, retrying in 2s..." >> "\$LOG"
  sleep 2
done
echo "[\$(date)] network is up, launching Chromium." >> "\$LOG"

# Clear the "did Chromium exit cleanly" flags so a kiosk nobody is there to
# click through doesn't sit on the restore-pages prompt after a power cut.
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "\$HOME/.config/chromium/Default/Preferences" 2>/dev/null
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "\$HOME/.config/chromium/Default/Preferences" 2>/dev/null

if command -v chromium-browser >/dev/null 2>&1; then
  BROWSER_CMD="chromium-browser"
elif command -v chromium >/dev/null 2>&1; then
  BROWSER_CMD="chromium"
else
  BROWSER_CMD="chromium-browser"
fi

exec "\$BROWSER_CMD" --kiosk --noerrdialogs --disable-infobars \\
  --disable-session-crashed-bubble --disable-features=Translate \\
  --check-for-update-interval=31536000 --password-store=basic \\
  "$KIOSK_URL"
EOF
chmod +x "$WRAPPER_SCRIPT"
chown "$REAL_USER":"$REAL_USER" "$WRAPPER_SCRIPT"

# ---------------------------------------------------------------------------
# 3. Wire the wrapper into every autostart mechanism this project uses, and
#    remove anything that would launch Chromium a second time alongside it.
# ---------------------------------------------------------------------------
echo "[kiosk] Updating autostart entries..."

# An earlier setup script (setup-pi-kiosk.sh) used a different filename for
# the same idea — remove it so it can't also fire and double-launch.
OLD_AUTOSTART_DESKTOP="$USER_HOME/.config/autostart/kiosk.desktop"
if [ -f "$OLD_AUTOSTART_DESKTOP" ]; then
  echo "  - removing old $OLD_AUTOSTART_DESKTOP (superseded by smartprint-kiosk.desktop below)"
  rm -f "$OLD_AUTOSTART_DESKTOP"
fi

mkdir -p "$USER_HOME/.config/autostart"
cat > "$USER_HOME/.config/autostart/smartprint-kiosk.desktop" << EOF
[Desktop Entry]
Type=Application
Name=SmartPrint Kiosk
Exec=$WRAPPER_SCRIPT
X-GNOME-Autostart-enabled=true
EOF
chown -R "$REAL_USER":"$REAL_USER" "$USER_HOME/.config/autostart"
echo "  - wrote $USER_HOME/.config/autostart/smartprint-kiosk.desktop"

WAYFIRE_INI="$USER_HOME/.config/wayfire.ini"
if [ -f "$WAYFIRE_INI" ]; then
  if grep -q "^smartprint_kiosk" "$WAYFIRE_INI"; then
    sed -i "s#^smartprint_kiosk = .*#smartprint_kiosk = $WRAPPER_SCRIPT#" "$WAYFIRE_INI"
  else
    printf '\n[autostart]\nsmartprint_kiosk = %s\n' "$WRAPPER_SCRIPT" >> "$WAYFIRE_INI"
  fi
  echo "  - updated $WAYFIRE_INI"
fi

LABWC_DIR="$USER_HOME/.config/labwc"
if [ -d "$LABWC_DIR" ] || [ -f "$USER_HOME/.config/labwc/autostart" ]; then
  mkdir -p "$LABWC_DIR"
  LABWC_AUTOSTART="$LABWC_DIR/autostart"
  touch "$LABWC_AUTOSTART"
  # drop any previous direct Chromium launch line and any previous wrapper line
  sed -i '/chromium.*--kiosk/d' "$LABWC_AUTOSTART"
  sed -i "\#$WRAPPER_SCRIPT#d" "$LABWC_AUTOSTART"
  echo "$WRAPPER_SCRIPT &" >> "$LABWC_AUTOSTART"
  chown -R "$REAL_USER":"$REAL_USER" "$LABWC_DIR"
  echo "  - updated $LABWC_AUTOSTART"
fi

LXDE_AUTOSTART="/etc/xdg/lxsession/LXDE-pi/autostart"
if [ -f "$LXDE_AUTOSTART" ]; then
  sed -i '/chromium.*--kiosk/d' "$LXDE_AUTOSTART"
  sed -i "\#$WRAPPER_SCRIPT#d" "$LXDE_AUTOSTART"
  echo "@$WRAPPER_SCRIPT" >> "$LXDE_AUTOSTART"
  echo "  - updated $LXDE_AUTOSTART"
fi

echo
echo "== Done =="
echo "Network backend : $NETWORK_BACKEND"
echo "Kiosk launcher  : $WRAPPER_SCRIPT"
echo "Startup log     : $USER_HOME/kiosk-startup.log (written fresh on each boot)"
echo
echo "Reboot to test: sudo reboot"
