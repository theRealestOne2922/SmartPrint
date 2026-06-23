#!/bin/bash

# Ensure the script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script with sudo: sudo bash setup-pi-kiosk.sh"
  exit 1
fi

echo "Installing unclutter to hide mouse cursor..."
apt-get update
apt-get install -y unclutter

echo "Configuring PERMANENT Xorg resolution at the system level..."

# Ensure the X11 configuration directory exists
mkdir -p /etc/X11/xorg.conf.d/

# Write the permanent monitor configuration directly into the Linux graphics system
cat << 'EOF' > /etc/X11/xorg.conf.d/10-monitor.conf
Section "Monitor"
    Identifier "HDMI-1"
    Modeline "1024x600_60.00" 49.00 1024 1072 1168 1312 600 603 613 624 -hsync +vsync
    Option "PreferredMode" "1024x600_60.00"
EndSection

Section "Screen"
    Identifier "Screen0"
    Monitor "HDMI-1"
    DefaultDepth 24
    SubSection "Display"
        Modes "1024x600_60.00"
    EndSubSection
EndSection
EOF

echo "Xorg configuration saved. 1024x600 is now a native system resolution!"

# Target user and home directory
USER_NAME="student"
USER_HOME="/home/student"
KIOSK_SCRIPT="${USER_HOME}/kiosk.sh"

echo "Creating clean kiosk startup script at ${KIOSK_SCRIPT}..."
cat << 'EOF' > ${KIOSK_SCRIPT}
#!/bin/bash

# 1. WAIT FOR DESKTOP TO LOAD
sleep 3 

# 2. FORCE DESKTOP ENVIRONMENT CONNECTION
export DISPLAY=:0
export XAUTHORITY=/home/student/.Xauthority

# Note: All xrandr commands have been removed because the system now handles the resolution natively!

# 3. PREVENT SCREEN FROM SLEEPING 
xset s noblank
xset s off
xset -dpms

# 4. HIDE MOUSE CURSOR 
unclutter -idle 0.5 -root &

# 5. CLEAR CRASH FLAGS 
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' ~/.config/chromium/Default/Preferences 2>/dev/null
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' ~/.config/chromium/Default/Preferences 2>/dev/null

# 6. DETECT BROWSER COMMAND
if command -v chromium-browser >/dev/null 2>&1; then
    BROWSER_CMD="chromium-browser"
elif command -v chromium >/dev/null 2>&1; then
    BROWSER_CMD="chromium"
else
    BROWSER_CMD="chromium-browser" 
fi

# 7. LAUNCH KIOSK APP 
$BROWSER_CMD \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --check-for-update-interval=31536000 \
  --password-store=basic \
  "https://smartprintvit.web.app/kiosk-app"
EOF

# Make it executable and set ownership
chmod +x ${KIOSK_SCRIPT}
chown ${USER_NAME}:${USER_NAME} ${KIOSK_SCRIPT}

echo "Configuring rock-solid XDG autostart..."

AUTOSTART_DIR="${USER_HOME}/.config/autostart"
mkdir -p ${AUTOSTART_DIR}

cat << EOF > ${AUTOSTART_DIR}/kiosk.desktop
[Desktop Entry]
Type=Application
Name=Kiosk
Exec=/home/student/kiosk.sh
X-GNOME-Autostart-enabled=true
EOF

chown -R ${USER_NAME}:${USER_NAME} ${USER_HOME}/.config/autostart

echo "========================================================"
echo "System-Level Setup Complete!"
echo "Please reboot to test the permanent native resolution."
echo "========================================================"
