$src = '.'
$dst = '..\SmartPrint_final'

Copy-Item -Path "$src\student web app\client\src\hooks\use-print.ts" -Destination "$dst\student web app\client\src\hooks\use-print.ts" -Force
Copy-Item -Path "$src\student web app\client\src\pages\print-wizard.tsx" -Destination "$dst\student web app\client\src\pages\print-wizard.tsx" -Force
Copy-Item -Path "$src\student web app\client\src\pages\job-status.tsx" -Destination "$dst\student web app\client\src\pages\job-status.tsx" -Force
Copy-Item -Path "$src\student web app\client\src\App.tsx" -Destination "$dst\student web app\client\src\App.tsx" -Force

Copy-Item -Path "$src\kiosk ui\client\src\hooks\use-print-jobs.ts" -Destination "$dst\kiosk ui\client\src\hooks\use-print-jobs.ts" -Force
Copy-Item -Path "$src\kiosk ui\client\src\pages\JobConfirmationScreen.tsx" -Destination "$dst\kiosk ui\client\src\pages\JobConfirmationScreen.tsx" -Force
Copy-Item -Path "$src\kiosk ui\client\src\pages\PrintingScreen.tsx" -Destination "$dst\kiosk ui\client\src\pages\PrintingScreen.tsx" -Force

Copy-Item -Path "$src\pi-print-agent\index.js" -Destination "$dst\pi-print-agent\index.js" -Force
echo 'Files copied successfully.'
