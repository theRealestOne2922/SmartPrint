# Kiosk visit: cancel-button agent update (AB3 + AB1)

What this visit is for, in one line: put the new agent on **both** Pis so the
kiosk's Cancel button works for the whole print, and bring AB3 back to life.

No laptop is needed at the kiosk. The Pi fetches the two files itself from
GitHub over plain HTTPS, which campus wifi allows. A phone hotspot is only
needed if Kishore has to get in remotely to diagnose something.

## Order matters

1. Pi A (AB3) — update + find out why it has been dead
2. Pi B (AB1) — update
3. **Only then**, from Kishore's laptop: deploy hosting + merge the PR

A new agent under the old website is harmless. The old agent under the new
website shows a Cancel button that does nothing after the first 5 seconds.

## Getting a terminal on a kiosk Pi

Plug in a keyboard. **Alt+F4** closes the kiosk browser and shows the desktop,
**Ctrl+Alt+T** opens a terminal. A reboot at the end brings the kiosk back.

## Step 1 — is the agent even running? (do this on AB3 first)

```bash
pm2 list
```

- Process named `smartprint-agent` (or `print-agent`) with status `online`
  → fine, go to Step 2.
- `errored` / `stopped` / not listed → run `pm2 logs --lines 60` and
  **photograph the screen** before touching anything. That is the 26-day
  answer. Then continue with Step 2 anyway; the update includes a fix for the
  most likely cause (a download that stumbled and was never retried).
- `pm2` itself not found → the Pi was reimaged or it is a different user.
  Stop and send Kishore a photo of `ls ~ ~/Desktop`.

Also check the printer is on and shows no paper/toner error, and that
`lpstat -p` says `idle`.

## Step 2 — update the agent (same block on both Pis)

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
