# Deploy SmartPrint_final: Student Web App + Kiosk UI merged into one Firebase site

# Step 1: Build student web app
Write-Host "=== Building Student Web App ===" -ForegroundColor Cyan
Set-Location "D:\SmartPrint_final\student web app"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Student build failed!"; exit 1 }

# Step 2: Build kiosk UI
Write-Host "=== Building Kiosk UI ===" -ForegroundColor Cyan
Set-Location "D:\SmartPrint_final\kiosk ui"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Kiosk build failed!"; exit 1 }

# Step 3: Copy kiosk build into student web app's dist/public/kiosk-app/
Write-Host "=== Merging Kiosk UI into Student Web App ===" -ForegroundColor Cyan
$kioskDist = "D:\SmartPrint_final\kiosk ui\dist\public"
$targetDir = "D:\SmartPrint_final\student web app\dist\public\kiosk-app"

if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -Recurse -Force "$kioskDist\*" $targetDir
Write-Host "Kiosk files copied to $targetDir"

# Step 4: Deploy from student web app
Write-Host "=== Deploying to Firebase ===" -ForegroundColor Cyan
Set-Location "D:\SmartPrint_final\student web app"
firebase deploy
Write-Host "=== DONE ===" -ForegroundColor Green
