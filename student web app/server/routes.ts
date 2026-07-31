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

// Faculty ID / PIN lookup are brute-forceable if unthrottled (6-digit PIN = 10^6 space).
//
// These count FAILED attempts only (skipSuccessfulRequests). Guessing wrong
// PINs or faculty IDs produces 4xx and gets throttled fast, while legitimate
// traffic — the kiosk polling one valid PIN every 1.5s, or a whole campus
// behind one NAT address — returns 2xx and is never penalised. Counting every
// request instead would cut the kiosk off mid-print.
const verifyFacultyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  skipSuccessfulRequests: true,
  message: { message: "Too many verification attempts. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  message: { message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

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
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation',
  'text/plain',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
];

// MongoDB treats an object value as a query operator, so a JSON body of
// {"otp": {"$ne": null}} becomes "any OTP that is not null" and matches without
// knowing the code. Every user-supplied value that reaches a query has to be a
// plain string; anything else is rejected rather than coerced, because a caller
// sending an object here is not making a typo.
function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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
  app.use("/uploads", express.static(UPLOADS_DIR));

  // FILE UPLOAD — saves to local disk on the VM, not the database
  app.post("/api/upload", uploadLimiter, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const safeName = sanitizeFileName(req.file.originalname);

      // Validate file type - only allow printable documents
      const fileExt = path.extname(safeName).toLowerCase();
      const fileMime = req.file.mimetype || '';
      if (!ALLOWED_EXTENSIONS.includes(fileExt) && !ALLOWED_MIME_TYPES.includes(fileMime)) {
        return res.status(400).json({
          message: `Unsupported file type "${fileExt}". Supported: PDF, Word, PowerPoint, Excel, Images, and plain text.`
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

      // Construct the public URL for the uploaded file
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const publicUrl = `${protocol}://${host}/uploads/${filename}`;

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
  app.post("/api/print-jobs/new-code", codeLimiter, async (_req, res) => {
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
      res.json(jobs.map(j => sanitizeJob({ ...j, id: j._id })));
    } catch (err: any) {
      console.error("List print jobs error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Create print job
  app.post("/api/print-jobs", jobCreateLimiter, async (req, res) => {
    try {
      const {
        jobId: providedJobId,
        studentName,
        teacherEmpId,
        teacherEmail,
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

      // Validate before pricing so the quote and the job agree on the count.
      const copyCount = Math.floor(Number(copies));
      if (!Number.isFinite(copyCount) || copyCount < 1 || copyCount > 500) {
        return res.status(400).json({ message: "Copies must be between 1 and 500." });
      }

      const pricePerPage = colorMode === "bw" ? 2 : 10;
      const price = providedPrice || pageCount * copyCount * pricePerPage;

      let jobId = providedJobId;
      if (!jobId) {
        jobId = generatePrintId();
        while (await PrintJob.findOne({ jobId })) {
          jobId = generatePrintId();
        }
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
          await fs.writeFile(localPath, envelope.ciphertext);

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

      const job = await PrintJob.create({
        jobId,
        studentName: studentName || "Student",
        teacherEmpId: teacherEmpId || null,
        fileName: safeFileName,
        filePath: finalFilePath,
        pageCount,
        colorMode,
        copies: copyCount,
        duplex: duplex || false,
        orientation: orientation || 'portrait',
        paperSize: paperSize || 'a4',
        pageRange: pageRange || 'all',
        price,
        status: 'uploaded',
        confidential: confidential || false,
        encrypted,
        ...envelopeFields,
      });

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
      const mapped = jobs.map(j => sanitizeJob({ ...j, id: j._id }));
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
  app.post("/api/teacher/register", authLimiter, async (req, res) => {
    try {
      const name = asString(req.body.name);
      const email = asString(req.body.email);
      const password = asString(req.body.password);
      const empId = asString(req.body.empId);
      if (!name || !email || !password || !empId) {
        return res.status(400).json({ message: "Name, email, password, and empId are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters." });
      }

      // Check if email or empId already exists
      const existing = await Teacher.findOne({ $or: [{ email }, { empId }] });
      if (existing) {
        return res.status(400).json({ message: "Teacher with this email or Employee ID already exists" });
      }

      const teacher = await Teacher.create({
        name,
        email,
        password: await hashPassword(password),
        empId,
        department: 'General',
      });

      res.status(201).json({ success: true, message: "Teacher account created" });
    } catch (err: any) {
      console.error("Teacher registration error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/teacher/login", authLimiter, async (req, res) => {
    try {
      const email = asString(req.body.email);
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

      const { ok, needsUpgrade } = await verifyPassword(password, teacher.password);
      if (!ok) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      if (needsUpgrade) {
        await Teacher.updateOne({ _id: teacher._id }, { password: await hashPassword(password) });
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

  app.post("/api/teacher/forgot-password", authLimiter, async (req, res) => {
    try {
      const email = asString(req.body.email);
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const teacher = await Teacher.findOne({ email });
      if (!teacher) {
        // Return 200 even if not found to prevent email enumeration
        return res.json({ success: true, message: "If that email is registered, an OTP will be sent." });
      }

      // Generate 6-digit OTP
      const otp = crypto.randomInt(100000, 1000000).toString();
      
      // Save OTP to teacher document, expires in 15 minutes
      await Teacher.updateOne(
        { _id: teacher._id },
        {
          $set: {
            resetPasswordOtp: otp,
            resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000),
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
      const email = asString(req.body.email);
      const otp = asString(req.body.otp);
      if (!email || !otp) {
        return res.status(400).json({ message: "Email and OTP are required" });
      }

      const teacher = await Teacher.findOne({
        email,
        resetPasswordOtp: otp,
        resetPasswordExpires: { $gt: new Date() } // Ensure it hasn't expired
      });

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
      const email = asString(req.body.email);
      const otp = asString(req.body.otp);
      const newPassword = asString(req.body.newPassword);
      if (!email || !otp || !newPassword) {
        return res.status(400).json({ message: "Email, OTP, and new password are required" });
      }

      const teacher = await Teacher.findOne({
        email,
        resetPasswordOtp: otp,
        resetPasswordExpires: { $gt: new Date() }
      });

      if (!teacher) {
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }

      // Clear OTP fields and update password
      await Teacher.updateOne(
        { _id: teacher._id },
        {
          $set: { password: await hashPassword(newPassword) },
          $unset: { resetPasswordOtp: 1, resetPasswordExpires: 1 }
        }
      );

      res.json({ success: true, message: "Password has been reset successfully" });
    } catch (err: any) {
      console.error("Reset password error:", err);
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

      const { ok, needsUpgrade } = await verifyPassword(password, admin.passwordHash);
      if (!ok) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
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

  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await SystemSetting.find().lean();
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

      // Only these two keys mean anything to the app, and both are numbers with
      // a sane range. Previously any key and any value was upserted, so a typo
      // of 0 in the retention box set the cleanup cutoff to "now" and deleted
      // every job on the next sweep — an accident an admin could not undo.
      const ALLOWED_SETTINGS: Record<string, { min: number; max: number }> = {
        jobExpirationHours: { min: 1, max: 8760 }, // 1 hour to a year
        maxFilesLimit: { min: 1, max: 50 },
      };

      for (const setting of settings) {
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
      res.json(jobs.map(j => sanitizeJob({ ...j, id: j._id })));
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

      const job = await PrintJob.findOne({ jobId: printId, confidential: true })
        .select("teacherEmpId")
        .lean();

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

      const owner = await PrintJob.findById(id).select("jobId").lean();
      if (!owner) {
        return res.status(404).json({ message: "Print job not found" });
      }
      if (!verifyJobSession(owner.jobId, req.headers["x-job-session"])) {
        return res.status(403).json({ message: "Enter the print code before editing this job." });
      }

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

      const owner = await PrintJob.findById(id).select("jobId").lean();
      if (!owner) {
        return res.status(404).json({ message: "Print job not found" });
      }
      if (!verifyJobSession(owner.jobId, req.headers["x-job-session"])) {
        return res.status(403).json({ message: "Enter the print code before deleting this job." });
      }

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

      // Confidential jobs can only move to 'printing' with a valid,
      // server-issued release token (proof the faculty check passed).
      if (status === "printing") {
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
