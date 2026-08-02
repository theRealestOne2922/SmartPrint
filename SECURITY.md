# Security

How SmartPrint protects confidential exam papers, what each control is for, and
the things you must not undo without understanding why they are there.

Written for whoever picks this up next — a collaborator, or a reviewer asking
"where is the control for X".

---

## The threat this is built around

A member of staff uploads a question paper and prints it at a kiosk in a public
area. The realistic attacker is a student who is technically capable, physically
present, and can see the print code on a screen. They may also read the source,
because the repository is public.

So the design assumes the print code will leak, and makes the code alone
insufficient for anything that matters.

---

## Identity

**Staff accounts need an administrator to approve them.** Registration is
self-service; being able to sign in is not. Anyone can request an account, and
until an admin approves it in the dashboard, sign-in is refused.

**Registration reveals nothing.** A duplicate address or Employee ID gets exactly
the same answer as a new one, and spends the same time producing it. This matters
more than it looks: an Employee ID is what releases a confidential paper at the
kiosk, so a form that confirms valid IDs would undermine the control it sits
behind.

**Sign-in reveals nothing either.** An unknown address and a wrong password
return the same status and the same message, and an unknown address still pays
for a bcrypt comparison so the timing matches.

**Identity comes from the session, never from the request.** The server reads the
faculty ID and name from the signed-in account. Anything a client sends in those
fields is discarded. Sending someone else's Employee ID achieves nothing.

**A signed token is not proof the account is still good.** Every request
re-reads the account. Revoking an account in the dashboard, resetting a password,
or deleting an account ends the sessions already open, rather than leaving them
valid for the next twelve hours.

---

## Confidential jobs

**The document is encrypted at rest** with a per-file random key, itself wrapped
by `MASTER_KEY`, which only the server and the Pi hold. The database on its own
does not open anything. Encryption is mandatory and fails closed — a confidential
job is never created unencrypted.

**Ciphertext is written to its own file.** Uploads are content-addressed, so two
people uploading the same document share one file on disk. Encrypting in place
therefore reached across jobs. The plaintext is removed once nothing references
it.

**The file name is withheld** until the faculty check passes. A print code read
over someone's shoulder should not reveal which paper is about to be printed.

**Printing needs the Faculty ID**, and passing that check issues a short-lived
release token bound to that one job. Editing or deleting a confidential job needs
the same token — the code alone is not enough to reconfigure or destroy a paper.

**Guessing the Faculty ID is bounded per job**, not per address, so extra
addresses buy an attacker nothing. Ten wrong IDs lock the job.

> That bound has a second edge: anyone who saw the print code can strand a paper
> for the day by being wrong ten times. An administrator can clear it from the
> dashboard — the **Unlock** control on a locked job. Do not remove the bound to
> avoid the lockout; the unlock is the answer.

**The release conditions are tamper-evident.** The print code, faculty ID,
confidential flag, file name and file path are signed with `APP_SECRET` when the
job is created, and checked before the name is revealed and before anything
reaches the printer. Editing those fields directly in the database — setting
`teacherEmpId` to a value you know, flipping `confidential` off, repointing
`filePath` — stops the job verifying. A missing signature fails closed.

---

## Documents

**Downloads need a signature** bound to that one file name. The stored name is a
SHA-256 of the contents, which is unguessable, but an unguessable URL is not
access control.

**File type is decided from the bytes**, not from the extension or the
`Content-Type`, both of which the caller controls. `%PDF-`, a ZIP header for the
modern Office and OpenDocument formats, OLE2 for the legacy ones, the usual image
signatures; plain text must contain no NUL byte and be valid UTF-8.

**The Pi only fetches our own URLs.** It prints whatever `filePath` points at, so
that path is checked against `PUBLIC_BASE_URL` at creation.

---

## Rate limits

The recurring lesson in this codebase: **limit the resource, not the caller.**

Campus wifi puts every member of staff behind one address, so a per-address limit
throttles a department because one person is busy — and it barely inconveniences
an attacker, who simply uses more addresses. These are keyed to the thing worth
protecting:

| Bound | Keyed to |
|---|---|
| Faculty ID attempts | the job |
| Password reset guesses | the code (5, then destroyed) |
| Reset code issuance | the account (1/min) |
| Failed sign-ins | the account (20 in 15 min → 15 min freeze) |
| Confidential edits | the release token |

Address-keyed limits still exist as a coarse outer layer. `req.ip` is the real
address — verified, not assumed: nginx appends to `X-Forwarded-For` and Express
runs `trust proxy: 1`, and headers cannot change it.

---

## Logging

**No successful response body is logged.** Method, path, status and duration on
every request; on a failure, the explanatory message and nothing else.

This was previously a deny list over response bodies and it failed the way deny
lists do — it covered what someone thought of. What accumulated in a
world-readable file was 16 faculty IDs, 16 staff addresses, 111 print codes and
68 document names. A faculty ID and a print code together release a paper.

Do not reintroduce body logging. If you need to debug a payload, do it locally.

Audit rows are kept 90 days by a TTL index. They are written on paths an outsider
can drive, so without expiry they are a slow way to fill the storage quota and
stop every write in the application.

---

## Deployment

- The API binds **loopback only**; nginx fronts it. The firewall allows 22, 80
  and 443 and nothing else.
- CSP is served by Firebase Hosting: `script-src 'self'`, no `unsafe-inline`, no
  `unsafe-eval`, `connect-src` naming the API explicitly, `frame-ancestors 'none'`.
- `ADMIN_IP_ALLOWLIST` restricts the admin pages by address. Unset means any
  address, and the server warns about it at boot.
- The retention sweep does not run outside production. Its delete is
  database-wide, so a developer pointed at a shared cluster would otherwise wipe
  live jobs seconds after starting a dev server.
- `MASTER_KEY` must be byte-identical on the server and the Pi, or confidential
  jobs will not decrypt. `APP_SECRET` must match between the web app and the
  kiosk server.

---

## If you change something here

Two things are easy to break without noticing:

**Do not log response bodies.** See above.

**Do not add fields to the integrity signature that legitimately change.** It
covers only what is fixed for the life of a job. The kiosk still adjusts copies,
colour, duplex, orientation and paper size, and those are deliberately outside
it — putting them in would make ordinary edits look like tampering.

---

## Known and outstanding

**The production MongoDB credential was committed to this public repository**
inside `env-files-backup.zip`, and git history keeps a deleted file. Until the
Atlas password is rotated and the Network Access list is narrowed, anyone who
clones this repo can connect to the database directly.

The tamper-evidence above limits what that gets them — they cannot forge a job
that prints, because `APP_SECRET` was never in that archive — but they can still
read and destroy data. **Rotate the password and restrict Network Access.**

---

## Working on the right Pi

There is more than one SmartPrint deployment. Over SSH the Pis are
indistinguishable — same OS, same paths, same agent, and a Tailscale name is a
label anyone can change. Connecting to the wrong one and "fixing" it is a
straightforward way to break a system that was working.

**Before running anything on a Pi, identify it:**

```
cd ~/smartprint-agent && node whichdeployment.mjs --expect vit
```

Exit 0 and `CONFIRMED` means proceed. Anything else means stop and change
nothing — including `REFUSE`, a missing `.env`, and "UNKNOWN".

It keys off the hash of `MASTER_KEY`, which is the one property that cannot be
faked or accidentally shared: it is what decrypts confidential documents, so
every machine in a deployment has it and no machine outside can. Cluster host,
`PUBLIC_BASE_URL` and `APP_SECRET` are checked too, but only as warnings — those
can legitimately be half-configured mid-setup.

Hashes are printed, never secrets, so the output is safe to paste into a chat or
an issue.

VIT Chennai's fingerprint:

| | |
|---|---|
| `MASTER_KEY` hash | `21bab032b8acabbf` |
| `APP_SECRET` hash | `de60283ea11228f2` |
| mongo cluster | `cluster0.fzbkawi.mongodb.net` |
| `PUBLIC_BASE_URL` | `https://140.245.224.137.nip.io` |

Publishing these is safe: they are truncated SHA-256 digests of 256-bit secrets,
so they confirm a match without being reversible.
