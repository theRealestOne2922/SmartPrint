# Two-kiosk rollout — day-one runbook

Turning one kiosk into two, on one database. Follow it in order; each step
assumes the one before it was verified, not just performed.

| | Tailscale hostname | `KIOSK_ID` | Which |
|---|---|---|---|
| Kiosk A | `pi-a-vit` | `pi-a-vit` | the existing Pi |
| Kiosk B | `pi-b-vit` | `pi-b-vit` | the new Pi |

**The same name has to appear in three places for a kiosk to work at all:**

1. the backend's `ALLOWED_KIOSK_IDS`
2. that Pi's `KIOSK_ID` in `~/smartprint-agent/.env`
3. that kiosk's browser URL, as `?kiosk=<id>`

Miss (1) and staff get *"This kiosk is not set up correctly"* when they press
Release. Miss (2) and the agent refuses to start. Miss (3) and the release
quietly succeeds and nothing ever prints — that is the one to watch for, and
the only one with no immediate symptom at the kiosk.

---

## 0. Before you leave the house

The Pi update procedure pulls from `main` on GitHub. This work is on
`feat/multi-kiosk-routing` — **merge and push it first**, or the Pis will fetch
the old agent and none of this exists.

Then set on the backend VM (`student web app/.env`) and restart it:

```bash
ALLOWED_KIOSK_IDS=pi-a-vit,pi-b-vit
```

Then deploy hosting. **Check `.firebaserc` says `smartprintvit` before you
run it** — `smartprintpl` is a different college's live site.

```bash
firebase deploy --only hosting
```

Backend before kiosks, always. The kiosk id check fails closed: a kiosk whose
id the server does not know has every release rejected.

Deploying now changes nothing visible. No kiosk sends a `kioskId` until its URL
carries `?kiosk=`, and the server treats "no kioskId" exactly as it does today.

---

## 1. Pre-flight — no job mid-flight

A job already at `printing` predates the `kioskId` field, so once the agents
are kiosk-scoped neither will claim it and it will sit there. Confirm the queue
is empty before touching anything:

```bash
node .check-today-activity2.mjs
```

`Currently stuck in "printing": 0` — otherwise let those finish first.

---

## 2. Kiosk A (the existing Pi) — alone, start to finish

Do not unbox the new Pi until A is upgraded and verified. If something is
wrong, you want to be debugging one kiosk, not two at once.

### 2.1 Fix the clock — before anything else

Kiosk A's clock was **91 hours behind** when last checked. Timestamps written
by an agent are read by the other one, and nothing that compares them is
trustworthy until this is right.

```bash
sudo timedatectl set-ntp true
```

Check `timedatectl` shows *System clock synchronized: yes*. If it will not
sync, that network is blocking NTP — say so and stop here rather than
carrying on with a clock you know is wrong.

### 2.2 Confirm which machine you are on

```bash
cd ~/smartprint-agent && node whichdeployment.mjs --expect <hash>
```

`CONFIRMED` means VIT, not the other college. It does **not** tell you A from
B — both VIT Pis share one `MASTER_KEY`. Today that is unambiguous anyway,
since B does not exist yet.

### 2.3 Update the agent

```bash
pm2 list; ls -d ~/smartprint-agent ~/smartprintvit/pi-print-agent 2>/dev/null
```

A git clone → `git pull origin main && npm install`. Otherwise follow §2.3b of
`PI_REMOTE_ACCESS_AND_UPDATE.md` and fetch **all four** files — `index.js` will
not start without the matching `models/PrintJob.js`.

### 2.4 Give it its identity

Add to `~/smartprint-agent/.env`:

```bash
KIOSK_ID=pi-a-vit
```

The agent now refuses to start without this, so the code update and this line
have to land together or PM2 will just keep restarting a dead process.

### 2.5 Point the browser at its kiosk URL

```bash
sudo TARGET_SSID="AB3SCOPE172 0783" KIOSK_ID=pi-a-vit bash setup-wifi-and-kiosk-startup.sh
```

### 2.6 Reboot

Editing an autostart file does nothing to the Chromium already running. It has
to reload before `?kiosk=` means anything.

### 2.7 Verify A before going further

```bash
pm2 logs smartprint-agent --lines 40
```

Look for `Kiosk: pi-a-vit` in the startup banner. Then **take a real print at
kiosk A and watch it come out.** Do not move on until it does.

---

## 3. Kiosk B (the new Pi)

### 3.1 Install with its identity

```bash
sudo KIOSK_ID=pi-b-vit bash install-pi-agent.sh
```

### 3.2 Fill in `.env` — four values, not the whole file

Copy **only** these from kiosk A, byte-identical:

`MONGODB_URI`, `MASTER_KEY`, `APP_SECRET`, `PUBLIC_BASE_URL`

> **Do not copy A's whole `.env` across.** It carries `KIOSK_ID=pi-a-vit`, and
> two agents answering to one id both treat every job at that kiosk as theirs —
> papers then come out at whichever printer won the race, confidential ones
> included. This is the single easiest way to break the rollout, and the
> symptom looks like nothing at all until a document appears in the wrong room.
>
> The agent watches for it: if two hosts register the same id you get a
> `KIOSK ID CONFLICT` banner in `pm2 logs` on both, repeating every five
> minutes. That is a backstop, not permission to skip the check.

A `MASTER_KEY` that differs by one character means confidential jobs download
as ciphertext and never print.

### 3.3 Printer — Canon imageFORCE 6170

**Connect it over the network, not USB.** This is a networked office MFP and it
speaks IPP Everywhere / AirPrint / Mopria natively, which is the one path that
needs no vendor driver at all. `setup-printer.sh` already tries `-m everywhere`
first, so a network URI gets you a working queue with nothing to install.

Get its IP from the printer's own control panel, check the Pi can see it, then:

```bash
sudo bash setup-printer.sh <printer-ip>
```

**Trays.** The agent never names a tray — it asks for `media=a4` or `media=a3`
and lets the printer choose. That works only if the printer's own paper
settings agree with the labels on the front (tray 1 → A4, tray 2 → A3). If
tray 2 is left on "Auto" or the wrong size, A3 booklets either fail outright or
come out on A4. Set the tray sizes on the printer's panel and confirm before
calling the install done.

**If driverless somehow fails**, Canon does publish a Linux UFR II driver — but
only for 64-bit ARM, not 32-bit. Check what the Pi is running first:

```bash
uname -m
```

`aarch64` → the Debian **arm64** UFR II package is a viable fallback.
`armv7l` → there is no Canon driver for this Pi at all; driverless is the only
option, and re-imaging with 64-bit Raspberry Pi OS is the fix.

Do not spend time hunting for a driver before trying driverless. On this
printer it is the supported route, not a workaround.

### 3.3b Network, remote access, clock

```bash
sudo TARGET_SSID="<kiosk B's network>" KIOSK_ID=pi-b-vit bash setup-wifi-and-kiosk-startup.sh
```

```bash
sudo tailscale up --ssh --hostname=pi-b-vit
```

Then `sudo timedatectl set-ntp true`, disable key expiry for `pi-b-vit` in the
Tailscale admin console, and reboot.

### 3.4 Verify B

`pm2 logs smartprint-agent` shows `Kiosk: pi-b-vit`, and no `KIOSK ID
CONFLICT`. Take a real print at kiosk B.

---

## 4. The test that actually matters

Everything above can pass with the routing still wrong. This is the check that
proves it is not:

1. Release a job at **kiosk A** → it must print at **A**, and **nothing** at B.
2. Release a job at **kiosk B** → it must print at **B**, and **nothing** at A.
3. Two people release different codes at both kiosks at the same moment → each
   comes out at the kiosk it was entered at.

If a job prints at the wrong kiosk, stop and check for `KIOSK ID CONFLICT` in
both agents' logs first.

---

## When something goes quiet

**A job sits at `printing` and never prints.** The release carried no kiosk id
— a browser still on a URL without `?kiosk=`, usually because the Pi was not
rebooted after the URL changed.

```bash
pm2 logs smartprint-agent --lines 100
```

- `released with NO kiosk id` — that release, as it happened.
- `stuck at 'printing' with no kiosk id` — the five-minute sweep counting them.

Fix the URL, reboot the Pi. Existing stuck jobs need re-releasing; they are not
deleted automatically any more, deliberately, so they stay visible.

**Staff see "This kiosk is not set up correctly."** That kiosk's `?kiosk=`
value is not in the backend's `ALLOWED_KIOSK_IDS`. All three places must match.

**Staff see "This job has already been released."** Working as intended —
someone released it at the other kiosk. It is printing there.

**Releases fail for no obvious reason when it gets busy.** `statusLimiter` is
30 requests per 15 minutes **per IP**. If both Pis sit behind the same campus
NAT they share that budget — roughly 15 jobs per 15 minutes across both
kiosks, then 429s. Raising it is a judgement call about your peak volume;
it lives near the top of `student web app/server/routes.ts`.

---

## Rolling back

The change is backward compatible in one direction only, and it is the useful
one: a release with no `kioskId` behaves exactly as it did before. So to put a
kiosk back the way it was, remove `?kiosk=` from its URL **and** downgrade its
agent to the pre-`KIOSK_ID` version. Doing only the first leaves you with the
silent-stuck-job state above, because the new agent claims nothing without a
matching id.

The backend and hosting deploys are safe to leave in place either way.
