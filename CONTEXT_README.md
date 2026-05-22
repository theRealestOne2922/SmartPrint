# Antigravity Project Context

Welcome to the SmartPrintVIT project! We just fixed some critical bugs on the college PC before exporting this to the laptop.

## Recent Fixes Implemented:
1. **A3 Booklet Fix**: Reverted the dual-page A3 experimental logic back to standard Saddle-Stitch layout to fix physical Duplex printing.
2. **UI Orientation Hide**: Hidden Portrait/Landscape options in the wizard when A3 is selected, as A3 is strictly for booklets.
3. **Global Options Toggle**: Replaced the global settings dropdown with a toggle switch and an 'Apply to All' quick action that iterates through individual files.
4. **Admin Limits**: Replaced hardcoded MAX_FILES = 5 with dynamic DB fetch from 'maxFilesLimit' setting.
5. **File Retention**: Rewrote 'server/cleanup.ts' to dynamically read 'jobExpirationHours' from the admin panel and automatically delete expired DB rows and Supabase storage files.

## Next Steps on Laptop:
Since we updated the backend (cleanup.ts) and the physical agent (index.js), ensure that you run the server locally or deploy it to your backend hosting, and remember to push the updated pi-print-agent folder to the physical Raspberry Pi!
