#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SmartPrint — Universal Printer Setup for Raspberry Pi
# ═══════════════════════════════════════════════════════════════
# Usage:
#   sudo bash setup-printer.sh usb          ← USB-connected printer
#   sudo bash setup-printer.sh 192.168.1.50 ← Network printer by IP
#
# This script:
#   1. Kills cups-browsed (the source of "No suitable destination" errors)
#   2. Removes ALL existing printer queues (clean slate)
#   3. Auto-detects or connects to the printer
#   4. Sets it as the system default
#   5. Prints a test page to confirm it works
# ═══════════════════════════════════════════════════════════════

set -e

ARG="$1"
PRINTER_NAME="SmartPrint"

if [ -z "$ARG" ]; then
    echo ""
    echo "  ❌ ERROR: You must specify a connection type!"
    echo ""
    echo "  Usage:"
    echo "    sudo bash setup-printer.sh usb            ← USB printer"
    echo "    sudo bash setup-printer.sh 192.168.1.50   ← Network printer"
    echo "    sudo bash setup-printer.sh virtual        ← Virtual/Fake PDF printer"
    echo ""
    echo "  To find USB printers:     lpinfo -v | grep usb"
    echo "  To find network printers: avahi-browse -rt _ipp._tcp"
    echo ""
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  SmartPrint — Printer Setup"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── Step 1: Kill cups-browsed ─────────────────────────────
echo "[1/5] Stopping cups-browsed (the root cause of phantom queues)..."
sudo systemctl stop cups-browsed 2>/dev/null || true
sudo systemctl disable cups-browsed 2>/dev/null || true
sudo systemctl mask cups-browsed 2>/dev/null || true
echo "  ✅ cups-browsed is permanently disabled"

# ── Step 2: Remove ALL existing printer queues ────────────
echo "[2/5] Removing all existing printer queues..."
lpstat -p 2>/dev/null | awk '{print $2}' | while read printer; do
    echo "  Removing: $printer"
    sudo lpadmin -x "$printer" 2>/dev/null || true
done
rm -f ~/.cups/lpoptions 2>/dev/null || true
echo "  ✅ All old queues removed"

# ── Step 3: Detect and add the printer ────────────────────
PRINTER_URI=""

if [ "$ARG" = "usb" ] || [ "$ARG" = "USB" ]; then
    # ─── USB MODE ───
    echo "[3/5] Detecting USB printer..."
    USB_URI=$(lpinfo -v 2>/dev/null | grep "^direct usb://" | head -1 | awk '{print $2}')

    if [ -z "$USB_URI" ]; then
        echo "  ❌ No USB printer found! Make sure it's plugged in and powered on."
        echo ""
        echo "  Detected devices:"
        lpinfo -v 2>/dev/null | grep -i usb || echo "    (none)"
        echo ""
        exit 1
    fi

    PRINTER_URI="$USB_URI"
    echo "  Found USB printer: $USB_URI"

    # Try to find the best driver for this USB printer
    echo "  Finding best driver..."
    # First try driverless/everywhere
    sudo lpadmin \
        -p "$PRINTER_NAME" \
        -v "$PRINTER_URI" \
        -m everywhere \
        -L "SmartPrint Kiosk" \
        -D "SmartPrint Printer" \
        -o printer-is-shared=false \
        -E 2>/dev/null || {
        # Fallback: auto-detect driver from available PPDs
        echo "  ⚠️  IPP Everywhere not supported — finding PPD driver..."
        BEST_DRIVER=$(lpinfo --make-and-model "$(echo "$USB_URI" | sed 's/usb:\/\/\([^/]*\)\/.*/\1/' | sed 's/%20/ /g')" -m 2>/dev/null | head -1 | awk '{print $1}')

        if [ -n "$BEST_DRIVER" ]; then
            echo "  Using driver: $BEST_DRIVER"
            sudo lpadmin \
                -p "$PRINTER_NAME" \
                -v "$PRINTER_URI" \
                -m "$BEST_DRIVER" \
                -L "SmartPrint Kiosk" \
                -D "SmartPrint Printer" \
                -o printer-is-shared=false \
                -E
        else
            echo "  Using raw driver (universal fallback)..."
            sudo lpadmin \
                -p "$PRINTER_NAME" \
                -v "$PRINTER_URI" \
                -m raw \
                -L "SmartPrint Kiosk" \
                -D "SmartPrint Printer" \
                -o printer-is-shared=false \
                -E
        fi
    }

elif [ "$ARG" = "virtual" ] || [ "$ARG" = "fake" ] || [ "$ARG" = "VIRTUAL" ]; then
    # ─── VIRTUAL MODE ───
    echo "[3/5] Setting up Virtual PDF printer..."
    PRINTER_URI="cups-pdf:/"
    
    # Try to find standard CUPS-PDF driver, fallback to raw/everywhere if not found
    PDF_DRIVER=$(lpinfo -m 2>/dev/null | grep -i "cups-pdf" | head -1 | awk '{print $1}')
    if [ -n "$PDF_DRIVER" ]; then
        echo "  Found CUPS-PDF driver: $PDF_DRIVER"
        sudo lpadmin \
            -p "$PRINTER_NAME" \
            -v "$PRINTER_URI" \
            -m "$PDF_DRIVER" \
            -L "SmartPrint Virtual" \
            -D "SmartPrint Debug Printer" \
            -o printer-is-shared=false \
            -E
    else
        echo "  ⚠️  CUPS-PDF driver not found. Falling back to everywhere driver..."
        sudo lpadmin \
            -p "$PRINTER_NAME" \
            -v "$PRINTER_URI" \
            -m everywhere \
            -L "SmartPrint Virtual" \
            -D "SmartPrint Debug Printer" \
            -o printer-is-shared=false \
            -E 2>/dev/null || {
            echo "  Using raw fallback driver..."
            sudo lpadmin \
                -p "$PRINTER_NAME" \
                -v "$PRINTER_URI" \
                -m raw \
                -L "SmartPrint Virtual" \
                -D "SmartPrint Debug Printer" \
                -o printer-is-shared=false \
                -E
        }
    fi
else
    # ─── NETWORK MODE ───
    PRINTER_IP="$ARG"
    echo "[3/5] Setting up network printer at ${PRINTER_IP}..."

    # Verify reachability
    if ping -c 2 -W 3 "$PRINTER_IP" > /dev/null 2>&1; then
        echo "  ✅ Printer is online"
    else
        echo "  ⚠️  WARNING: Printer didn't respond to ping (continuing anyway...)"
    fi

    PRINTER_URI="ipp://${PRINTER_IP}/ipp/print"

    sudo lpadmin \
        -p "$PRINTER_NAME" \
        -v "$PRINTER_URI" \
        -m everywhere \
        -L "SmartPrint Kiosk" \
        -D "SmartPrint Printer" \
        -o printer-is-shared=false \
        -E 2>/dev/null || {
        echo "  ⚠️  IPP Everywhere failed — trying driverless..."
        sudo lpadmin \
            -p "$PRINTER_NAME" \
            -v "ipp://${PRINTER_IP}/ipp/print" \
            -m driverless:"ipp://${PRINTER_IP}/ipp/print" \
            -L "SmartPrint Kiosk" \
            -D "SmartPrint Printer" \
            -o printer-is-shared=false \
            -E 2>/dev/null || {
            echo "  ⚠️  Driverless failed — using raw socket..."
            PRINTER_URI="socket://${PRINTER_IP}:9100"
            sudo lpadmin \
                -p "$PRINTER_NAME" \
                -v "$PRINTER_URI" \
                -m raw \
                -L "SmartPrint Kiosk" \
                -D "SmartPrint Printer" \
                -o printer-is-shared=false \
                -E
        }
    }
fi

echo "  ✅ Printer added: ${PRINTER_URI}"

# ── Step 4: Set as system default ─────────────────────────
echo "[4/5] Setting '${PRINTER_NAME}' as the system default..."
sudo lpadmin -d "$PRINTER_NAME"
sudo cupsenable "$PRINTER_NAME"
sudo cupsaccept "$PRINTER_NAME"
echo "  ✅ Default printer set, enabled, and accepting jobs"

# ── Step 5: Verify ────────────────────────────────────────
echo "[5/5] Verifying..."
echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  Printer Name:  $(lpstat -d 2>/dev/null | awk '{print $NF}')"
echo "  │  URI:           ${PRINTER_URI}"
echo "  │  Status:        $(lpstat -p "$PRINTER_NAME" 2>/dev/null | head -1 || echo 'unknown')"
echo "  └─────────────────────────────────────────────────┘"
echo ""

# Test page
read -p "  Print a test page? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "  Sending test page..."
    echo "SmartPrint Test - $(date)" | lp -d "$PRINTER_NAME" -n 1
    echo "  ✅ Test page sent! Check the printer."
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ SETUP COMPLETE"
echo ""
echo "  To switch printers later, just run:"
echo "    sudo bash setup-printer.sh usb"
echo "    sudo bash setup-printer.sh <IP_ADDRESS>"
echo ""
echo "  Now restart the agent:"
echo "    pm2 restart smartprint-agent"
echo "═══════════════════════════════════════════════════════"
echo ""
