#!/usr/bin/env bash
# ─── SmartPrint VIT — Render.com Build Script ───
# Builds both the Student Web App and Kiosk UI,
# then merges the Kiosk UI into the Student Web App's dist.
set -e

echo "═══════════════════════════════════════════"
echo "  SmartPrint VIT — Production Build"
echo "═══════════════════════════════════════════"

# 1. Build Student Web App (frontend + backend)
echo ""
echo "▸ Step 1/3: Building Student Web App..."
cd "student web app"
npm install
npm run build
cd ..

# 2. Build Kiosk UI (frontend only — backend runs on Student Web App server)
echo ""
echo "▸ Step 2/3: Building Kiosk UI..."
cd "kiosk ui"
npm install
npm run build
cd ..

# 3. Merge: Copy kiosk build output into student app's dist
echo ""
echo "▸ Step 3/3: Merging Kiosk UI into Student Web App..."
mkdir -p "student web app/dist/public/kiosk-app"
cp -r "kiosk ui/dist/public/"* "student web app/dist/public/kiosk-app/"

echo ""
echo "✅ Build complete!"
echo "   Student Web App: student web app/dist/index.cjs"
echo "   Static files:    student web app/dist/public/"
echo "   Kiosk UI:        student web app/dist/public/kiosk-app/"
