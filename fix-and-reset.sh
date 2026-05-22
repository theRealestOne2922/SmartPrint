#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SmartPrint — Emergency CUPS Reset & Virtual Printer Purge
# ═══════════════════════════════════════════════════════════════

echo "🚨 PANIC RESET: Wiping Virtual Printer & Resetting CUPS..."
echo ""

echo "[1] Stopping print agent..."
pm2 stop smartprint-agent 2>/dev/null || true

echo "[2] Purging Virtual Printer driver completely from system..."
sudo apt-get purge -y printer-driver-cups-pdf
sudo apt-get autoremove -y

echo "[3] Wiping all existing printer queues..."
for p in $(lpstat -p 2>/dev/null | awk '{print $2}'); do
    sudo lpadmin -x "$p" 2>/dev/null || true
done
rm -f ~/.cups/lpoptions 2>/dev/null || true
sudo rm -f /root/.cups/lpoptions 2>/dev/null || true
sudo rm -f /etc/cups/lpoptions 2>/dev/null || true

echo "[4] Restarting CUPS Service to clear memory..."
sudo systemctl restart cups
sleep 3

echo "[5] Binding Physical USB Printer..."
USB_URI=$(lpinfo -v 2>/dev/null | grep "^direct usb://" | head -1 | awk '{print $2}')
if [ -n "$USB_URI" ]; then
    echo "    Found USB: $USB_URI"
    
    # Attempt standard everywhere driver
    sudo lpadmin -p SmartPrint -v "$USB_URI" -m everywhere -o printer-is-shared=false -E 2>/dev/null || {
        echo "    ⚠️ IPP Everywhere failed, falling back to auto-matching..."
        BEST_DRIVER=$(lpinfo --make-and-model "$(echo "$USB_URI" | sed 's/usb:\/\/\([^/]*\)\/.*/\1/' | sed 's/%20/ /g')" -m 2>/dev/null | head -1 | awk '{print $1}')
        if [ -n "$BEST_DRIVER" ]; then
            sudo lpadmin -p SmartPrint -v "$USB_URI" -m "$BEST_DRIVER" -o printer-is-shared=false -E
        else
            echo "    ⚠️ No specific driver found. Using RAW connection."
            sudo lpadmin -p SmartPrint -v "$USB_URI" -m raw -o printer-is-shared=false -E
        fi
    }
    
    # Set default and enable
    sudo lpadmin -d SmartPrint 2>/dev/null || true
    sudo cupsenable SmartPrint 2>/dev/null || true
    sudo cupsaccept SmartPrint 2>/dev/null || true
    echo "✅ USB Printer mapped successfully to SmartPrint!"
else
    echo "❌ NO USB PRINTER DETECTED. Make sure it is plugged in securely!"
fi

echo ""
echo "[6] Restarting print agent in background..."
pm2 restart smartprint-agent 2>/dev/null || true

echo ""
echo "==================================================================="
echo "✅ DONE! The virtual printer is gone and CUPS is clean."
echo "Please send a test print from your web app now."
echo "If it fails, run:  pm2 logs smartprint-agent"
echo "==================================================================="
