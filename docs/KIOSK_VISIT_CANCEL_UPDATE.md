# Kiosk visit: cancel-button agent update (AB3 + AB1)

What this visit is for, in one line: find out why AB3 stopped, then put the
new agent on **both** Pis so the kiosk's Cancel button works for the whole print.

**Rule for the whole visit: diagnose first, update second.** The update
overwrites the logs that explain the fault. Step 1 is not optional and Step 2
does not start until Kishore has read the Step 1 report and said go.

No laptop is needed at the kiosk. The Pi fetches the two files itself from
GitHub over plain HTTPS, which campus wifi allows. A phone hotspot is only
needed if Kishore has to get in remotely to diagnose something.

## Order matters

1. Pi A (AB3) — Step 1 diagnosis report → Kishore reads it → go-ahead → update
2. Pi B (AB1) — Step 1 diagnosis report → Kishore reads it → go-ahead → update
3. **Only then**, from Kishore's laptop: deploy hosting + merge the PR

A new agent under the old website is harmless. The old agent under the new
website shows a Cancel button that does nothing after the first 5 seconds.

## Getting a terminal on a kiosk Pi

Plug in a keyboard. **Alt+F4** closes the kiosk browser and shows the desktop,
**Ctrl+Alt+T** opens a terminal. A reboot at the end brings the kiosk back.

## Step 1 — diagnose, and send the report BEFORE touching anything

Run this on **each** Pi. It writes one file to the Desktop and prints it.
Send that file to Kishore (photo of the screen is fine if there is no other
way — take several, top to bottom). Then **wait for a go-ahead.**

```bash
R=~/Desktop/smartprint-diag-$(hostname)-$(date +%Y%m%d-%H%M).txt
{
echo "=== when / uptime ===";            date; uptime
echo "=== reboots (last 10) ===";        last -x reboot 2>/dev/null | head -10
echo "=== pm2 processes ===";            pm2 list
echo "=== pm2 details ===";              pm2 jlist | python3 -c 'import json,sys; [print(p["name"], p["pm2_env"]["status"], "restarts="+str(p["pm2_env"]["restart_time"]), "uptime_since="+str(p["pm2_env"].get("pm_uptime")), "path="+p["pm2_env"]["pm_exec_path"]) for p in json.load(sys.stdin)]'
echo "=== agent log, last 200 lines ==="; pm2 logs --lines 200 --nostream 2>&1
echo "=== pm2 error log tail ===";       tail -n 60 ~/.pm2/logs/*error* 2>/dev/null
echo "=== which folder is the real agent ==="; ls -la ~/smartprint-agent ~/Desktop/smartprintvit 2>&1 | head -40
echo "=== KIOSK_ID ===";                  grep -H KIOSK_ID ~/smartprint-agent/.env ~/Desktop/smartprintvit/.env 2>/dev/null
echo "=== agent file fingerprints ===";  sha256sum ~/smartprint-agent/index.js ~/Desktop/smartprintvit/index.js 2>/dev/null
echo "=== network ===";                  nmcli -t -f NAME,DEVICE,STATE con show --active 2>/dev/null; ip -4 -br addr; ping -c 2 -W 3 8.8.8.8 2>&1 | tail -2
echo "=== dns to atlas ===";             getent hosts cluster0.mongodb.net 2>&1 | head -2; nslookup -type=SRV _mongodb._tcp.$(grep -o 'mongodb+srv://[^@]*@[^/?]*' ~/Desktop/smartprintvit/.env ~/smartprint-agent/.env 2>/dev/null | head -1 | sed 's/.*@//') 2>&1 | tail -4
echo "=== printer ===";                  lpstat -p -d 2>&1; lpstat -o 2>&1 | head; ls -la /dev/usb/lp* 2>&1; lsusb 2>/dev/null | grep -i -E "canon|hp|epson|brother|print"
echo "=== disk / memory / temp ===";     df -h / ; free -m; vcgencmd measure_temp 2>/dev/null
echo "=== system journal errors, last boot ==="; journalctl -p err -b --no-pager 2>/dev/null | tail -30
echo "=== kiosk browser url ===";        grep -h -o 'kiosk-app[^ "]*' ~/.config/autostart/*.desktop ~/*.sh /usr/local/bin/*kiosk* 2>/dev/null | sort -u
} > "$R" 2>&1
echo "REPORT WRITTEN: $R"; wc -l "$R"; cat "$R"
```

What Kishore is looking for in the AB3 report (so you know what matters):

- `pm2 list` empty or `errored`/`stopped` → the process died; the log tail
  says why (`querySrv`, `MASTER_KEY`, `Download timed out`, out of memory…)
- `restarts=` in the hundreds → it has been crash-looping, not dead
- `uptime` of a few minutes → the Pi itself loses power or reboots
- `ping` failing → wifi dropped and never came back
- the KIOSK_ID and which folder pm2 actually runs from
- `lpstat` showing the printer `disabled` or a stuck queue

Also note by eye: is the printer on, any error on its panel, paper loaded,
and does the kiosk screen show the idle page.

**AB1 gets the same report.** It printed fine today, so the expected result is
"no issues" — but that is verified, not assumed. If its report is clean, it
gets the Step 2 update too (it needs it for the Cancel button).

## Step 2 — update the agent (same block on both Pis) — ONLY after Kishore says go

Paste the whole block. It finds the real agent folder from pm2 (on AB3 that is
`/home/student/Desktop/smartprintvit/`, **not** `~/smartprint-agent`), backs
up, fetches, verifies, restarts.

```bash
NAME=$(pm2 jlist | python3 -c 'import json,sys; print([p["name"] for p in json.load(sys.stdin) if "agent" in p["name"]][0])')
DIR=$(pm2 jlist | python3 -c 'import json,sys,os; print(os.path.dirname([p["pm2_env"]["pm_exec_path"] for p in json.load(sys.stdin) if "agent" in p["name"]][0]))')
echo "process=$NAME  dir=$DIR"
cd "$DIR" || exit 1
STAMP=$(date +%Y%m%d-%H%M%S)
cp index.js "index.js.prev-$STAMP" && cp models/PrintJob.js "models/PrintJob.js.prev-$STAMP"
B=https://raw.githubusercontent.com/theRealestOne2922/SmartPrint/feat/cancel-mid-print/pi-print-agent
curl -fsSL "$B/index.js" -o index.js.new && curl -fsSL "$B/models/PrintJob.js" -o models/PrintJob.js.new
echo "expect b002a69a001b1969  got $(sha256sum index.js.new | cut -c1-16)"
echo "expect 41961c68238750ff  got $(sha256sum models/PrintJob.js.new | cut -c1-16)"
```

**Both `got` values must match `expect`.** If either differs, do NOT continue —
delete the `.new` files and send Kishore the output.

```bash
mv index.js.new index.js && mv models/PrintJob.js.new models/PrintJob.js
node --check index.js && echo SYNTAX-OK
grep KIOSK_ID .env
pm2 restart "$NAME" && sleep 8 && pm2 logs "$NAME" --lines 30 --nostream
```

What good looks like in the log:

- `Kiosk: pi-a-vit` on AB3, `Kiosk: pi-b-vit` on AB1 — **if it is wrong or
  missing, stop and call Kishore**, do not edit .env on your own
- `✅ Connected & listening for new jobs via Change Stream!`
- no `KIOSK ID CONFLICT`, no `querySrv`, no `Missing`

Then `pm2 save` and `sudo reboot`. After reboot the kiosk screen should come
back on its own within about a minute.

## Step 3 — test print on that kiosk (2 minutes)

Upload any 2-page PDF from the student site, get the code, type it at the
kiosk, press Release.

1. Press **Cancel during the countdown** → kiosk goes back to idle, nothing
   prints, and the same code can be typed again.
2. Type it again, let the countdown finish, and **press Cancel right after** →
   kiosk shows the grey "Print Cancelled" screen. Small PDFs are usually
   already past CUPS by then, so a page may still come out — that is expected
   and the screen says so. What must NOT happen: the kiosk showing the green
   success screen after you pressed Cancel.
3. One more, let it print normally → green success screen, paper out.

If step 3 fails on AB3, the kiosk browser URL is worth a look: it must end in
`?kiosk=pi-a-vit`.

## If you get stuck

Turn on a phone hotspot, connect the Pi to it (`nmtui` or the wifi icon), and
message Kishore — with Tailscale up he can ssh in and take over. Campus wifi
blocks Tailscale, the hotspot does not.

## Rolling back (only if the agent will not start after the update)

```bash
cd "$DIR" && ls index.js.prev-* models/PrintJob.js.prev-*
cp index.js.prev-<STAMP> index.js && cp models/PrintJob.js.prev-<STAMP> models/PrintJob.js
pm2 restart "$NAME"
```

## Step 4 — Kishore, after both Pis report good

```bash
cd "student web app" && cat .firebaserc   # must say smartprintvit, never smartprintpl
npm run build && firebase deploy --only hosting --project smartprintvit
```

Then merge <https://github.com/theRealestOne2922/SmartPrint/pull/1>.
