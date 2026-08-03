// API Routes — MongoDB Edition
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import multer from "multer";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import rateLimit from "express-rate-limit";
import express from "express";
import { PrintJob } from "./models/PrintJob";
import { Admin } from "./models/Admin";
import { Teacher } from "./models/Teacher";
import { SystemSetting } from "./models/SystemSetting";
import { cleanupExpiredJobs } from "./cleanup";
import { broadcastJobUpdate } from "./websocket";
import { sendOtpEmail } from "./emailService";
import { AuditLog } from "./models/AuditLog";
import {
  signReleaseToken,
  verifyReleaseToken,
  signJobSession,
  verifyJobSession,
  signAdminToken,
  requireAdmin,
  restrictAdminIp,
  signTeacherToken,
  requireTeacher,
  type AuthedRequest,
  encryptFileEnvelope,
  hashPassword,
  verifyPassword,
  sanitizeJob,
  signFileToken,
  verifyFileToken,
  signJobIntegrity,
  verifyJobIntegrity,
} from "./security";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
// Ensure uploads dir exists
fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(console.error);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Uploads were capped at 500 an hour "for testing", with a comment claiming 5.
// At 20MB a file that is 10GB an hour from a single address.
//
// The cap cannot simply be dropped to something small: campus wifi puts every
// member of staff behind one public address, so a tight per-IP limit throttles
// a department because one person is busy. 200 an hour is loose enough for a
// real exam-week rush and still bounds one address to a few GB, and the storage
// ceiling below is what actually protects the disk.
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 200,
  message: { message: "Too many uploads from this network. Wait a few minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Creating a job had no limit at all — a script could add rows for as long as it
// liked. Generous, because a batch upload legitimately creates one job per file.
const jobCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { message: "Too many print jobs from this network. Wait a few minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Keyed on the job, not the caller's address.
//
// Keyed on the address, this throttled the wrong thing. The kiosk sits behind
// campus NAT with everyone else, so six wrong guesses from one student blocked
// faculty verification for every member of staff on that network — measured,
// not assumed: after the limit tripped, the *correct* faculty ID also came back
// 429. Meanwhile an attacker with several addresses just got six guesses each,
// so it barely slowed the attack it was meant to stop.
//
// Per job, both of those invert. Someone attacking one print code can only ever
// affect that print code, and no number of addresses buys extra attempts.
// Named so the dashboard can work out whether this bound is currently blocking
// a job. Two things can lock a job — this short window and the 24-hour count
// below it — and an admin looking at the list needs to see either.
const VERIFY_BURST_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_BURST_MAX = 6;

const verifyFacultyLimiter = rateLimit({
  windowMs: VERIFY_BURST_WINDOW_MS,
  max: VERIFY_BURST_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `verify:${req.params.printId}`,
  message: { message: "Too many verification attempts for this job. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// A print code is six digits, so lookups are worth brute forcing if nothing
// stops them. This counts FAILED attempts only: a code that exists returns 2xx
// and never touches the budget, so the kiosk polling a real code every 1.5s,
// and a whole campus behind one NAT address, are unaffected — the only traffic
// it can throttle is guessing. Counting every request instead would cut the
// kiosk off mid-print.
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  message: { message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// A server-wide bucket on failed lookups was tried here and removed. It does
// bound a distributed sweep of the code space — but one bucket for everyone is
// a switch any stranger can flip: burn the shared budget with junk codes and
// the kiosk stops resolving real ones for everybody. For a system whose worst
// day is an exam morning, handing out a trivial outage to prevent a slow,
// partial attack is the wrong trade.
//
// What guessing a code actually yields is also limited now: responses no longer
// carry the download URL, and releasing a confidential job still needs the
// faculty ID, which is bounded per job below. The residual risk is deletion or
// printing of a non-confidential job, against per-address limits and a 24 hour
// retention window that keeps the target set small.

// A confidential job's file name says which paper is about to be printed, and
// a print code is easy to read off someone's screen. The name is withheld until
// the faculty ID has been verified, exactly like the ability to change or print
// the job. Everything else about the job stays visible so the kiosk can show
// page counts and settings.
function redactConfidential(job: any, req: Request): any {
  if (!job?.confidential) return job;
  if (verifyReleaseToken(String(job.jobId), req.headers["x-release-token"])) return job;
  return { ...job, fileName: "Confidential document" };
}

// Knowing a print code is enough to look a job up, and that is by design — it
// is what someone standing at the kiosk types. But it also means a code read
// over a colleague's shoulder, or off a screen while they collect their pages,
// was enough to change or destroy their job from anywhere: set a question paper
// to 500 copies, switch it to colour, or delete it outright.
//
// For a confidential job the code is not sufficient. Changing or deleting one
// requires the same proof as printing it: a release token, which is only issued
// after the faculty ID is verified. The kiosk already demands that on load for
// confidential jobs, so it holds the token before any of these controls are
// reachable — it simply was not sending it.
async function confidentialGuardFailed(
  jobId: string,
  req: Request,
  res: Response
): Promise<boolean> {
  const isConfidential = await PrintJob.exists({ jobId, confidential: true });
  if (!isConfidential) return false;

  const token = req.headers["x-release-token"];
  if (!verifyReleaseToken(jobId, token)) {
    await AuditLog.create({
      event: "confidential_tamper",
      printId: jobId,
      ip: req.ip,
      success: false,
      detail: `${req.method} ${req.path} without a release token`,
    }).catch(() => {});
    res.status(403).json({ message: "Verify the Faculty ID before changing this job." });
    return true;
  }
  return false;
}

// Failed sign-ins, counted against the account rather than the caller.
//
// The limiter on the login routes counts per address, so every address an
// attacker uses buys another ten attempts — the same weakness that made the
// faculty ID and reset code limits ineffective. A password is the thing being
// guessed here, so the budget has to belong to the account.
//
// Deliberately not a permanent lock: that would let anyone disable a colleague's
// account by failing on purpose, which on an exam morning is its own attack.
// Twenty failures inside fifteen minutes freezes sign-in for fifteen minutes,
// then it clears itself. Slow enough to make guessing pointless, short enough
// that nobody is meaningfully denied their own account.
const LOGIN_MAX_FAILURES = 20;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

function accountLocked(account: { lockedUntil?: Date | null }): boolean {
  return !!account.lockedUntil && account.lockedUntil.getTime() > Date.now();
}

async function recordLoginFailure(
  model: typeof Teacher | typeof Admin,
  account: { _id: any; failedLoginCount?: number; lastFailedLoginAt?: Date | null },
) {
  const now = Date.now();
  const withinWindow =
    account.lastFailedLoginAt && now - account.lastFailedLoginAt.getTime() < LOGIN_WINDOW_MS;
  const count = (withinWindow ? account.failedLoginCount ?? 0 : 0) + 1;

  if (count >= LOGIN_MAX_FAILURES) {
    await (model as any).updateOne(
      { _id: account._id },
      { $set: { failedLoginCount: 0, lastFailedLoginAt: new Date(), lockedUntil: new Date(now + LOGIN_LOCK_MS) } },
    );
  } else {
    await (model as any).updateOne(
      { _id: account._id },
      { $set: { failedLoginCount: count, lastFailedLoginAt: new Date() } },
    );
  }
}

async function clearLoginFailures(model: typeof Teacher | typeof Admin, id: any) {
  await (model as any).updateOne(
    { _id: id },
    { $set: { failedLoginCount: 0, lockedUntil: null } },
  );
}

// A reset code is six digits and lives for fifteen minutes. The limiter on
// these routes counts per address, which is no obstacle to someone using more
// than one — every fresh address bought another ten guesses at a code with only
// a million possibilities, and a teacher account is worth taking: it is what
// creates confidential jobs.
//
// So the code itself carries the budget. Five wrong guesses and it is destroyed
// outright, wherever the guesses came from, and the owner has to request a new
// one. Nobody can be locked out by this — the real teacher can always ask for
// another code — and it cuts an attacker to five tries per email they send.
const OTP_MAX_ATTEMPTS = 5;
const OTP_TTL_MS = 15 * 60 * 1000;
// How soon a replacement code may be issued for the same account. Without this,
// the five-guess budget resets on demand and bounds nothing.
const OTP_REISSUE_MIN_INTERVAL_MS = 60 * 1000;

// Six digits is a small space, so a plain digest would be trivially reversible
// by trying all million. Keying the HMAC with APP_SECRET means a database on its
// own is not enough to work backwards from.
function hashOtp(otp: string): string {
  return crypto.createHmac("sha256", process.env.APP_SECRET || "").update(`otp.${otp}`).digest("hex");
}

async function consumeOtp(email: string, otp: string) {
  const teacher = await Teacher.findOne({ email });
  if (!teacher?.resetPasswordOtp || !teacher.resetPasswordExpires) return null;
  if (teacher.resetPasswordExpires.getTime() < Date.now()) return null;

  const supplied = Buffer.from(hashOtp(otp), "hex");
  const actual = Buffer.from(String(teacher.resetPasswordOtp), "hex");
  const matches =
    supplied.length > 0 &&
    supplied.length === actual.length &&
    crypto.timingSafeEqual(supplied, actual);

  if (matches) return teacher;

  const attempts = (teacher.resetPasswordAttempts ?? 0) + 1;
  if (attempts >= OTP_MAX_ATTEMPTS) {
    await Teacher.updateOne(
      { _id: teacher._id },
      { $unset: { resetPasswordOtp: 1, resetPasswordExpires: 1 }, $set: { resetPasswordAttempts: 0 } }
    );
    await AuditLog.create({
      event: "otp_exhausted",
      printId: null,
      ip: null,
      success: false,
      detail: "reset code destroyed after too many wrong guesses",
    }).catch(() => {});
  } else {
    await Teacher.updateOne({ _id: teacher._id }, { $set: { resetPasswordAttempts: attempts } });
  }
  return null;
}

// Bounds guessing against a single job regardless of how many addresses are
// used. See the comment at the verification route.
//
// This cuts both ways and the second edge is worth stating plainly: someone who
// reads a print code off a screen can spend ten wrong faculty IDs and put that
// job beyond use for the rest of the day — the legitimate owner included. That
// is a cheap denial of service aimed at one exam paper on the morning it is
// needed, which is precisely when it hurts.
//
// Keeping the bound and giving an administrator a way to clear it is better
// than loosening it: brute force stays bounded, and a job locked out of malice
// is a one-click fix at the print desk rather than a lost morning. See
// POST /api/admin/jobs/:printId/unlock.
const FACULTY_ATTEMPT_LIMIT = 10;
const FACULTY_LOCKOUT_WINDOW_MS = 24 * 60 * 60 * 1000;

const statusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: "Too many status updates. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Credential endpoints. Failures only, so a user fat-fingering their password
// isn't locked out by their own successful logins, but guessing is throttled.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { message: "Too many attempts. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Each new account guarantees one OTP email, and authLimiter's
// skipSuccessfulRequests means a 201 is invisible to it — nothing bounded how
// many distinct accounts, and therefore how many emails, one address could
// trigger. The free-tier send quota is not the only reason that matters: an
// address that does not exist still counts against the quota, so this is also
// the thing standing between one script and every real signup for the day
// getting refused because the quota is gone. Counts every attempt, successes
// included. Six an hour is generous for someone onboarding a department and
// tight enough to bound abuse.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  message: { message: "Too many accounts created from this network. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// The same gap as registerLimiter, found by re-checking this route with that
// bug in mind. Every branch of forgot-password answers 200 — that is what
// stops it revealing which addresses have accounts — so skipSuccessfulRequests
// makes it invisible to authLimiter for every real call. The per-account
// one-minute reissue throttle only bounds repeats against the SAME address; it
// does nothing to stop one caller working through a list of many different
// real addresses, each good for one guaranteed send. Counts every attempt.
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { message: "Too many requests from this network. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Issuing a print code is cheap but must not become an oracle for probing
// which codes exist, so every request counts here.
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

async function getPdfPageCount(buffer: Buffer): Promise<number> {
  try {
    const pdfModule: any = await import("pdf-parse");
    const pdfParse = pdfModule.default || pdfModule;
    const data = await pdfParse(buffer);
    return data.numpages || 1;
  } catch (err) {
    console.error("Failed to parse PDF:", err);
    return 1; // fallback
  }
}

function generatePrintId(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

// Allowed file types for upload validation — defined once at module scope
const ALLOWED_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.odt', '.ods', '.odp', '.txt',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
];
// Magic numbers, checked against the bytes actually uploaded. Grouped by the
// container format rather than by extension: every modern Office and
// OpenDocument file is a ZIP, and every legacy one is an OLE2 compound file, so
// the useful question is "is this really a zip" and not "is this really a pptx".
// Telling pptx from xlsx is the converter's job; keeping a shell script from
// reaching the converter at all is this function's.
const CONTENT_SIGNATURES: Array<{ exts: string[]; matches: (b: Buffer) => boolean }> = [
  { exts: ['.pdf'], matches: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  // ZIP local file header — docx/pptx/xlsx/odt/ods/odp.
  {
    exts: ['.docx', '.pptx', '.xlsx', '.odt', '.ods', '.odp'],
    matches: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  },
  // OLE2 compound document — the pre-2007 .doc/.ppt/.xls.
  {
    exts: ['.doc', '.ppt', '.xls'],
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  },
  { exts: ['.jpg', '.jpeg'], matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    exts: ['.png'],
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { exts: ['.gif'], matches: (b) => /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')) },
  {
    exts: ['.webp'],
    matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { exts: ['.bmp'], matches: (b) => b[0] === 0x42 && b[1] === 0x4d },
  // Plain text has no signature, so the test is the absence of anything that
  // could not be text: a NUL byte, or bytes that are not valid UTF-8.
  {
    exts: ['.txt'],
    matches: (b) => {
      if (b.includes(0)) return false;
      const head = b.subarray(0, 4096);
      return Buffer.compare(Buffer.from(head.toString('utf8'), 'utf8'), head) === 0;
    },
  },
];

function contentMatchesExtension(buffer: Buffer, ext: string): boolean {
  // A legacy .doc that Word actually saved as modern XML, and vice versa, are
  // both real things people have on disk — so any signature whose group covers
  // this extension is enough, and an office extension is allowed to be either
  // container. What cannot pass is bytes matching no known document format.
  const officeExts = ['.doc', '.ppt', '.xls', '.docx', '.pptx', '.xlsx', '.odt', '.ods', '.odp'];
  const acceptable = officeExts.includes(ext) ? officeExts : [ext];
  return CONTENT_SIGNATURES.some(
    (sig) => sig.exts.some((e) => acceptable.includes(e)) && sig.matches(buffer),
  );
}


// MongoDB treats an object value as a query operator, so a JSON body of
// {"otp": {"$ne": null}} becomes "any OTP that is not null" and matches without
// knowing the code. Every user-supplied value that reaches a query has to be a
// plain string; anything else is rejected rather than coerced, because a caller
// sending an object here is not making a typo.
// One policy, applied everywhere a password is set. Ten characters and not one
// of the handful everybody reaches for first; no character-class rules, because
// they push people towards Passw0rd! and a passphrase beats it comfortably.
const MIN_PASSWORD_LENGTH = 10;
// The admin account sees every job in the system and can revoke any member of
// staff, so it carries a longer minimum than a teacher account does.
const MIN_ADMIN_PASSWORD_LENGTH = 12;
const BANNED_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyuiop", "admin123", "adminadmin", "letmein123", "smartprint",
  "smartprint1", "smartprint123", "vitchennai", "vit123456", "iloveyou",
]);

function passwordTooWeak(password: string, minLength = MIN_PASSWORD_LENGTH): string | null {
  if (password.length < minLength) {
    return `Password must be at least ${minLength} characters.`;
  }
  if (BANNED_PASSWORDS.has(password.toLowerCase())) {
    return "That password is too easy to guess. Please choose another.";
  }
  return null;
}

// Addresses are case-insensitive in practice, and treating them otherwise cuts
// both ways: a teacher who signs up as Bob@vit.ac.in and later types
// bob@vit.ac.in is told their credentials are invalid, and the unique index
// happily stores both as separate accounts. Normalise once, on the way in.
function normalizeEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : null;
  if (!email) return null;
  // Deliberately loose. Anything stricter starts rejecting real addresses, and
  // the account is useless until an administrator approves it anyway.
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

// Who may request a new staff account.
//
// Applied at registration only, never at sign-in. The accounts that predate
// this rule are on other domains and are in daily use; enforcing it at sign-in
// would lock every one of them out.
//
// Subdomains count, so chennai.vit.ac.in works. Matched on the domain after the
// last "@" — "vit.ac.in@evil.com" is not a VIT address, and a naive endsWith
// on the whole string would accept it.
const ALLOWED_SIGNUP_DOMAINS = (process.env.ALLOWED_SIGNUP_DOMAINS || "vit.ac.in")
  .split(",")
  .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

function signupDomainAllowed(email: string): boolean {
  if (ALLOWED_SIGNUP_DOMAINS.length === 0) return true;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return ALLOWED_SIGNUP_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

// A short, explicit list of accounts outside ALLOWED_SIGNUP_DOMAINS that are
// allowed to exist at all — the two admin accounts, added by hand rather than
// through registration (which the domain check already refuses them). Password
// reset needs the same exception, or the two admins would be the one thing
// this system cannot recover on its own: locked out with no self-serve path,
// needing a database edit every time, forever.
//
// This does not widen who can create an account or sign in — both of those
// gates are untouched. It only decides who may request a reset code by email.
const RESET_DOMAIN_EXCEPTIONS = new Set(
  (process.env.RESET_DOMAIN_EXCEPTIONS || "agilan.a2005@gmail.com,kishoregokul808@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

function passwordResetAllowedFor(email: string): boolean {
  return signupDomainAllowed(email) || RESET_DOMAIN_EXCEPTIONS.has(email);
}

// The only two settings the app understands, and both are small integers with
// a sane range. Anything else is rejected on write and withheld on read.
// Previously any key and any value was upserted, so a typo of 0 in the
// retention box set the cleanup cutoff to "now" and deleted every job on the
// next sweep — an accident an admin could not undo.
const ALLOWED_SETTINGS: Record<string, { min: number; max: number }> = {
  jobExpirationHours: { min: 1, max: 8760 }, // 1 hour to a year
  maxFilesLimit: { min: 1, max: 50 },
};

// A single administrator-controlled switch for the confidential/faculty-ID
// system as a whole, pending a decision above the admin's own authority (here,
// the department). Nothing about encryption, the release gate, or the lockout
// is touched by this — they stay fully implemented either way. This only
// decides whether a NEW job is allowed to use them. Existing confidential jobs
// are unaffected by flipping it, in either direction.
//
// Defaults to enabled wherever it is read, so a database that predates this
// setting — including production right now — behaves exactly as it did
// before this shipped, with nothing to configure.
const ALLOWED_BOOLEAN_SETTINGS = new Set(["confidentialPrintingEnabled"]);

async function confidentialPrintingEnabled(): Promise<boolean> {
  const row = await SystemSetting.findOne({ key: "confidentialPrintingEnabled" }).lean();
  return row?.value !== "false";
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// Mongo throws a CastError when a route parameter is not a valid ObjectId, and
// that surfaced as a 500 — an unhandled exception reachable by anyone typing
// nonsense into a URL, which is both a scanner finding and a way to tell a
// malformed id apart from one that simply does not exist.
function isObjectId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value);
}

// Where this server is reachable from, used to build download URLs. Prefer
// configuration; fall back to the request's own protocol and Host, which nginx
// sets from the server block. Never X-Forwarded-Host: nginx does not send it,
// so it is whatever the client typed.
function publicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

// A job's filePath is supplied by the client, and the Pi downloads whatever it
// points at. Unchecked, that let anyone name any URL and have the agent fetch
// it — attacker-controlled content sent to the printer, and a request made from
// the Pi's position inside the campus network. Only this server's own uploads
// are accepted.
function isOwnUploadUrl(candidate: string, req: Request): boolean {
  try {
    const url = new URL(candidate);
    const base = new URL(publicBaseUrl(req));
    if (url.host !== base.host) return false;
    return /^\/uploads\/[a-f0-9]{64}(\.[a-z0-9]{1,8})?$/.test(url.pathname);
  } catch {
    return false;
  }
}

// Rate limits alone cannot protect the disk: they are per address, and a campus
// shares addresses, so any limit loose enough for real staff is loose enough to
// accumulate gigabytes. This is the ceiling that does not care who is uploading
// or how they are spread out — once the uploads directory reaches it, no new
// file is accepted until the cleanup sweep reclaims space.
//
// The VM has 43GB free, so 5GB is a small fraction of the disk while being far
// more than the system ever legitimately holds: files live for 24 hours and the
// whole directory currently sits at single-digit megabytes.
const MAX_UPLOAD_STORAGE_BYTES = Number(
  process.env.MAX_UPLOAD_STORAGE_BYTES || 5 * 1024 * 1024 * 1024
);

let cachedUploadBytes = 0;
let uploadBytesCachedAt = 0;

// Recomputed at most every 30s. Under a flood, stat-ing every file on every
// request would itself become the denial of service.
async function uploadsSizeBytes(force = false): Promise<number> {
  if (!force && Date.now() - uploadBytesCachedAt < 30_000) return cachedUploadBytes;
  let total = 0;
  try {
    for (const name of await fs.readdir(UPLOADS_DIR)) {
      try {
        total += (await fs.stat(path.join(UPLOADS_DIR, name))).size;
      } catch { /* vanished mid-scan; the sweep got it */ }
    }
  } catch { /* directory not created yet */ }
  cachedUploadBytes = total;
  uploadBytesCachedAt = Date.now();
  return total;
}

// A real bcrypt hash of a value nobody knows, compared against when no account
// matches, so a failed login costs the same either way. bcrypt.compare on this
// always fails; the point is the time it takes doing so.
const DUMMY_PASSWORD_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.uHqmR7bH0Kz/9dRUMPtCLfvJKA9wJHu";

// The upload's original filename is stored on the job and later used by the Pi
// agent to build a temp path and a print command. Accents and spaces are fine —
// staff name files in Tamil and Hindi — but path separators, quotes and shell
// metacharacters have no business in a display name and are dropped here so they
// can never reach the Pi. Control characters go too.
function sanitizeFileName(name: string): string {
  const cleaned = (name || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\\/"'`$;|&<>*?]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200);
  return cleaned || "document";
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Serve uploaded files directly
  // Uploaded documents, served only to a caller holding a signature for that
  // exact file. This replaces a bare express.static mount, which handed any
  // file to anyone who named it.
  app.get("/uploads/:filename", (req, res) => {
    const filename = String(req.params.filename);

    // Every stored name is <sha256>.<ext>, written by the upload handler.
    // Refusing anything else keeps traversal sequences away from sendFile
    // rather than relying on it to reject them.
    if (!/^[a-f0-9]{64}(\.[a-z0-9]{1,8})?$/.test(filename)) {
      return res.status(404).json({ message: "Not found." });
    }

    if (!verifyFileToken(filename, req.query.t)) {
      return res.status(403).json({ message: "This download link is not valid or has expired." });
    }

    res.sendFile(path.join(UPLOADS_DIR, filename), (err) => {
      if (err && !res.headersSent) res.status(404).json({ message: "Not found." });
    });
  });

  // FILE UPLOAD — saves to local disk on the VM, not the database
  // Uploading requires a signed-in member of staff.
  //
  // This was open to anyone, which is what made every other control here a
  // matter of damage limitation rather than prevention: a stranger could fill
  // the disk, create jobs, and — because the faculty ID travelled in the request
  // body — mark a job confidential under any identity they liked. SmartPrint at
  // VIT is a staff tool, so it now asks who you are first.
  app.post("/api/upload", requireTeacher, uploadLimiter, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const safeName = sanitizeFileName(req.file.originalname);

      // What kind of file this is, decided from the bytes rather than from what
      // the caller said about them.
      //
      // This used to accept the upload if *either* the extension or the
      // Content-Type looked right. Both are supplied by the caller, so claiming
      // "application/pdf" while sending anything at all got through — a shell
      // script, an ELF binary, a malformed document aimed at a parser. That is
      // not a printer problem: those bytes go on to LibreOffice, whose format
      // parsers are a far larger attack surface than printing a PDF.
      const fileExt = path.extname(safeName).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(fileExt)) {
        return res.status(400).json({
          message: `Unsupported file type "${fileExt}". Supported: PDF, Word, PowerPoint, Excel, Images, and plain text.`,
        });
      }
      if (!contentMatchesExtension(req.file.buffer, fileExt)) {
        return res.status(400).json({
          message: `This file does not look like a ${fileExt} document. Please re-save it and try again.`,
        });
      }

      // Refuse to start filling the disk. Try reclaiming first: most of what
      // accumulates during a flood is orphans — files uploaded without a job
      // ever being created — and the sweep clears those.
      if ((await uploadsSizeBytes()) + req.file.size > MAX_UPLOAD_STORAGE_BYTES) {
        console.warn("[upload] Storage ceiling reached — running cleanup early.");
        await cleanupExpiredJobs();
        if ((await uploadsSizeBytes(true)) + req.file.size > MAX_UPLOAD_STORAGE_BYTES) {
          return res.status(507).json({
            message: "Storage is temporarily full. Please try again in a few minutes.",
          });
        }
      }

      // Hash the file for deduplication. The extension lands in an on-disk name
      // and a public URL, so only an allowed one is carried over — the mimetype
      // branch above can admit a file whose extension is junk.
      const hash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      const ext = ALLOWED_EXTENSIONS.includes(fileExt) ? fileExt : '';
      const filename = `${hash}${ext}`;
      const storagePath = path.join(UPLOADS_DIR, filename);

      // Save to local filesystem
      await fs.writeFile(storagePath, req.file.buffer);
      // Keep the cached total roughly right between recomputes, so a burst
      // inside one 30s window still counts towards the ceiling.
      cachedUploadBytes += req.file.size;

      // The URL the Pi will later fetch. It used to be assembled from
      // X-Forwarded-Host, which nginx does not set and therefore any client
      // could — so an uploader could make the server hand back a filePath
      // pointing at a host they controlled. PUBLIC_BASE_URL is configuration,
      // not a request header.
      const publicUrl = `${publicBaseUrl(req)}/uploads/${filename}?t=${signFileToken(filename)}`;

      let pageCount = 1;
      if (req.file.mimetype === "application/pdf" || safeName.toLowerCase().endsWith(".pdf")) {
        pageCount = await getPdfPageCount(req.file.buffer);
      }

      res.status(200).json({
        filePath: publicUrl,
        fileName: safeName,
        pageCount,
      });
    } catch (err: any) {
      console.error("Upload Error:", err);
      // multer's own messages are worth showing ("File too large"). Anything
      // else is a filesystem or parser error whose text can carry server paths,
      // so it stays in the log.
      const safeMessage = err?.code === "LIMIT_FILE_SIZE"
        ? "That file is larger than the 20MB limit."
        : "Upload failed. Please try again.";
      res.status(400).json({ message: safeMessage });
    }
  });

  // NOTE: there is deliberately no server-side /api/decrypt endpoint.
  // Password-protected PDFs and Office files are decrypted in the browser
  // (see decryptPdfClientSide / decryptOfficeClientSide in print-wizard.tsx),
  // so document passwords never reach the server.

  // PRINT JOBS — MongoDB

  // Check Job ID uniqueness (must come BEFORE the :jobId param route)
  // Issue a fresh print code. Replaces the old check-unique endpoint, which
  // answered "does this code exist?" for any code the caller named — an oracle
  // for finding live jobs that no rate limiter on lookup could compensate for.
  // The server picks the code now, so callers learn nothing about other jobs.
  // One code covers a whole batch, so the client asks once per batch.
  app.post("/api/print-jobs/new-code", requireTeacher, codeLimiter, async (_req, res) => {
    try {
      for (let attempt = 0; attempt < 20; attempt++) {
        const jobId = generatePrintId();
        const clash = await PrintJob.findOne({ jobId }).select("_id").lean();
        if (!clash) {
          return res.json({ jobId });
        }
      }
      res.status(503).json({ message: "Could not allocate a print code. Please try again." });
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  // List all print jobs (Admin Dashboard). Admin-only: this returns every job
  // in the system along with its download URL.
  app.get("/api/print-jobs", requireAdmin, async (req, res) => {
    try {
      const jobs = await PrintJob.find().sort({ createdAt: -1 }).lean();

      // Which confidential jobs are currently locked out by wrong faculty IDs.
      // One grouped count rather than a query per job — and only for the codes
      // on this page, so it stays bounded as the collection grows.
      // Two separate bounds can be refusing a job, and the dashboard has to
      // show either — showing only the 24-hour one meant an admin saw "fine"
      // while the owner was being turned away by the 15-minute one.
      //
      // A blocked request never reaches the handler and so writes no audit row,
      // which makes the rows that DID land the signal: once this job has hit
      // the burst limit inside the burst window, the limiter is turning
      // everything away, this request included.
      const codes = jobs.filter((j) => j.confidential).map((j) => j.jobId);
      const lockedCodes = new Set<string>();
      if (codes.length) {
        const now = Date.now();
        const burstCutoff = new Date(now - VERIFY_BURST_WINDOW_MS);
        const grouped = await AuditLog.aggregate([
          {
            $match: {
              event: "confidential_verify",
              success: false,
              printId: { $in: codes },
              createdAt: { $gt: new Date(now - FACULTY_LOCKOUT_WINDOW_MS) },
            },
          },
          {
            $group: {
              _id: "$printId",
              failures: { $sum: 1 },
              recent: { $sum: { $cond: [{ $gt: ["$createdAt", burstCutoff] }, 1, 0] } },
            },
          },
          {
            $match: {
              $or: [
                { failures: { $gte: FACULTY_ATTEMPT_LIMIT } },
                { recent: { $gte: VERIFY_BURST_MAX } },
              ],
            },
          },
        ]);
        for (const g of grouped) lockedCodes.add(String(g._id));
      }

      // The admin dashboard tracks who printed, how much, and when — never
      // what. fileName was leaking here even for confidential jobs: sanitizeJob
      // strips the download path and encryption fields, but nothing stripped
      // the title itself, so "CAT2-Physics-QP.pdf" was visible to anyone with
      // admin access. That is exactly the fact the confidential flow exists to
      // protect. Dropped unconditionally — not only when confidential — because
      // an ordinary document's name can be just as identifying, and the admin
      // role has no legitimate need to know it either way.
      res.json(jobs.map(j => {
        const clean = sanitizeJob({ ...j, id: j._id, locked: lockedCodes.has(j.jobId) });
        delete (clean as any).fileName;
        return clean;
      }));
    } catch (err: any) {
      console.error("List print jobs error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Create print job
  app.post("/api/print-jobs", requireTeacher, jobCreateLimiter, async (req, res) => {
    try {
      const {
        jobId: providedJobId,
        fileName,
        filePath,
        pageCount,
        colorMode,
        copies,
        duplex,
        orientation,
        paperSize,
        pageRange,
        confidential,
        price: providedPrice,
      } = req.body;

      // Who this job belongs to is taken from the signed token, never from the
      // body. Sent by the client, teacherEmpId was a claim: anyone could mark a
      // job confidential under a colleague's faculty ID — or their own — and the
      // ID is exactly what releases it at the kiosk. Read from the account, it
      // is a fact.
      const teacherEmail = (req as AuthedRequest).teacherEmail!;

      // A batch shares one print code, and the admin sets how many files a
      // batch may hold. That limit was only ever applied in the browser, so it
      // stopped nobody: post the same code repeatedly and the batch grows
      // without bound, and every file in it prints when the code is entered.
      // The setting has to mean something on the server or it does not mean
      // anything at all.
      //
      // Read here, enforced after the insert — see the note further down about
      // why counting first does not survive concurrent posts.
      let maxFilesForBatch: number | null = null;
      if (typeof providedJobId === "string" && /^\d{6}$/.test(providedJobId)) {
        const setting = await SystemSetting.findOne({ key: "maxFilesLimit" }).lean();
        const parsed = parseInt(String(setting?.value ?? ""), 10);
        maxFilesForBatch = Number.isFinite(parsed)
          ? Math.min(Math.max(parsed, ALLOWED_SETTINGS.maxFilesLimit.min), ALLOWED_SETTINGS.maxFilesLimit.max)
          : 5;
      }

      const teacher = await Teacher.findOne({ email: teacherEmail })
        .select("empId name email")
        .lean();
      if (!teacher) {
        return res.status(401).json({ message: "Please sign in again." });
      }
      const teacherEmpId = teacher.empId;
      const studentName = teacher.name;

      // Validate before pricing so the quote and the job agree on the count.
      const copyCount = Math.floor(Number(copies));
      if (!Number.isFinite(copyCount) || copyCount < 1 || copyCount > 500) {
        return res.status(400).json({ message: "Copies must be between 1 and 500." });
      }

      // copies was bounded and the rest of the job was not. pageCount went into
      // the document exactly as sent — negative, absurd, or a string that made
      // Mongoose throw and came back as a 500, which reads to anything scanning
      // the API as an unhandled exception reachable from a form field.
      const pageTotal = Math.floor(Number(pageCount));
      if (!Number.isFinite(pageTotal) || pageTotal < 1 || pageTotal > 2000) {
        return res.status(400).json({ message: "Page count must be between 1 and 2000." });
      }

      // Enums, checked here rather than left to the schema. An object sent where
      // a string belongs reached Mongoose as a cast error and answered 500.
      const mode = asString(colorMode);
      if (mode !== "bw" && mode !== "color") {
        return res.status(400).json({ message: "colorMode must be 'bw' or 'color'." });
      }
      const orient = asString(orientation) ?? "portrait";
      if (orient !== "portrait" && orient !== "landscape") {
        return res.status(400).json({ message: "orientation must be 'portrait' or 'landscape'." });
      }
      const size = asString(paperSize) ?? "a4";
      if (size !== "a4" && size !== "a3") {
        return res.status(400).json({ message: "paperSize must be 'a4' or 'a3'." });
      }
      if (duplex !== undefined && typeof duplex !== "boolean") {
        return res.status(400).json({ message: "duplex must be true or false." });
      }

      // The Pi hands this to lp as a page range. It travels as an argv entry so
      // there is no shell to inject into, but it was stored unchecked, which
      // means anything at all reached the printer's option parser and appeared
      // on the kiosk. Only 'all' or a real range list.
      const range = (asString(pageRange) ?? "all").trim() || "all";
      if (range !== "all" && !/^\d{1,4}(-\d{1,4})?(,\d{1,4}(-\d{1,4})?)*$/.test(range)) {
        return res.status(400).json({ message: "Page range must be 'all' or a list like 1-4,7,9-12." });
      }

      // Priced here, always. providedPrice was used when present, so the client
      // set its own price — including a negative one, which landed in the
      // database as sent. Nothing bills on this today; that is not a reason to
      // let a caller write whatever it likes into the field.
      const pricePerPage = mode === "bw" ? 2 : 10;
      const price = pageTotal * copyCount * pricePerPage;

      let jobId = providedJobId;
      if (!jobId) {
        jobId = generatePrintId();
        while (await PrintJob.findOne({ jobId })) {
          jobId = generatePrintId();
        }
      }

      // The Pi downloads and prints whatever this points at, so it has to be a
      // file this server issued. Without the check, a caller could name any URL
      // and have the agent fetch it — arbitrary content onto the printer, and a
      // request originating from inside the campus network.
      if (typeof filePath !== "string" || !isOwnUploadUrl(filePath, req)) {
        return res.status(400).json({ message: "Invalid file reference. Upload the file first." });
      }

      let finalFilePath = filePath;
      let encrypted = false;
      let envelopeFields: Partial<{
        encIv: string;
        encAuthTag: string;
        wrappedKey: string;
        wrappedKeyIv: string;
        wrappedKeyAuthTag: string;
      }> = {};

      // ENCRYPTION for Confidential Faculty Jobs — mandatory, fails closed.
      // A confidential job is never created unencrypted; if encryption fails
      // the upload is rejected instead of silently storing plaintext.
      if (confidential) {
        // The admin's kill switch. Checked here, not only by hiding the toggle
        // in the wizard — a client can still send confidential:true directly to
        // this endpoint, and a UI that hides a button is not access control.
        if (!(await confidentialPrintingEnabled())) {
          return res.status(400).json({
            message: "Confidential printing is currently turned off by the administrator.",
          });
        }
        if (!teacherEmpId) {
          return res.status(400).json({ message: "A Faculty ID is required for confidential jobs." });
        }
        try {
          // Extract the filename from the public URL filePath
          const urlObj = new URL(filePath);
          const localFileName = path.basename(urlObj.pathname);
          const localPath = path.join(UPLOADS_DIR, localFileName);

          // Read the file from disk
          const fileBuffer = await fs.readFile(localPath);

          // Per-file random key (DEK), wrapped by the server-only MASTER_KEY.
          // Nothing here is derivable from any value the API ever returns.
          const envelope = encryptFileEnvelope(fileBuffer);

          // Written to its own file, never over the original.
          //
          // Uploads are content-addressed, so two people uploading the same
          // document share one file on disk. Encrypting in place therefore
          // reached across jobs: mark one confidential and a colleague's
          // ordinary job, pointing at the same bytes, silently became
          // ciphertext and printed rubbish. Two confidential jobs over the same
          // document were worse — the second encrypted the first's ciphertext,
          // and the first's key no longer opened anything.
          //
          // The name is the hash of the ciphertext, so it matches what the
          // download route accepts and, because every job gets a fresh random
          // key, two confidential jobs over the same source never collide.
          const cipherName = `${crypto.createHash("sha256").update(envelope.ciphertext).digest("hex")}${path.extname(localFileName)}`;
          await fs.writeFile(path.join(UPLOADS_DIR, cipherName), envelope.ciphertext);
          finalFilePath = `${publicBaseUrl(req)}/uploads/${cipherName}?t=${encodeURIComponent(signFileToken(cipherName))}`;

          // The plaintext must not linger. Orphan cleanup would eventually take
          // it, but "eventually" is three hours of a confidential paper sitting
          // readable on disk. Kept only if another job still needs it — which
          // can only be an ordinary job whose owner uploaded the same document.
          if ((await PrintJob.countDocuments({ filePath: { $regex: localFileName } })) === 0) {
            await fs.unlink(localPath).catch(() => {});
          }

          envelopeFields = {
            encIv: envelope.encIv,
            encAuthTag: envelope.encAuthTag,
            wrappedKey: envelope.wrappedKey,
            wrappedKeyIv: envelope.wrappedKeyIv,
            wrappedKeyAuthTag: envelope.wrappedKeyAuthTag,
          };
          encrypted = true;
          console.log(`🔒 Encrypted file ${localFileName} for Job ${jobId}`);
        } catch (encErr: any) {
          console.error("Encryption failed:", encErr);
          return res.status(500).json({ message: "Failed to secure confidential document. Job not created." });
        }
      }

      // Sanitize again here: this endpoint accepts fileName from the request
      // body, so a caller can set it to anything without going through /upload.
      const safeFileName = sanitizeFileName(fileName);

      // Signed over the fields that decide who may print this: the print code,
      // the faculty ID that releases it, whether it is confidential, and the
      // document it points at. Edited anywhere but here, the tag stops matching
      // and a confidential job stops being releasable.
      const integrity = signJobIntegrity({
        jobId,
        teacherEmpId: teacherEmpId || null,
        confidential: confidential || false,
        fileName: safeFileName,
        filePath: finalFilePath,
      });

      const job = await PrintJob.create({
        jobId,
        studentName: studentName || "Student",
        teacherEmpId: teacherEmpId || null,
        fileName: safeFileName,
        filePath: finalFilePath,
        pageCount: pageTotal,
        colorMode: mode,
        copies: copyCount,
        duplex: duplex === true,
        orientation: orient,
        paperSize: size,
        pageRange: range,
        price,
        status: 'uploaded',
        confidential: confidential || false,
        encrypted,
        integrity,
        ...envelopeFields,
      });

      // The count above is a check-then-act, and twelve simultaneous posts sailed
      // straight through it — every one counted the same "under the limit" before
      // any of them inserted, and ten landed against a limit of five.
      //
      // Settled after the insert instead, where it can be decided rather than
      // predicted: rank this row among its siblings by _id, which is monotonic,
      // so concurrent writers each get a distinct position and agree on it. Over
      // the limit means this row is the one that loses, and it removes itself.
      if (maxFilesForBatch !== null) {
        const rank = await PrintJob.countDocuments({ jobId, _id: { $lte: job._id } });
        if (rank > maxFilesForBatch) {
          await PrintJob.deleteOne({ _id: job._id });
          return res.status(400).json({
            message: `A print code can hold at most ${maxFilesForBatch} file${maxFilesForBatch === 1 ? "" : "s"}.`,
          });
        }
      }

      // Send Email OTP if teacherEmail is provided
      if (teacherEmail) {
        // Run asynchronously so it doesn't block the response
        sendOtpEmail(teacherEmail, studentName || "Faculty Member", jobId, safeFileName).catch(console.error);
      }

      res.status(201).json(sanitizeJob(job.toJSON()));
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      console.error("Create print job error:", err);
      console.error("Request failed:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get print job(s) by job ID. Rate-limited: this takes the same 6-digit PIN
  // as /api/jobs/lookup, so leaving it open would just be a way around that
  // endpoint's limiter.
  app.get("/api/print-jobs/:jobId", lookupLimiter, async (req, res) => {
    try {
      const jobs = await PrintJob.find({ jobId: req.params.jobId }).lean();
      if (!jobs || jobs.length === 0) {
        return res.status(404).json({ message: "Print job not found" });
      }
      const mapped = jobs.map(j => redactConfidential(sanitizeJob({ ...j, id: j._id }), req));
      res.json(mapped.length === 1 ? mapped[0] : mapped);
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  // No payment routes: staff printing is not billed. The old unauthenticated
  // /api/jobs/:jobId/demo-pay let any caller push a job to payment_confirmed.

  // ADMIN & TEACHER — MongoDB

  // Registration was open and unthrottled — anyone could create staff accounts
  // in bulk. It still needs to be self-service, so it is rate limited rather
  // than gated. Note that a self-registered account gives no access to anyone
  // else's jobs: confidential release checks the faculty ID on the job itself.
  app.post("/api/teacher/register", registerLimiter, async (req, res) => {
    try {
      const name = asString(req.body.name)?.trim();
      const email = normalizeEmail(req.body.email);
      const password = asString(req.body.password);
      const empId = asString(req.body.empId)?.trim();
      if (!name || !email || !password || !empId) {
        return res.status(400).json({ message: "Name, email, password, and empId are required" });
      }
      // Rejected before anything is created. This reveals nothing about who
      // already has an account — it is a property of the address typed in — so
      // it does not reopen the enumeration hole the identical-response
      // handling below closes.
      if (!signupDomainAllowed(email)) {
        return res.status(400).json({
          message: `Use your institute email address (@${ALLOWED_SIGNUP_DOMAINS[0]}).`,
        });
      }
      // The name is echoed back into the approval queue and into emails, and
      // nothing bounded it — express.json's 100kb cap was the only limit.
      if (name.length > 100) {
        return res.status(400).json({ message: "Name is too long." });
      }
      const weak = passwordTooWeak(password);
      if (weak) {
        return res.status(400).json({ message: weak });
      }

      // A duplicate used to answer "already exists", which made this form a
      // lookup service: anyone could test an address, and — worse — anyone could
      // test an Employee ID. A faculty ID is what releases a confidential exam
      // paper at the kiosk, so handing out a way to confirm valid ones undoes
      // the control it sits behind. Sign-in was made enumeration-safe; this
      // route quietly gave it all back.
      //
      // The answer is now identical either way. A real member of staff who has
      // already registered loses nothing: they either wait for approval or use
      // the password reset, both of which they would do anyway.
      const accepted = {
        success: true,
        needsVerification: true,
        message: "Check that inbox for a 6-digit code to confirm the address is yours.",
      };

      const existing = await Teacher.findOne({ $or: [{ email }, { empId }] }).select("_id").lean();
      if (existing) {
        // Spend roughly what the real path spends, so the reply time does not
        // become the oracle the message no longer is.
        await hashPassword(password);
        return res.status(201).json(accepted);
      }

      // Belonging to the right domain is not the same as owning the address.
      // Anyone could type principal@vit.ac.in, and an administrator looking at
      // a plausible VIT address has no way to tell. The code proves the person
      // registering can read mail there; approval remains a separate gate.
      const otp = crypto.randomInt(100000, 1000000).toString();
      await Teacher.create({
        name,
        email,
        password: await hashPassword(password),
        empId,
        department: 'General',
        emailVerified: false,
        emailOtp: hashOtp(otp),
        emailOtpExpires: new Date(Date.now() + OTP_TTL_MS),
        emailOtpAttempts: 0,
      });

      const { sendVerificationEmail } = await import('./emailService');
      sendVerificationEmail(email, name, otp).catch((e) =>
        console.error("Verification email failed:", e?.message),
      );

      res.status(201).json(accepted);
    } catch (err: any) {
      console.error("Teacher registration error:", err);
      // A field the schema rejects is the caller's mistake, not a server fault.
      // Answering 500 both misreports it and reads, to anything scanning the
      // API, as an unhandled exception reachable from a form field.
      if (err?.name === "ValidationError") {
        return res.status(400).json({ message: "Those details are not valid. Check the Employee ID and try again." });
      }
      // The unique index catching a duplicate the SELECT above missed — two
      // requests racing for the same address. Answer exactly as the duplicate
      // branch does, or the race becomes the oracle that branch removed.
      if (err?.code === 11000) {
        return res.status(201).json({
          success: true,
          needsVerification: true,
          message: "Check that inbox for a 6-digit code to confirm the address is yours.",
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Confirm the address is real. Same bounds as the reset code: five wrong
  // guesses destroy it, and a replacement cannot be minted on demand.
  app.post("/api/teacher/verify-email", authLimiter, async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const otp = asString(req.body.otp);
      if (!email || !otp) {
        return res.status(400).json({ message: "Email and code are required" });
      }

      const teacher = await Teacher.findOne({ email });
      // Same answer whether the account exists, is already verified, or the code
      // is wrong — otherwise this becomes the account lookup that registration
      // deliberately is not.
      const generic = { message: "That code is not valid, or it has expired." };
      if (!teacher?.emailOtp || !teacher.emailOtpExpires) return res.status(400).json(generic);
      if (teacher.emailOtpExpires.getTime() < Date.now()) return res.status(400).json(generic);

      const attempts = (teacher.emailOtpAttempts ?? 0) + 1;
      const supplied = Buffer.from(hashOtp(otp), "hex");
      const actual = Buffer.from(String(teacher.emailOtp), "hex");
      const matches =
        supplied.length > 0 && supplied.length === actual.length &&
        crypto.timingSafeEqual(supplied, actual);

      if (!matches) {
        if (attempts >= OTP_MAX_ATTEMPTS) {
          await Teacher.updateOne({ _id: teacher._id }, {
            $set: { emailOtpAttempts: 0 }, $unset: { emailOtp: 1, emailOtpExpires: 1 },
          });
        } else {
          await Teacher.updateOne({ _id: teacher._id }, { $set: { emailOtpAttempts: attempts } });
        }
        return res.status(400).json(generic);
      }

      // Confirming the code also approves the account. That is only sound
      // because ALLOWED_SIGNUP_DOMAINS is staff-only at VIT — proving mailbox
      // ownership on that domain proves staff identity, which is what the
      // manual approval step existed to establish. If a domain here is ever
      // shared with students, this stops being true and approval needs to go
      // back to a human. See SECURITY.md.
      await Teacher.updateOne({ _id: teacher._id }, {
        $set: { emailVerified: true, emailOtpAttempts: 0, approved: true },
        $unset: { emailOtp: 1, emailOtpExpires: 1 },
      });
      res.json({
        success: true,
        message: "Address confirmed — you can sign in now.",
      });
    } catch (err: any) {
      console.error("Verify email error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/teacher/resend-verification", authLimiter, async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const sent = { success: true, message: "If that address needs confirming, a new code is on its way." };
      if (!email) return res.status(400).json({ message: "Email is required" });

      const teacher = await Teacher.findOne({ email });
      if (!teacher || teacher.emailVerified) return res.json(sent);

      // One code a minute per account, for the same reason the reset code is
      // bounded: without it, a fresh code means a fresh budget of guesses, and
      // anyone could flood the inbox on demand.
      if (
        teacher.emailOtpExpires &&
        teacher.emailOtpExpires.getTime() - OTP_TTL_MS > Date.now() - OTP_REISSUE_MIN_INTERVAL_MS
      ) {
        return res.json(sent);
      }

      const otp = crypto.randomInt(100000, 1000000).toString();
      await Teacher.updateOne({ _id: teacher._id }, {
        $set: {
          emailOtp: hashOtp(otp),
          emailOtpExpires: new Date(Date.now() + OTP_TTL_MS),
          emailOtpAttempts: 0,
        },
      });
      const { sendVerificationEmail } = await import('./emailService');
      sendVerificationEmail(teacher.email, teacher.name, otp).catch(() => {});
      res.json(sent);
    } catch (err: any) {
      console.error("Resend verification error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/teacher/login", authLimiter, async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const password = asString(req.body.password);
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const teacher = await Teacher.findOne({ email });
      if (!teacher) {
        // Spend the same time a real comparison costs. Returning immediately
        // made "no such account" measurably faster than "wrong password", which
        // turns the 401 into an account-enumeration oracle.
        await verifyPassword(password, DUMMY_PASSWORD_HASH);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (accountLocked(teacher)) {
        return res.status(429).json({
          message: "Too many failed sign-ins for this account. Try again in a few minutes.",
        });
      }

      const { ok, needsUpgrade } = await verifyPassword(password, teacher.password);
      if (!ok) {
        await recordLoginFailure(Teacher, teacher);
        return res.status(401).json({ message: "Invalid credentials" });
      }
      await clearLoginFailures(Teacher, teacher._id);
      if (needsUpgrade) {
        await Teacher.updateOne({ _id: teacher._id }, { password: await hashPassword(password) });
      }

      // Both of these are checked after the password, deliberately. Rejecting
      // earlier would let anyone probe which addresses have accounts by
      // watching which ones answer "pending" instead of "invalid credentials".
      if (teacher.emailVerified === false) {
        return res.status(403).json({
          needsVerification: true,
          message: "Confirm your email address first — check your inbox for the 6-digit code.",
        });
      }
      if (teacher.approved === false) {
        return res.status(403).json({
          message: "This account is waiting for administrator approval.",
        });
      }

      res.json({
        success: true,
        name: teacher.name,
        email: teacher.email,
        empId: teacher.empId,
        token: signTeacherToken(teacher.email),
      });
    } catch (err: any) {
      console.error("Teacher login error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/teacher/profile", requireTeacher, async (req, res) => {
    try {
      const { name } = req.body;
      // Target the signed-in teacher only. Taking the email from the body let
      // anyone rename any teacher just by knowing their address.
      const email = (req as AuthedRequest).teacherEmail;
      if (!name) {
        return res.status(400).json({ message: "Name is required" });
      }

      const teacher = await Teacher.findOneAndUpdate(
        { email },
        { name },
        { new: true }
      );

      if (!teacher) {
        return res.status(404).json({ message: "Teacher not found" });
      }

      res.json({ success: true, name: teacher.name });
    } catch (err: any) {
      console.error("Teacher profile update error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/teacher/forgot-password", forgotPasswordLimiter, async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Same response either way as the "not found" branch just below — a
      // distinct answer here would tell a caller which domains are allowed
      // faster than reading it out of this file, and would do so by touching
      // no database at all, which is a very cheap oracle to hand out.
      if (!passwordResetAllowedFor(email)) {
        return res.json({ success: true, message: "If that email is registered, an OTP will be sent." });
      }

      const teacher = await Teacher.findOne({ email });
      if (!teacher) {
        // Return 200 even if not found to prevent email enumeration
        return res.json({ success: true, message: "If that email is registered, an OTP will be sent." });
      }

      // Five wrong guesses destroy a reset code — but nothing stopped an
      // attacker simply asking for another one. Each fresh code came with a
      // fresh budget, so the real bound was not five guesses, it was five
      // guesses per email they could trigger, which is to say no bound at all.
      // It also let anyone flood a member of staff's inbox on demand.
      //
      // A new code is issued at most once a minute per account. The reply is
      // unchanged either way, so this reveals nothing about who exists.
      if (
        teacher.resetPasswordExpires &&
        teacher.resetPasswordExpires.getTime() - OTP_TTL_MS > Date.now() - OTP_REISSUE_MIN_INTERVAL_MS
      ) {
        return res.json({ success: true, message: "If that email is registered, an OTP will be sent." });
      }

      // Generate 6-digit OTP
      const otp = crypto.randomInt(100000, 1000000).toString();
      
      // Save OTP to teacher document, expires in 15 minutes
      await Teacher.updateOne(
        { _id: teacher._id },
        {
          $set: {
            // Stored as a hash. The code goes to the owner's inbox; anyone
            // reading the database — a backup, a stray dump, the operator —
            // should not be handed a working password reset for every account
            // with one outstanding.
            resetPasswordOtp: hashOtp(otp),
            resetPasswordExpires: new Date(Date.now() + OTP_TTL_MS),
            // A fresh code gets a fresh budget.
            resetPasswordAttempts: 0,
          },
        }
      );

      // Send the email
      const { sendPasswordResetEmail } = await import('./emailService');
      await sendPasswordResetEmail(teacher.email, teacher.name, otp);

      res.json({ success: true, message: "If that email is registered, an OTP will be sent." });
    } catch (err: any) {
      console.error("Forgot password error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/teacher/verify-reset-otp", authLimiter, async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const otp = asString(req.body.otp);
      if (!email || !otp) {
        return res.status(400).json({ message: "Email and OTP are required" });
      }

      const teacher = await consumeOtp(email, otp);
      if (!teacher) {
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }

      res.json({ success: true, message: "OTP verified" });
    } catch (err: any) {
      console.error("Verify OTP error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/teacher/reset-password", authLimiter, async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const otp = asString(req.body.otp);
      const newPassword = asString(req.body.newPassword);
      if (!email || !otp || !newPassword) {
        return res.status(400).json({ message: "Email, OTP, and new password are required" });
      }

      // Registration enforced a minimum and this route did not, so the policy
      // was one request away from being bypassed entirely: request a reset,
      // set the password to a single character.
      const weak = passwordTooWeak(newPassword);
      if (weak) {
        return res.status(400).json({ message: weak });
      }

      const teacher = await consumeOtp(email, otp);
      if (!teacher) {
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }

      // Clear OTP fields and update password
      await Teacher.updateOne(
        { _id: teacher._id },
        {
          $set: {
            password: await hashPassword(newPassword),
            resetPasswordAttempts: 0,
            // End every session already open under the old password. Without
            // this, resetting after a suspected compromise left the intruder
            // signed in for up to twelve more hours — the reset locked the
            // front door and left them inside.
            sessionsValidFrom: new Date(),
            // A reset is a legitimate way back in, so it should also clear a
            // lockout rather than leaving the owner shut out of the account
            // they just proved control of.
            failedLoginCount: 0,
            lockedUntil: null,
          },
          $unset: { resetPasswordOtp: 1, resetPasswordExpires: 1 }
        }
      );

      res.json({ success: true, message: "Password has been reset successfully" });
    } catch (err: any) {
      console.error("Reset password error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Changing the admin password from the dashboard, so it does not need an SSH
  // session and a script every time.
  //
  // The current password is required even though the caller already holds a
  // valid admin token. That is the whole point: an unattended dashboard, or a
  // token lifted from a browser, should not be enough to lock the real admin
  // out of their own system by changing the password out from under them.
  app.post("/api/admin/change-password", requireAdmin, authLimiter, async (req, res) => {
    try {
      const currentPassword = asString(req.body.currentPassword);
      const newPassword = asString(req.body.newPassword);
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current and new password are required." });
      }

      const weak = passwordTooWeak(newPassword, MIN_ADMIN_PASSWORD_LENGTH);
      if (weak) {
        return res.status(400).json({ message: weak });
      }
      if (currentPassword === newPassword) {
        return res.status(400).json({ message: "The new password must be different." });
      }

      const username = (req as AuthedRequest).adminUsername!;
      const admin = await Admin.findOne({ username });
      if (!admin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const { ok } = await verifyPassword(currentPassword, admin.passwordHash);
      if (!ok) {
        await recordLoginFailure(Admin, admin);
        await AuditLog.create({
          event: "admin_password_change", printId: null, ip: req.ip,
          success: false, detail: `${username} — wrong current password`,
        }).catch(() => {});
        return res.status(401).json({ message: "That is not your current password." });
      }

      // Sign every other admin session out. The replacement token below is
      // stamped one millisecond later so this session, the one doing the
      // changing, is the single one that survives.
      const stamp = new Date();
      await Admin.updateOne(
        { _id: admin._id },
        {
          $set: {
            passwordHash: await hashPassword(newPassword),
            sessionsValidFrom: stamp,
            failedLoginCount: 0,
            lockedUntil: null,
          },
        },
      );

      await AuditLog.create({
        event: "admin_password_change", printId: null, ip: req.ip,
        success: true, detail: username,
      }).catch(() => {});

      res.json({ success: true, token: signAdminToken(username, stamp.getTime() + 1) });
    } catch (err: any) {
      console.error("Admin password change error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // restrictAdminIp goes ahead of the limiter so a blocked network cannot burn
  // through the login budget for everyone else.
  app.post("/api/admin/login", restrictAdminIp, authLimiter, async (req, res) => {
    try {
      const username = asString(req.body.username)?.trim();
      const password = asString(req.body.password);
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      const admin = await Admin.findOne({ username });
      if (!admin) {
        await verifyPassword(password, DUMMY_PASSWORD_HASH);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (accountLocked(admin)) {
        return res.status(429).json({
          message: "Too many failed sign-ins for this account. Try again in a few minutes.",
        });
      }

      const { ok, needsUpgrade } = await verifyPassword(password, admin.passwordHash);
      if (!ok) {
        await recordLoginFailure(Admin, admin);
        return res.status(401).json({ message: "Invalid credentials" });
      }
      await clearLoginFailures(Admin, admin._id);
      if (needsUpgrade) {
        await Admin.updateOne({ _id: admin._id }, { passwordHash: await hashPassword(password) });
      }

      res.json({
        success: true,
        username: admin.username,
        token: signAdminToken(admin.username),
      });
    } catch (err: any) {
      console.error("Admin login error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Staff accounts, for the approval queue. Password and reset fields are never
  // selected, so nothing sensitive travels even to an admin.
  app.get("/api/admin/teachers", requireAdmin, async (_req, res) => {
    try {
      const teachers = await Teacher.find()
        .select("name email empId department approved emailVerified createdAt lockedUntil")
        .sort({ approved: 1, createdAt: -1 })
        .lean();
      const now = Date.now();
      res.json(
        teachers.map((t) => ({
          ...t,
          id: t._id,
          // Whether the account is currently frozen by repeated failed
          // sign-ins. The dashboard had no way to see this, so an admin
          // fielding "I can't log in" had no idea it was the cause.
          locked: !!t.lockedUntil && t.lockedUntil.getTime() > now,
          // Shown so an administrator does not approve an address whose owner
          // never confirmed it — the whole point of the code.
          emailVerified: t.emailVerified !== false,
          lockedUntil: undefined,
        })),
      );
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.patch("/api/admin/teachers/:id/approval", requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!isObjectId(id)) {
        return res.status(404).json({ message: "Account not found" });
      }
      if (typeof req.body?.approved !== "boolean") {
        return res.status(400).json({ message: "approved must be true or false." });
      }

      // Revoking has to end the sessions that are already open, or it does
      // nothing for up to twelve hours: the holder's token is signed and still
      // inside its lifetime, and nothing re-read the account. Approving does
      // not touch it — an approval should not sign anyone out.
      const update: Record<string, unknown> = { approved: req.body.approved };
      if (req.body.approved === false) {
        update.sessionsValidFrom = new Date();
      }

      const teacher = await Teacher.findByIdAndUpdate(
        id,
        { $set: update },
        { new: true },
      ).select("name email approved").lean();

      if (!teacher) {
        return res.status(404).json({ message: "Account not found" });
      }

      await AuditLog.create({
        event: req.body.approved ? "teacher_approved" : "teacher_revoked",
        printId: null,
        ip: req.ip,
        success: true,
        detail: `${teacher.email} by ${(req as AuthedRequest).adminUsername}`,
      }).catch(() => {});

      res.json({ success: true, teacher: { ...teacher, id: teacher._id } });
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  // Clearing a lockout. The lock expires on its own after fifteen minutes, so
  // this is not required to recover an account — but on an exam morning fifteen
  // minutes of a staff member not being able to sign in is its own incident,
  // and the alternative is an admin editing the database by hand.
  app.post("/api/admin/teachers/:id/unlock", requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!isObjectId(id)) {
        return res.status(404).json({ message: "Account not found" });
      }

      const teacher = await Teacher.findByIdAndUpdate(
        id,
        { $set: { failedLoginCount: 0, lockedUntil: null } },
        { new: true },
      ).select("name email").lean();

      if (!teacher) {
        return res.status(404).json({ message: "Account not found" });
      }

      await AuditLog.create({
        event: "teacher_unlocked",
        printId: null,
        ip: req.ip,
        success: true,
        detail: `${teacher.email} by ${(req as AuthedRequest).adminUsername}`,
      }).catch(() => {});

      res.json({ success: true });
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  // Clear a job locked by repeated wrong faculty IDs.
  //
  // Both bounds have to go: the audit rows the 24-hour lockout counts, and the
  // 15-minute limiter's bucket for this job. Clearing one and not the other
  // leaves the job still refusing and looks like the button did nothing.
  app.post("/api/admin/jobs/:printId/unlock", requireAdmin, async (req, res) => {
    try {
      const printId = String(req.params.printId);
      if (!/^\d{6}$/.test(printId)) {
        return res.status(404).json({ message: "Print job not found" });
      }
      const exists = await PrintJob.exists({ jobId: printId });
      if (!exists) {
        return res.status(404).json({ message: "Print job not found" });
      }

      const cleared = await AuditLog.deleteMany({
        event: "confidential_verify",
        printId,
        success: false,
      });
      // express-rate-limit exposes resetKey on the middleware; the key here has
      // to match verifyFacultyLimiter's keyGenerator exactly.
      try {
        (verifyFacultyLimiter as any).resetKey?.(`verify:${printId}`);
      } catch {
        /* store may not support reset; the audit-row clear is the important half */
      }

      await AuditLog.create({
        event: "job_unlocked",
        printId,
        ip: req.ip,
        success: true,
        detail: `by ${(req as AuthedRequest).adminUsername}`,
      }).catch(() => {});

      res.json({ success: true, clearedAttempts: cleared.deletedCount });
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/admin/cleanup", requireAdmin, async (req, res) => {
    try {
      await cleanupExpiredJobs();
      return res.json({ success: true });
    } catch (err) {
      console.error("Cleanup Error:", err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // SETTINGS — MongoDB

  // Read by the print wizard (for maxFilesLimit) and the admin dashboard, so it
  // cannot be admin-only. It returned every document in the collection though,
  // which makes the collection itself a hazard: the day anyone stores a key, an
  // endpoint or a credential as a "setting", it is served to the public without
  // a line of code changing. Only the two keys the app actually understands go
  // out, and they are both small integers.
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await SystemSetting.find({
        key: { $in: [...Object.keys(ALLOWED_SETTINGS), ...Array.from(ALLOWED_BOOLEAN_SETTINGS)] },
      }).lean();
      res.json(settings.map(s => ({ ...s, id: s._id })));
    } catch (err) {
      console.error("Settings Fetch Error:", err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.put("/api/admin/settings", requireAdmin, async (req, res) => {
    try {
      const { settings } = req.body; // Array of { key, value }
      if (!Array.isArray(settings)) {
        return res.status(400).json({ message: "settings must be an array of { key, value }" });
      }

      for (const setting of settings) {
        if (ALLOWED_BOOLEAN_SETTINGS.has(setting?.key)) {
          if (typeof setting.value !== "boolean") {
            return res.status(400).json({ message: `${setting.key} must be true or false.` });
          }
          await SystemSetting.findOneAndUpdate(
            { key: setting.key },
            { key: setting.key, value: String(setting.value) },
            { upsert: true, new: true }
          );
          continue;
        }

        const rule = ALLOWED_SETTINGS[setting?.key];
        if (!rule) {
          return res.status(400).json({ message: `Unknown setting "${setting?.key}".` });
        }
        const value = Math.floor(Number(setting.value));
        if (!Number.isFinite(value) || value < rule.min || value > rule.max) {
          return res.status(400).json({
            message: `${setting.key} must be a whole number between ${rule.min} and ${rule.max}.`,
          });
        }
        await SystemSetting.findOneAndUpdate(
          { key: setting.key },
          { key: setting.key, value: String(value) },
          { upsert: true, new: true }
        );
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("Settings Update Error:", err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // KIOSK UI ROUTES — Served from the same Express server
  // The kiosk frontend is embedded at /kiosk-app/ and makes
  // API calls to these endpoints on the same origin.

  // Lookup job(s) by PIN (kiosk IdleScreen + hooks)
  app.get("/api/jobs/lookup/:printId", lookupLimiter, async (req, res) => {
    try {
      const { printId } = req.params;
      const jobs = await PrintJob.find({ jobId: printId }).lean();
      if (!jobs || jobs.length === 0) {
        return res.status(404).json({ message: "No print job found for this code." });
      }
      // Proof that this caller knew the PIN, required to edit/delete below.
      // Sent as a header so the response body shape stays unchanged.
      res.setHeader("X-Job-Session", signJobSession(String(printId)));
      res.json(jobs.map(j => redactConfidential(sanitizeJob({ ...j, id: j._id }), req)));
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  // Server-side faculty verification for confidential jobs at the kiosk.
  // Replaces the old client-side compare — the correct empId is never sent
  // to the browser; only a signed, short-lived release token is returned.
  app.post("/api/jobs/:printId/verify-faculty", verifyFacultyLimiter, async (req, res) => {
    try {
      const printId = String(req.params.printId);
      const { facultyId } = req.body;
      if (!facultyId || typeof facultyId !== "string") {
        return res.status(400).json({ message: "Faculty ID is required" });
      }

      // Per-job lockout, counted across every address.
      //
      // The IP limiter on this route gives each address six failures. An
      // attacker with a hundred addresses therefore gets six hundred guesses,
      // and a faculty ID is short — it is the last thing standing between a
      // guessed print code and a printed exam paper. What has to be bounded is
      // attempts against *this job*, wherever they come from.
      //
      // Ten is generous for someone typing their own ID, and a locked job cannot
      // be used to deny anyone else: the lock is scoped to the one print code an
      // attacker is already attacking.
      const failedAttempts = await AuditLog.countDocuments({
        event: "confidential_verify",
        printId,
        success: false,
        createdAt: { $gt: new Date(Date.now() - FACULTY_LOCKOUT_WINDOW_MS) },
      });
      if (failedAttempts >= FACULTY_ATTEMPT_LIMIT) {
        return res.status(423).json({
          message: "This job has been locked after too many incorrect Faculty IDs. Ask the print desk to re-issue it.",
        });
      }

      const job = await PrintJob.findOne({ jobId: printId, confidential: true })
        .select("jobId teacherEmpId confidential fileName filePath integrity")
        .lean();

      // The faculty ID being checked here comes out of the job document, so it
      // is only worth checking if the document is the one we wrote. Someone with
      // direct database access could otherwise set teacherEmpId to a value they
      // already know and walk through this check legitimately.
      if (job && !verifyJobIntegrity(job)) {
        await AuditLog.create({
          event: "job_integrity_failure",
          printId,
          ip: req.ip,
          success: false,
          detail: "verify-faculty on a job whose record does not match its signature",
        }).catch(() => {});
        console.error(`[security] Job ${printId} failed its integrity check — record altered outside the application.`);
        return res.status(409).json({
          message: "This job cannot be verified. Please ask the print desk to re-issue it.",
        });
      }

      const match = !!job && typeof job.teacherEmpId === "string" &&
        job.teacherEmpId.trim().toLowerCase() === facultyId.trim().toLowerCase();

      await AuditLog.create({
        event: "confidential_verify",
        printId,
        ip: req.ip,
        success: match,
      }).catch(() => {});

      if (!job) {
        return res.status(404).json({ message: "Confidential job not found" });
      }
      if (!match) {
        return res.status(401).json({ message: "Invalid Faculty ID. Please try again." });
      }

      res.json({ success: true, token: signReleaseToken(printId) });
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Verification failed. Please try again." });
    }
  });

  // Update job details (copies, color, orientation, etc.)
  app.patch("/api/jobs/:id/details", async (req, res) => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) {
        return res.status(404).json({ message: "Print job not found" });
      }

      const owner = await PrintJob.findById(id).select("jobId").lean();
      if (!owner) {
        return res.status(404).json({ message: "Print job not found" });
      }
      if (!verifyJobSession(owner.jobId, req.headers["x-job-session"])) {
        return res.status(403).json({ message: "Enter the print code before editing this job." });
      }
      if (await confidentialGuardFailed(owner.jobId, req, res)) return;

      const updates: any = {};
      if (req.body.pageCount !== undefined) updates.pageCount = req.body.pageCount;
      if (req.body.colorMode !== undefined) updates.colorMode = req.body.colorMode;
      if (req.body.copies !== undefined) {
        // The wizard's own limit. Without it the agent would happily be told to
        // run a hundred thousand copies of a question paper.
        const copies = Math.floor(Number(req.body.copies));
        if (!Number.isFinite(copies) || copies < 1 || copies > 500) {
          return res.status(400).json({ message: "Copies must be between 1 and 500." });
        }
        updates.copies = copies;
      }
      if (req.body.duplex !== undefined) updates.duplex = req.body.duplex;
      if (req.body.orientation !== undefined) updates.orientation = req.body.orientation;
      if (req.body.paperSize !== undefined) updates.paperSize = req.body.paperSize;

      // runValidators is off by default on updates, so the colorMode/orientation/
      // paperSize enums in the schema were enforced on create and ignored here.
      const job = await PrintJob.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
      if (!job) {
        return res.status(404).json({ message: "Print job not found" });
      }
      res.json(sanitizeJob(job.toJSON()));
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Could not update this job. Please try again." });
    }
  });

  // Delete a job item
  app.delete("/api/jobs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) {
        return res.status(404).json({ message: "Print job not found" });
      }

      const owner = await PrintJob.findById(id).select("jobId").lean();
      if (!owner) {
        return res.status(404).json({ message: "Print job not found" });
      }
      if (!verifyJobSession(owner.jobId, req.headers["x-job-session"])) {
        return res.status(403).json({ message: "Enter the print code before deleting this job." });
      }
      if (await confidentialGuardFailed(owner.jobId, req, res)) return;

      const result = await PrintJob.findByIdAndDelete(id);
      if (!result) {
        return res.status(404).json({ message: "Print job not found" });
      }
      res.json({ success: true, id });
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Could not delete this job. Please try again." });
    }
  });

  // Update job status by PIN (kiosk uses this for batch status updates)
  app.patch("/api/jobs/:printId/status", statusLimiter, async (req, res) => {
    try {
      const printId = String(req.params.printId);
      const { releaseToken } = req.body;

      // status went into the database exactly as sent, unvalidated. Anyone
      // holding a print code could set it to any string at all: a value the
      // kiosk cannot render, "completed" on a job that never printed, or an
      // object, which reached Mongoose as a cast error and came back as a 500.
      // These five are the only states anything in the system understands.
      const ALLOWED_STATUSES = ["uploaded", "printing", "completed", "failed", "cancelled"];
      const status = asString(req.body.status);
      if (!status || !ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Unknown status." });
      }

      // Editing and deleting a job already required proof the print code had
      // been entered at a kiosk; changing its status did not, so the code on
      // its own was enough to cancel a colleague's job or mark it completed so
      // that it never printed. The kiosk holds this token from the lookup it
      // must do first, so nothing legitimate notices.
      if (!verifyJobSession(printId, req.headers["x-job-session"])) {
        return res.status(403).json({ message: "Enter the print code before changing this job." });
      }

      // Confidential jobs can only move to 'printing' with a valid,
      // server-issued release token (proof the faculty check passed).
      if (status === "printing") {
        // Nothing goes to the printer on a record we cannot vouch for. This
        // covers the case the release token cannot: a token is proof the
        // faculty check passed, not proof the job it passed against is the one
        // we created.
        const toPrint = await PrintJob.find({ jobId: printId })
          .select("jobId teacherEmpId confidential fileName filePath integrity")
          .lean();
        const altered = toPrint.filter((j) => !verifyJobIntegrity(j));
        if (altered.length > 0) {
          await AuditLog.create({
            event: "job_integrity_failure",
            printId,
            ip: req.ip,
            success: false,
            detail: `release blocked — ${altered.length} of ${toPrint.length} record(s) do not match their signature`,
          }).catch(() => {});
          console.error(`[security] Refusing to print ${printId}: ${altered.length} record(s) altered outside the application.`);
          return res.status(409).json({
            message: "This job cannot be printed. Please ask the print desk to re-issue it.",
          });
        }

        const hasConfidential = await PrintJob.exists({ jobId: printId, confidential: true });
        if (hasConfidential && !verifyReleaseToken(printId, releaseToken)) {
          await AuditLog.create({
            event: "confidential_release",
            printId,
            ip: req.ip,
            success: false,
            detail: "missing/invalid release token",
          }).catch(() => {});
          return res.status(403).json({ message: "Faculty verification required before releasing this job." });
        }
        if (hasConfidential) {
          await AuditLog.create({ event: "confidential_release", printId, ip: req.ip, success: true }).catch(() => {});
        }
      }

      const result = await PrintJob.updateMany({ jobId: printId }, { status });
      if (result.modifiedCount === 0) {
        return res.status(404).json({ message: "Print job not found" });
      }

      const updatedJobs = await PrintJob.find({ jobId: printId }).lean();
      const mapped = updatedJobs.map(j => sanitizeJob({ ...j, id: j._id }));

      // Broadcast via WebSocket
      for (const job of mapped) {
        broadcastJobUpdate(job);
      }

      res.json(mapped);
    } catch (err: any) {
      console.error("Request failed:", err);
      res.status(500).json({ message: "Could not update the job status. Please try again." });
    }
  });

  // No /api/jobs/confirmed route: it listed every confirmed job — filename and
  // download URL included — to anonymous callers, and nothing consumed it.
  // Anything needing a cross-job view should go through requireAdmin.

  return httpServer;
}
