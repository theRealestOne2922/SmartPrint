// Security helpers: auth tokens, release tokens, envelope encryption, password hashing
import crypto from "crypto";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";

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
  const payload = `${printId}.${exp}`;
  const expected = crypto.createHmac("sha256", APP_SECRET).update(payload).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Shared HMAC helper for the token types below.
function sign(payload: string): string {
  return crypto.createHmac("sha256", APP_SECRET).update(payload).digest("hex");
}

function sigMatches(sig: string, expected: string): boolean {
  // Buffer.from(<non-hex>, "hex") silently truncates, so compare lengths first.
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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

export function verifyAdminToken(token: unknown): string | null {
  if (!APP_SECRET || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expStr, u, sig] = parts;
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return null;
  if (!sigMatches(sig, sign(`admin.${u}.${exp}`))) return null;
  return Buffer.from(u, "base64url").toString("utf8");
}

export interface AuthedRequest extends Request {
  adminUsername?: string;
}

// Gate for endpoints that expose or destroy data across all jobs.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const username = verifyAdminToken(token);
  if (!username) {
    return res.status(401).json({ message: "Admin authentication required" });
  }
  (req as AuthedRequest).adminUsername = username;
  next();
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

  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

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

// Response sanitization — never let job-secret fields reach any client
const SENSITIVE_JOB_FIELDS = [
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
