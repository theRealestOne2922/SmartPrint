#!/bin/bash
# ============================================
# SMARTPRINT FULL PRINTER RESET
# Run on Pi: bash fix-printer.sh
# ============================================

echo ""
echo "============================================"
echo "  SMARTPRINT PRINTER FIX"
echo "============================================"
echo ""

# Step 1: Stop the agent
echo ">>> Step 1: Stopping print agent..."
pm2 stop smartprint-agent 2>/dev/null || true
echo "   Done"
echo ""

# Step 2: Cancel all stuck jobs
echo ">>> Step 2: Clearing CUPS queue..."
cancel -a 2>/dev/null || true
echo "   Done"
echo ""

# Step 3: Find the old printer name
echo ">>> Step 3: Current printers:"
lpstat -p -d 2>/dev/null
echo ""

# Step 4: Delete ALL existing printers
echo ">>> Step 4: Removing all printers..."
for p in $(lpstat -p 2>/dev/null | awk '{print $2}'); do
    echo "   Removing: $p"
    sudo lpadmin -x "$p" 2>/dev/null || true
done
echo "   Done"
echo ""

# Step 5: Wipe ALL lpoptions (the source of ghost copies)
echo ">>> Step 5: Wiping all saved printer options..."
rm -f ~/.cups/lpoptions 2>/dev/null
sudo rm -f /root/.cups/lpoptions 2>/dev/null
sudo rm -f /etc/cups/lpoptions 2>/dev/null
echo "   Done"
echo ""

# Step 6: Restart CUPS clean
echo ">>> Step 6: Restarting CUPS..."
sudo systemctl restart cups
sleep 2
echo "   Done"
echo ""

# Step 7: Find the printer
echo ">>> Step 7: Scanning for your HP printer..."
echo "   Available printers:"
lpinfo -v 2>/dev/null | grep -iE "hp|smart|tank|510|dnssd|ipp|usb" || echo "   (none found via grep, showing all:)"
echo ""
echo "   All devices:"
lpinfo -v 2>/dev/null | head -20
echo ""

# Step 8: Auto-detect and add the HP printer
echo ">>> Step 8: Adding printer..."
# Try dnssd first (WiFi printer), then IPP, then USB
PRINTER_URI=$(lpinfo -v 2>/dev/null | grep -i "dnssd.*hp.*smart.*tank\|dnssd.*510" | head -1 | awk '{print $2}')

if [ -z "$PRINTER_URI" ]; then
    PRINTER_URI=$(lpinfo -v 2>/dev/null | grep -i "ipp.*hp\|ipp.*510\|ipp.*smart" | head -1 | awk '{print $2}')
fi

if [ -z "$PRINTER_URI" ]; then
    PRINTER_URI=$(lpinfo -v 2>/dev/null | grep -i "usb.*hp\|usb.*510" | head -1 | awk '{print $2}')
fi

if [ -z "$PRINTER_URI" ]; then
    echo "   ❌ Could not auto-detect printer!"
    echo "   Please find your printer URI above and run:"
    echo "   sudo lpadmin -p SmartPrint -E -v 'YOUR_URI_HERE' -m everywhere"
    echo "   sudo lpadmin -d SmartPrint"
    exit 1
fi

echo "   Found: $PRINTER_URI"
sudo lpadmin -p SmartPrint -E -v "$PRINTER_URI" -m everywhere
sudo lpadmin -d SmartPrint
sudo cupsenable SmartPrint
sudo cupsaccept SmartPrint
echo "   ✅ Printer 'SmartPrint' added as default"
echo ""

# Step 9: Verify
echo ">>> Step 9: Verification:"
lpstat -p -d
echo ""

# Step 10: Test print
echo ">>> Step 10: Sending test print (should be EXACTLY 1 page)..."
echo "SmartPrint Test Page - $(date)" | lp -n 1
echo ""

echo "============================================"
echo "  ✅ DONE! Check if EXACTLY 1 page printed."
echo ""  
echo "  If yes: run 'pm2 restart smartprint-agent'"
echo "  If no:  share the output and we'll debug"
echo "============================================"
