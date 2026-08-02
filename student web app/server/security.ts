// Security helpers: auth tokens, release tokens, envelope encryption, password hashing
import crypto from "crypto";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";
import { Teacher } from "./models/Teacher";
import { Admin } from "./models/Admin";

// Release tokens (server-issued proof of a passed faculty check)
// HMAC-signed, time-boxed, single-purpose per printId. Never derived from
// any value returned to the client (unlike the old teacherEmpId+jobId key).
const APP_SECRET = process.env.APP_SECRET || "";
if (!APP_SECRET) {
  console.error("[security] APP_SECRET is not set — confidential release tokens cannot be trusted!");
}
const RELEASE_TOKEN_TTL_MS = 10 * 60 * 1000; // matches typical kiosk dwell time, not user-facing

export function signReleaseToken(printId: string): string {
  const exp = Date.now() + RELEASE_TOKEN_TTL_MS;
  const payload = `${printId}.${exp}`;
  const sig = crypto.createHmac("sha256", APP_SECRET).update(payload).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyReleaseToken(printId: string, token: unknown): boolean {
  if (!APP_SECRET || typeof token !== "string") return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  // Goes through the same comparison as every other token type rather than
  // repeating it — this copy predated sigMatches and kept the loose parse.
  return sigMatches(sig, sign(`${printId}.${exp}`));
}

// Shared HMAC helper for the token types below.
function sign(payload: string): string {
  return crypto.createHmac("sha256", APP_SECRET).update(payload).digest("hex");
}

// An HMAC-SHA256 digest in hex: exactly 64 characters of [0-9a-f].
const HEX_SIG = /^[0-9a-f]{64}$/;

function sigMatches(sig: string, expected: string): boolean {
  // Reject anything that is not exactly a hex digest before parsing. Checking
  // the parsed lengths is not enough: Buffer.from(<hex>, "hex") stops at the
  // first invalid character, so a signature with junk appended parses to the
  // same bytes as the real one and compared equal. Not forgery — you still need
  // the correct digest first — but a token should have exactly one valid form.
  if (!HEX_SIG.test(sig) || !HEX_SIG.test(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}

// Job session tokens — issued when a kiosk successfully looks up a PIN, and
// required to mutate that job afterwards. This is what stops an anonymous
// caller from editing or deleting jobs they never had the PIN for.
const JOB_SESSION_TTL_MS = 30 * 60 * 1000;

export function signJobSession(printId: string): string {
  const exp = Date.now() + JOB_SESSION_TTL_MS;
  return `${exp}.${sign(`session.${printId}.${exp}`)}`;
}

export function verifyJobSession(printId: string, token: unknown): boolean {
  if (!APP_SECRET || typeof token !== "string") return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  return sigMatches(sig, sign(`session.${printId}.${exp}`));
}

// Admin session tokens. The username is carried in the token and covered by
// the signature; base64url never contains "." so the split stays unambiguous.
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export function signAdminToken(username: string): string {
  const exp = Date.now() + ADMIN_TOKEN_TTL_MS;
  const u = Buffer.from(username, "utf8").toString("base64url");
  return `${exp}.${u}.${sign(`admin.${u}.${exp}`)}`;
}

// Returns the identity and when the token was issued. The issue time is not a
// separate field: exp is set to issue time plus a fixed TTL, so subtracting it
// back out is exact, and it stays covered by the existing signature.
export function verifyAdminToken(token: unknown): { username: string; issuedAt: number } | null {
  if (!APP_SECRET || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expStr, u, sig] = parts;
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return null;
  if (!sigMatches(sig, sign(`admin.${u}.${exp}`))) return null;
  return {
    username: Buffer.from(u, "base64url").toString("utf8"),
    issuedAt: exp - ADMIN_TOKEN_TTL_MS,
  };
}

// Teacher session tokens. Same construction as the admin token, different
// scope string, so one can never be replayed as the other.
const TEACHER_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export function signTeacherToken(email: string): string {
  const exp = Date.now() + TEACHER_TOKEN_TTL_MS;
  const e = Buffer.from(email, "utf8").toString("base64url");
  return `${exp}.${e}.${sign(`teacher.${e}.${exp}`)}`;
}

export function verifyTeacherToken(token: unknown): { email: string; issuedAt: number } | null {
  if (!APP_SECRET || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expStr, e, sig] = parts;
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return null;
  if (!sigMatches(sig, sign(`teacher.${e}.${exp}`))) return null;
  return {
    email: Buffer.from(e, "base64url").toString("utf8"),
    issuedAt: exp - TEACHER_TOKEN_TTL_MS,
  };
}

// A signed token proves who issued it and when, but not that the account is
// still one we would issue to. Nothing re-read the account, so for the lifetime
// of the token — twelve hours for staff, eight for an admin — these were all
// true:
//
//   * revoking a staff account in the dashboard did nothing at all; the holder
//     kept working until the token aged out on its own
//   * resetting a password did not sign anyone else out, so a stolen session
//     survived the very action taken to recover from it
//   * deleting an account left its token working
//
// The account's sessionsValidFrom is set to "now" by each of those actions, and
// any token issued before it is refused here. One indexed read per request.
function tokenPredatesInvalidation(issuedAt: number, validFrom?: Date | null): boolean {
  // Both sides are whole milliseconds, but a token issued in the same
  // millisecond as the reset should still be refused — hence >=.
  return !!validFrom && validFrom.getTime() >= issuedAt;
}

export interface AuthedRequest extends Request {
  adminUsername?: string;
  teacherEmail?: string;
}

// Identifies the calling teacher. The email comes from the signed token, never
// from the request body, so a caller can only act on their own record.
export async function requireTeacher(req: Request, res: Response, next: NextFunction) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const claim = verifyTeacherToken(token);
  if (!claim) {
    return res.status(401).json({ message: "Please sign in again." });
  }

  // Express 4 does not await middleware, so a rejected promise here would be an
  // unhandled rejection and the request would hang rather than answer. Every
  // path out of this function has to be one we take deliberately.
  try {
    // Lower-cased to match how addresses are now stored. A token issued before
    // that migration carries the original casing, and looking it up verbatim
    // would sign those staff out for no reason.
    const teacher = await Teacher.findOne({ email: claim.email.toLowerCase() })
      .select("email approved sessionsValidFrom")
      .lean();

    // Deleted, revoked, or signed out everywhere since this token was issued.
    // Same answer for all three: an account that cannot act should not learn
    // which of those it is.
    if (
      !teacher ||
      teacher.approved === false ||
      tokenPredatesInvalidation(claim.issuedAt, teacher.sessionsValidFrom)
    ) {
      return res.status(401).json({ message: "Please sign in again." });
    }

    // The address as stored, not as the token spelled it, so every lookup
    // downstream matches on exactly the same string.
    (req as AuthedRequest).teacherEmail = teacher.email;
    next();
  } catch (err) {
    // Fail closed. If we cannot confirm the account is still good, we do not
    // get to assume it is.
    console.error("[security] Teacher auth check failed:", err);
    res.status(503).json({ message: "Service temporarily unavailable." });
  }
}

// Uploaded documents were served by a bare static mount: anything in the
// directory went to anyone who asked for it by name. The name is a SHA-256 of
// the file's own contents, so it is not guessable — but it was also handed out
// by the API, and an unguessable URL is not access control. This is the pentest
// finding "file can be accessed unauthorised".
//
// A download now needs a signature bound to that one filename. The Pi needs no
// change for it: the token lives in the filePath stored on the job, which the Pi
// reads from MongoDB rather than from the API.
//
// Seven days is far longer than a download ever needs — the Pi fetches within
// minutes of a job being released — but it comfortably outlives the 24 hour
// retention window, so a token never expires before the file it points at.
const FILE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signFileToken(filename: string): string {
  const exp = Date.now() + FILE_TOKEN_TTL_MS;
  return `${exp}.${sign(`file.${filename}.${exp}`)}`;
}

export function verifyFileToken(filename: string, token: unknown): boolean {
  if (!APP_SECRET || typeof token !== "string") return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  return sigMatches(sig, sign(`file.${filename}.${exp}`));
}

// Optional network restriction for the admin surface, from the pentest note
// "admin control page - ip based access". Set ADMIN_IP_ALLOWLIST to a comma
// separated list of addresses or CIDR-less prefixes, e.g.
//   ADMIN_IP_ALLOWLIST=10.0.0.5,192.168.1.,203.0.113.7
// A trailing dot acts as a prefix match, which is enough for "the campus range"
// without pulling in a CIDR library.
//
// Left unset, this allows everything and says so at boot. That is deliberate:
// an allowlist that silently locks the admin out of their own dashboard during
// an exam is worse than the risk it removes. Turn it on once you know the
// address you will administer from.
//
// This only means anything because trust proxy is set in index.ts; without it
// every request appears to come from nginx on 127.0.0.1.
const ADMIN_IP_ALLOWLIST = (process.env.ADMIN_IP_ALLOWLIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (ADMIN_IP_ALLOWLIST.length === 0) {
  console.warn("[security] ADMIN_IP_ALLOWLIST is not set — the admin page is reachable from any address.");
}

function normalizeIp(ip: string): string {
  // ::ffff:10.0.0.5 is how an IPv4 client shows up on a dual-stack socket.
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

export function adminIpAllowed(req: Request): boolean {
  if (ADMIN_IP_ALLOWLIST.length === 0) return true;
  const ip = normalizeIp(String(req.ip || ""));
  return ADMIN_IP_ALLOWLIST.some((entry) =>
    entry.endsWith(".") ? ip.startsWith(entry) : ip === entry
  );
}

export function restrictAdminIp(req: Request, res: Response, next: NextFunction) {
  if (!adminIpAllowed(req)) {
    console.warn(`[security] Admin access refused for ${normalizeIp(String(req.ip || ""))}`);
    return res.status(403).json({ message: "Not available from this network." });
  }
  next();
}

// Gate for endpoints that expose or destroy data across all jobs.
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // Network check first: a blocked address should not even get to try a password.
  if (!adminIpAllowed(req)) {
    return res.status(403).json({ message: "Not available from this network." });
  }
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const claim = verifyAdminToken(token);
  if (!claim) {
    return res.status(401).json({ message: "Admin authentication required" });
  }

  try {
    const admin = await Admin.findOne({ username: claim.username })
      .select("sessionsValidFrom")
      .lean();

    if (!admin || tokenPredatesInvalidation(claim.issuedAt, admin.sessionsValidFrom)) {
      return res.status(401).json({ message: "Admin authentication required" });
    }

    (req as AuthedRequest).adminUsername = claim.username;
    next();
  } catch (err) {
    console.error("[security] Admin auth check failed:", err);
    res.status(503).json({ message: "Service temporarily unavailable." });
  }
}

// Envelope encryption for confidential documents
// Per-file random DEK (AES-256-GCM) wrapped by a server-only MASTER_KEY.
// The wrapped key never leaves the server and is never derivable from any
// value returned by the API (unlike the old sha256(teacherEmpId + jobId)).
const MASTER_KEY_HEX = process.env.MASTER_KEY || "";
const MASTER_KEY = MASTER_KEY_HEX.length === 64 ? Buffer.from(MASTER_KEY_HEX, "hex") : null;
if (!MASTER_KEY) {
  console.error("[security] MASTER_KEY is missing/invalid (need 64 hex chars) — confidential encryption will fail closed.");
}

export interface EncryptedEnvelope {
  ciphertext: Buffer;
  encIv: string;
  encAuthTag: string;
  wrappedKey: string;
  wrappedKeyIv: string;
  wrappedKeyAuthTag: string;
}

export function encryptFileEnvelope(buffer: Buffer): EncryptedEnvelope {
  if (!MASTER_KEY) throw new Error("MASTER_KEY not configured");

  // Step 1: lock the document with a fresh random key used for this file only.
  // Two staff uploading the same paper get different ciphertext, and cracking
  // one file tells you nothing about any other.
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  // GCM's auth tag: if a single byte of the file is altered on disk, decryption
  // fails instead of printing corrupted output.
  const authTag = cipher.getAuthTag();

  // Step 2: lock that key with the MASTER_KEY, which only the server and the Pi
  // hold. The job document stores the wrapped key, so the database on its own
  // is useless to anyone who copies it.
  const wrapIv = crypto.randomBytes(12);
  const wrapCipher = crypto.createCipheriv("aes-256-gcm", MASTER_KEY, wrapIv);
  const wrappedKey = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
  const wrappedKeyAuthTag = wrapCipher.getAuthTag();

  return {
    ciphertext,
    encIv: iv.toString("hex"),
    encAuthTag: authTag.toString("hex"),
    wrappedKey: wrappedKey.toString("hex"),
    wrappedKeyIv: wrapIv.toString("hex"),
    wrappedKeyAuthTag: wrappedKeyAuthTag.toString("hex"),
  };
}

// Password hashing (bcrypt) with transparent legacy-plaintext migration
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

function looksLikeBcryptHash(value: string): boolean {
  return /^\$2[aby]\$/.test(value);
}

// Returns whether the password matched, and whether the stored value was
// legacy plaintext (caller should re-save the upgraded hash on success).
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (looksLikeBcryptHash(stored)) {
    return { ok: await bcrypt.compare(plain, stored), needsUpgrade: false };
  }
  const ok = plain === stored;
  return { ok, needsUpgrade: ok };
}

// Response sanitization — never let job-secret fields reach any client.
// This is the fix for what SDC found: open DevTools after signing in and the
// job payloads carried these fields. Everything that leaves the server for a
// client goes through here, including the WebSocket broadcast, so a new
// endpoint can't quietly start leaking them again.
const SENSITIVE_JOB_FIELDS = [
  // The direct download URL for the document. Pentest finding: "file can be
  // accessed unauthorised" — anyone who guessed a print code got this back from
  // the open lookup endpoint and could fetch the file straight off /uploads.
  // Nothing on any client needs it: the uploader already has the URL from the
  // upload response, the kiosk never reads it, and the Pi takes it from the
  // database rather than the API.
  "filePath",
  "teacherEmpId",
  "encIv",
  "encAuthTag",
  "wrappedKey",
  "wrappedKeyIv",
  "wrappedKeyAuthTag",
];

export function sanitizeJob<T extends Record<string, any>>(job: T): T {
  const clean = { ...job };
  for (const field of SENSITIVE_JOB_FIELDS) delete (clean as any)[field];
  return clean;
}
