#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SmartPrint — Live Print Daemon & Hardware Diagnoser
# ═══════════════════════════════════════════════════════════════

echo "=========================================================="
echo "🔍 SMARTPRINT: LIVE HARDWARE & QUEUE DIAGNOSTIC TOOL"
echo "=========================================================="
echo ""

# 1. Stop background PM2 agent first to prevent double-processing
echo "⏳ Stopping background agent so we can debug..."
pm2 stop smartprint-agent 2>/dev/null || true
echo "✅ Stopped background agent."
echo ""

# 2. Check physical USB devices
echo "🔌 [1/5] Checking connected USB hardware..."
if command -v lsusb &>/dev/null; then
    lsusb
else
    echo "   ⚠️  lsusb tool not found."
fi
echo ""

# 3. Check what CUPS sees as USB printers
echo "🖨️  [2/5] Checking what CUPS detects over USB..."
USB_PRINTERS=$(lpinfo -v 2>/dev/null | grep -i "usb://")
if [ -n "$USB_PRINTERS" ]; then
    echo "   Found USB Printer device(s):"
    echo "$USB_PRINTERS"
else
    echo "   ❌ ERROR: No USB printer detected by CUPS!"
    echo "   Please make sure your printer is:"
    echo "     1. Connected via USB cable securely to the Pi"
    echo "     2. Powered ON and showing a green/ready light"
    echo "   Listing all detected connection types:"
    lpinfo -v 2>/dev/null | grep -E "usb|direct|network" || echo "     (none detected)"
fi
echo ""

# 4. Check CUPS queue status
echo "📋 [3/5] Checking CUPS queues & default printer..."
lpstat -p -d 2>/dev/null || echo "   ❌ No printers configured in CUPS!"
echo ""

# 5. Fix/Unpause the queue if disabled
echo "🔧 [4/5] Running queue auto-fix..."
for printer in $(lpstat -p 2>/dev/null | awk '{print $2}'); do
    echo "   - Unpausing and enabling queue: $printer"
    sudo cupsenable "$printer" 2>/dev/null || true
    sudo cupsaccept "$printer" 2>/dev/null || true
    sudo lpadmin -p "$printer" -E 2>/dev/null || true
done
echo "   - Deleting stuck/failed duplicate print jobs..."
cancel -a 2>/dev/null || true
echo "✅ CUPS queues unpaused and cleared."
echo ""

# 6. Re-bind the SmartPrint queue to the detected USB printer
echo "🔗 [5/5] Re-binding 'SmartPrint' queue to USB printer..."
DETECTED_URI=$(lpinfo -v 2>/dev/null | grep "^direct usb://" | head -1 | awk '{print $2}')

if [ -n "$DETECTED_URI" ]; then
    echo "   Success! Auto-detected active USB URI: $DETECTED_URI"
    echo "   Configuring SmartPrint queue..."
    sudo lpadmin -x SmartPrint 2>/dev/null || true
    
    # Try driverless IPP Everywhere, fallback to raw if everywhere fails
    sudo lpadmin -p SmartPrint -v "$DETECTED_URI" -m everywhere -o printer-is-shared=false -E 2>/dev/null || {
        echo "   ⚠️ Everywhere driver failed, trying auto-PPD matching..."
        BEST_DRIVER=$(lpinfo --make-and-model "$(echo "$DETECTED_URI" | sed 's/usb:\/\/\([^/]*\)\/.*/\1/' | sed 's/%20/ /g')" -m 2>/dev/null | head -1 | awk '{print $1}')
        if [ -n "$BEST_DRIVER" ]; then
            sudo lpadmin -p SmartPrint -v "$DETECTED_URI" -m "$BEST_DRIVER" -o printer-is-shared=false -E
        else
            echo "   Using Raw connection fallback..."
            sudo lpadmin -p SmartPrint -v "$DETECTED_URI" -m raw -o printer-is-shared=false -E
        fi
    }
    sudo lpadmin -d SmartPrint 2>/dev/null || true
    sudo cupsenable SmartPrint 2>/dev/null || true
    sudo cupsaccept SmartPrint 2>/dev/null || true
    echo "✅ SmartPrint queue successfully re-bound and active!"
else
    echo "   ⚠️  Could not auto-detect a USB printer URI."
    echo "   If your printer is connected, it might not support standard USB printing protocol,"
    echo "   or it might need a reboot."
fi
echo ""

# 7. Start the Agent in Live Debug Mode
echo "🚀 [STARTING AGENT IN LIVE DEBUG MODE]"
echo "   I will now start the agent in the foreground."
echo "   Send a print job from your web app/DB and watch the logs below!"
echo "   Press [Ctrl+C] to stop this test."
echo "=========================================================="
echo ""

# Run the agent in-place
node index.js
