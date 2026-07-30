# Raspberry Pi — Remote Access (Tailscale) and Agent Updates

The print agent runs on a Raspberry Pi wired to the printer, usually sitting on
the campus network behind NAT. This covers two things:

1. Setting up **Tailscale** once, so the Pi can be reached from anywhere.
2. Updating the agent afterwards, from anywhere.

> **Part 1 must be done with access to the Pi** — on campus over SSH, or with a
> keyboard and monitor attached. You cannot set up remote access remotely.

Do not port-forward SSH from the campus router instead. That exposes the Pi to
the public internet; Tailscale gives you a private link with no open ports.

---

## Part 1 — One-time: Tailscale on the Pi

### 1.1 Make sure SSH is enabled

```bash
sudo systemctl enable --now ssh
```

### 1.2 Install Tailscale

Official install script:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

If you would rather not pipe a script to a shell, that script only adds
Tailscale's apt repository — you can add it manually per Tailscale's docs and
then `sudo apt install tailscale`.

### 1.3 Connect it to your network

```bash
sudo tailscale up --ssh
```

This prints a URL. Open it in any browser and sign in (Google/GitHub/Microsoft).
Use **the same account** you will use on your laptop.

`--ssh` lets Tailscale handle SSH auth, so you don't have to manage keys.

### 1.4 Note the Pi's Tailscale address

```bash
tailscale ip -4
```

You get something like `100.x.y.z`. That address works from anywhere, forever,
regardless of which network the Pi is on.

### 1.5 Turn off key expiry — important

By default a device's key expires after ~180 days and you silently lose remote
access. For an unattended kiosk that always happens at the worst moment.

In the [Tailscale admin console](https://login.tailscale.com/admin/machines),
find the Pi → **⋯** menu → **Disable key expiry**.

### 1.6 Install Tailscale on your laptop

Download the Windows client from [tailscale.com/download](https://tailscale.com/download),
install, and sign in with the same account.

### 1.7 Verify from home

From PowerShell:

```powershell
ssh pi@100.x.y.z
```

Replace `pi` with the Pi's actual username if different. If you get a shell,
remote access is done.

---

## Part 2 — Updating the print agent

### 2.1 Find out how the agent is installed

Two layouts exist depending on how it was originally set up:

```bash
pm2 list; ls -d ~/smartprint-agent ~/smartprintvit/pi-print-agent 2>/dev/null
```

- `~/smartprintvit/pi-print-agent` — a git clone. Follow **2.3a**.
- `~/smartprint-agent` — written by `install-pi-agent.sh`, not a git repo.
  Follow **2.3b**.

Note the PM2 process name from `pm2 list` (`print-agent` or `smartprint-agent`);
you need it to restart.

### 2.2 Check MASTER_KEY — do this before anything else

Envelope encryption for confidential documents means the Pi needs a
`MASTER_KEY` that older installs never had. Without it, confidential jobs
download as ciphertext and never print.

```bash
grep -c '^MASTER_KEY=.\+' <install-dir>/.env
```

If that prints `0`, add the line. The value must be **byte-identical** to the
backend's `MASTER_KEY` (in `student web app/.env`) — if it differs by one
character, decryption fails closed.

```bash
nano <install-dir>/.env
```

### 2.3a Update — git clone layout

```bash
cd ~/smartprintvit/pi-print-agent && git pull origin main && npm install
```

### 2.3b Update — installer layout

Not a git repo, so fetch the changed files directly:

```bash
cd ~/smartprint-agent
curl -fsSL -O https://raw.githubusercontent.com/theRealestOne2922/SmartPrint/main/pi-print-agent/index.js
curl -fsSL -O https://raw.githubusercontent.com/theRealestOne2922/SmartPrint/main/pi-print-agent/package.json
mkdir -p models
curl -fsSL -o models/PrintJob.js https://raw.githubusercontent.com/theRealestOne2922/SmartPrint/main/pi-print-agent/models/PrintJob.js
npm install
```

Re-running `sudo bash install-pi-agent.sh` also works and will not overwrite an
existing `.env`, but it reinstalls Node, CUPS, LibreOffice and fonts, so it is
much slower. Use it only if the Pi is in a bad state.

### 2.4 Restart

```bash
pm2 restart <process-name> && pm2 save
```

---

## Part 3 — Verify

```bash
pm2 logs --lines 40
```

Expect the MongoDB connection and Change Stream listener to come up.

**This line means confidential printing is broken**, even though the agent
otherwise looks healthy:

```
⚠️  MASTER_KEY missing/invalid in .env — confidential jobs will fail to print!
```

Logs alone are not proof. Send one real **confidential** job end-to-end and
confirm paper comes out. That is the only thing that proves the Pi's
`MASTER_KEY` matches the backend's.

---

## Ordering when updating both backend and Pi

Deploy the backend first, or at least make sure both sides carry the same
`MASTER_KEY`. If the backend encrypts with a key the Pi lacks, jobs are created
normally and then fail silently at the printer — everything looks fine right up
until the page doesn't come out.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ssh: connect to host ... timed out` | Tailscale not running on the Pi. Needs local access: `sudo tailscale status` |
| Worked for months, now refuses | Device key expired — see 1.5 |
| Agent restarts in a loop | `MONGODB_URI` missing or wrong in `.env`; check `pm2 logs` |
| Normal jobs print, confidential ones never do | `MASTER_KEY` missing or does not match the backend |
| `pm2: command not found` after reboot | `pm2 startup` was never run; re-run it and `pm2 save` |
