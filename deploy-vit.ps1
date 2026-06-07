Write-Host "Building Student Web App..."
cd "student web app"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Student Web App build failed"; exit 1 }
cd ..

Write-Host "Building Kiosk UI..."
cd "kiosk ui"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Kiosk UI build failed"; exit 1 }
cd ..

Write-Host "Copying Kiosk UI to Student Web App distribution folder..."
if (!(Test-Path -Path "student web app\dist\public\kiosk-app")) {
    New-Item -ItemType Directory -Force -Path "student web app\dist\public\kiosk-app"
}
Copy-Item -Path "kiosk ui\dist\public\*" -Destination "student web app\dist\public\kiosk-app\" -Recurse -Force

Write-Host "Deploying to Firebase Hosting..."
cd "student web app"
npx firebase deploy --only hosting
cd ..

Write-Host "Done!"
