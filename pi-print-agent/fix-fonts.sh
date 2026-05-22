#!/bin/bash
# ═══════════════════════════════════════════════════════════
# SmartPrint — Fix Word-to-PDF Font Rendering on Raspberry Pi
# ═══════════════════════════════════════════════════════════
# This installs Microsoft-compatible fonts so LibreOffice can
# render Word documents WITHOUT changing fonts/spacing/pages.
#
# Run once: sudo bash fix-fonts.sh
# ═══════════════════════════════════════════════════════════

set -e

echo "═══════════════════════════════════════════"
echo "  SmartPrint Font Fix for Raspberry Pi"
echo "═══════════════════════════════════════════"
echo ""

# 1. Accept the MS fonts EULA automatically and install
echo "[1/5] Installing Microsoft Core Fonts (Arial, Times New Roman, Courier New, etc.)..."
echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | sudo debconf-set-selections
sudo apt-get install -y ttf-mscorefonts-installer 2>/dev/null || {
    echo "  ⚠ mscorefonts failed — trying manual download..."
    sudo apt-get install -y cabextract
    mkdir -p /tmp/msfonts && cd /tmp/msfonts
    wget -q https://downloads.sourceforge.net/corefonts/arial32.exe \
            https://downloads.sourceforge.net/corefonts/times32.exe \
            https://downloads.sourceforge.net/corefonts/calibri.zip \
            2>/dev/null || true
    cabextract -q *.exe 2>/dev/null || true
    sudo mkdir -p /usr/share/fonts/truetype/msttcorefonts
    sudo cp *.ttf *.TTF /usr/share/fonts/truetype/msttcorefonts/ 2>/dev/null || true
    cd -
}

# 2. Install Liberation fonts (metrically identical to MS fonts)
echo "[2/5] Installing Liberation fonts (Calibri/Cambria equivalents)..."
sudo apt-get install -y fonts-liberation fonts-liberation2 2>/dev/null || true

# 3. Install additional compatibility fonts
echo "[3/5] Installing Carlito & Caladea (exact Calibri & Cambria metric clones)..."
sudo apt-get install -y fonts-crosextra-carlito fonts-crosextra-caladea 2>/dev/null || true

# 4. Install Noto fonts for any Unicode fallback (symbols, special chars)
echo "[4/5] Installing Noto Sans for Unicode fallback..."
sudo apt-get install -y fonts-noto-core 2>/dev/null || true

# 5. Rebuild font cache
echo "[5/5] Rebuilding font cache..."
sudo fc-cache -f -v > /dev/null 2>&1

# Verify key fonts are available
echo ""
echo "═══════════════════════════════════════════"
echo "  Font Verification"
echo "═══════════════════════════════════════════"
echo -n "  Arial:           "; fc-match "Arial" 2>/dev/null || echo "NOT FOUND"
echo -n "  Times New Roman: "; fc-match "Times New Roman" 2>/dev/null || echo "NOT FOUND"
echo -n "  Calibri:         "; fc-match "Calibri" 2>/dev/null || echo "NOT FOUND"
echo -n "  Cambria:         "; fc-match "Cambria" 2>/dev/null || echo "NOT FOUND"
echo -n "  Courier New:     "; fc-match "Courier New" 2>/dev/null || echo "NOT FOUND"
echo ""
echo "✅ Done! Restart the print agent:  pm2 restart smartprint-agent"
echo ""
