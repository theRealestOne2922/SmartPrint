// Security helpers (kiosk local-dev server) — mirrors "student web app/server/security.ts"
import crypto from "crypto";

const APP_SECRET = process.env.APP_SECRET || "";
if (!APP_SECRET) {
  console.error("[security] APP_SECRET is not set — confidential release tokens cannot be trusted!");
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

export function signReleaseToken(printId: string): string {
  const exp = Date.now() + 10 * 60 * 1000;
  const payload = `${printId}.${exp}`;
  const sig = crypto.createHmac("sha256", APP_SECRET).update(payload).digest("hex");
  return `${exp}.${sig}`;
}

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
