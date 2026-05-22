# Deploy smartprintvit: Student Web App + Kiosk UI merged into one Firebase site

# Step 1: Build student web app
Write-Host "=== Building Student Web App ===" -ForegroundColor Cyan
Set-Location "d:\smartprintvit\student web app"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Student build failed!"; exit 1 }

# Step 2: Build kiosk UI
Write-Host "=== Building Kiosk UI ===" -ForegroundColor Cyan
Set-Location "d:\smartprintvit\kiosk ui"
# Define kiosk distribution path
$kioskDist = "d:\smartprintvit\kiosk ui\dist\public"
npm run build
# Verify kiosk build produced index.html
if (!(Test-Path "$kioskDist\index.html")) {
    Write-Host "[ERROR] Kiosk build missing index.html - aborting deployment." -ForegroundColor Red
    exit 1
}
if ($LASTEXITCODE -ne 0) { Write-Host "Kiosk build failed!"; exit 1 }

# Step 3: Copy kiosk build into student web app's dist/public/kiosk-app/
Write-Host "=== Merging Kiosk UI into Student Web App ===" -ForegroundColor Cyan
$targetDir = "d:\smartprintvit\student web app\dist\public\kiosk-app"
if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -Recurse -Force "$kioskDist\*" $targetDir
Write-Host "Kiosk files copied to $targetDir"

# Step 4: Deploy from student web app
Write-Host "=== Deploying Student Web App to Firebase ===" -ForegroundColor Cyan
Set-Location "d:\smartprintvit\student web app"
firebase deploy

# (Optional) Deploy Kiosk UI directly to Firebase – omitted to avoid overwriting merged site
# Write-Host "=== Deploying Kiosk UI to Firebase ===" -ForegroundColor Cyan
# Set-Location "d:\smartprintvit\kiosk ui"
# firebase deploy

Write-Host "=== DONE ===" -ForegroundColor Green
