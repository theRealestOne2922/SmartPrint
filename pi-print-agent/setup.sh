#!/bin/bash

echo "==================================================="
echo "   SMARTPRINT: RASPBERRY PI PRINT AGENT SETUP"
echo "==================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null
then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "Run: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "Then: sudo apt-get install -y nodejs"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null
then
    echo "❌ npm is not installed. Please install npm."
    exit 1
fi

echo "✅ Node.js and npm are installed."

echo ""
echo "📦 Installing Dependencies..."
npm install

if [ ! -f .env ]; then
    echo ""
    echo "⚠️ .env file not found. Creating one from .env.example..."
    cp .env.example .env
    echo "🚨 IMPORTANT: Edit .env and set MONGODB_URI and MASTER_KEY."
    echo "   MASTER_KEY must match the backend's exactly, or confidential jobs won't decrypt."
    echo "Run 'nano .env' to edit the file."
else
    echo "✅ .env file exists."
fi

echo ""
echo "🚀 To run the agent manually, use:"
echo "   npm start"
echo ""
echo "🛠️ To keep it running in the background forever (even after reboot):"
echo "   1. sudo npm install -g pm2"
echo "   2. pm2 start index.js --name smartprint-agent"
echo "   3. pm2 save"
echo "   4. pm2 startup"
echo ""
echo "🖥️  To start the Raspberry Pi attached screen directly in Kiosk Mode:"
echo "   1. Open the Pi autostart config: sudo nano /etc/xdg/lxsession/LXDE-pi/autostart"
echo "   2. Add this line at the bottom to launch full-screen without errors:"
echo "      @chromium-browser --noerrdialogs --disable-infobars --kiosk https://smartprintpl.web.app/kiosk-app"
echo "==================================================="
