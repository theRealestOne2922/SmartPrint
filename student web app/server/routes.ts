// ─── API Routes — MongoDB Edition ───
// Original Supabase/Drizzle version backed up in _supabase_backup/
// Supabase client is kept ONLY for Storage (file upload/download).
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import multer from "multer";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import rateLimit from "express-rate-limit";
import express from "express";
import officeCrypto from "officecrypto-tool";
import { supabase } from "./supabase";
import { PrintJob } from "./models/PrintJob";
import { Admin } from "./models/Admin";
import { SystemSetting } from "./models/SystemSetting";
import { cleanupExpiredJobs } from "./cleanup";
import { broadcastJobUpdate } from "./websocket";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
// Ensure uploads dir exists
fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(console.error);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Rate limiting: 5 uploads per hour per IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { message: "Rate limit exceeded: 5 uploads per hour" },
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
  return Math.floor(100000 + Math.random() * 900000).toString();
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Serve uploaded files directly
  app.use("/uploads", express.static(UPLOADS_DIR));

  // ═══════════════════════════════════════════════════════════════
  // FILE UPLOAD — Still uses Supabase Storage (not a database op)
  // ═══════════════════════════════════════════════════════════════
  app.post("/api/upload", uploadLimiter, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Validate file type - only allow printable documents
      const fileExt = path.extname(req.file.originalname).toLowerCase();
      const fileMime = req.file.mimetype || '';
      if (!ALLOWED_EXTENSIONS.includes(fileExt) && !ALLOWED_MIME_TYPES.includes(fileMime)) {
        return res.status(400).json({
          message: `Unsupported file type "${fileExt}". Supported: PDF, Word, PowerPoint, Excel, Images, and plain text.`
        });
      }

      // Hash the file for deduplication
      const hash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      const ext = path.extname(req.file.originalname) || '';
      const storagePath = `uploads/${hash}${ext}`;

      // Upload to Supabase Storage (upsert:true handles duplicates gracefully)
      const { data, error } = await supabase.storage
        .from("pdfs")
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype || "application/octet-stream",
          upsert: true, // Overwrite if same file already exists
        });

      if (error) {
        console.error("Supabase Storage error:", error);
        const isNetworkError = error.message?.includes("fetch failed") || error.message?.includes("ENOTFOUND");
        throw new Error(
          isNetworkError
            ? "Cannot reach Supabase. Check your SUPABASE_URL in .env and ensure your Supabase project is active (not paused)."
            : `File upload failed: ${error.message}`
        );
      }

      // Get the public URL for the uploaded file
      const { data: { publicUrl } } = supabase.storage
        .from("pdfs")
        .getPublicUrl(storagePath);

      let pageCount = 1;
      if (req.file.mimetype === "application/pdf" || req.file.originalname.toLowerCase().endsWith(".pdf")) {
        pageCount = await getPdfPageCount(req.file.buffer);
      }

      res.status(200).json({
        filePath: publicUrl,
        fileName: req.file.originalname,
        pageCount,
      });
    } catch (err: any) {
      console.error("Upload Error:", err);
      res.status(400).json({ message: err.message || "Upload failed" });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // DECRYPT — No database involved, unchanged
  // ═══════════════════════════════════════════════════════════════
  app.post("/api/decrypt", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file provided" });
      }

      const password = req.body?.password;
      if (!password) {
        return res.status(400).json({ message: "No password provided" });
      }

      const fileBuffer = req.file.buffer;

      // Check if the file is actually encrypted
      const isEncrypted = officeCrypto.isEncrypted(fileBuffer);
      if (!isEncrypted) {
        // File isn't encrypted — return it as-is
        return res.status(200).send(fileBuffer);
      }

      // Attempt decryption
      try {
        const decryptedBuffer = await officeCrypto.decrypt(fileBuffer, { password });
        
        // Set appropriate headers
        res.setHeader("Content-Type", req.file.mimetype || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${req.file.originalname}"`);
        return res.status(200).send(decryptedBuffer);
      } catch (decryptErr: any) {
        console.error("Decryption failed:", decryptErr.message);
        return res.status(401).json({ 
          message: "Incorrect password. Please try again." 
        });
      }
    } catch (err: any) {
      console.error("Decrypt endpoint error:", err);
      return res.status(500).json({ message: "Failed to process the file" });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PRINT JOBS — MongoDB
  // ═══════════════════════════════════════════════════════════════

  // Check Job ID uniqueness (must come BEFORE the :jobId param route)
  app.get("/api/print-jobs/check-unique/:jobId", async (req, res) => {
    try {
      const existing = await PrintJob.findOne({ jobId: req.params.jobId }).select('_id').lean();
      res.json({ exists: !!existing });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // List all print jobs (Admin Dashboard)
  app.get("/api/print-jobs", async (req, res) => {
    try {
      const jobs = await PrintJob.find().sort({ createdAt: -1 }).lean();
      res.json(jobs.map(j => ({ ...j, id: j._id })));
    } catch (err: any) {
      console.error("List print jobs error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Create print job
  app.post("/api/print-jobs", async (req, res) => {
    try {
      const {
        jobId: providedJobId,
        studentName,
        teacherEmpId,
        fileName,
        filePath,
        pageCount,
        colorMode,
        copies,
        duplex,
        orientation,
        paperSize,
        pageRange,
        price: providedPrice,
      } = req.body;

      const pricePerPage = colorMode === "bw" ? 2 : 10;
      const price = providedPrice || pageCount * copies * pricePerPage;

      let jobId = providedJobId;
      if (!jobId) {
        jobId = generatePrintId();
        while (await PrintJob.findOne({ jobId })) {
          jobId = generatePrintId();
        }
      }

      const job = await PrintJob.create({
        jobId,
        studentName: studentName || "Student",
        teacherEmpId: teacherEmpId || null,
        fileName,
        filePath,
        pageCount,
        colorMode,
        copies,
        duplex: duplex || false,
        orientation: orientation || 'portrait',
        paperSize: paperSize || 'a4',
        pageRange: pageRange || 'all',
        price,
        status: 'uploaded',
      });

      res.status(201).json(job.toJSON());
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      console.error("Create print job error:", err);
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  // Get print job(s) by job ID
  app.get("/api/print-jobs/:jobId", async (req, res) => {
    try {
      const jobs = await PrintJob.find({ jobId: req.params.jobId }).lean();
      if (!jobs || jobs.length === 0) {
        return res.status(404).json({ message: "Print job not found" });
      }
      const mapped = jobs.map(j => ({ ...j, id: j._id }));
      res.json(mapped.length === 1 ? mapped[0] : mapped);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PAYMENT — MongoDB
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/jobs/:jobId/demo-pay", async (req, res) => {
    try {
      const jobId = req.params.jobId;

      if (!jobId) {
        return res.status(400).json({ error: 'jobId is required' });
      }

      const result = await PrintJob.updateMany(
        { jobId },
        { status: 'payment_confirmed' }
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: 'Job not found or already confirmed' });
      }

      // Broadcast status change via WebSocket
      const updatedJobs = await PrintJob.find({ jobId }).lean();
      for (const job of updatedJobs) {
        broadcastJobUpdate({ ...job, id: job._id });
      }

      console.log(`Demo pay for job ${jobId}`);
      return res.json({ success: true, message: 'Payment simulated successfully' });
    } catch (err) {
      console.error('Demo Pay Error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN — MongoDB
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/admin/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      const admin = await Admin.findOne({
        username: username.trim(),
        passwordHash: password,
      });

      if (!admin) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      res.json({ success: true, username: admin.username });
    } catch (err: any) {
      console.error("Admin login error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/cleanup", async (req, res) => {
    try {
      await cleanupExpiredJobs();
      return res.json({ success: true });
    } catch (err) {
      console.error("Cleanup Error:", err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // SETTINGS — MongoDB
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await SystemSetting.find().lean();
      res.json(settings.map(s => ({ ...s, id: s._id })));
    } catch (err) {
      console.error("Settings Fetch Error:", err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.put("/api/admin/settings", async (req, res) => {
    try {
      const { settings } = req.body; // Array of { key, value }
      if (!Array.isArray(settings)) {
        return res.status(400).json({ message: "settings must be an array of { key, value }" });
      }

      for (const setting of settings) {
        await SystemSetting.findOneAndUpdate(
          { key: setting.key },
          { key: setting.key, value: setting.value },
          { upsert: true, new: true }
        );
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("Settings Update Error:", err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // KIOSK UI ROUTES — Served from the same Express server
  // The kiosk frontend is embedded at /kiosk-app/ and makes
  // API calls to these endpoints on the same origin.
  // ═══════════════════════════════════════════════════════════════

  // Lookup job(s) by PIN (kiosk IdleScreen + hooks)
  app.get("/api/jobs/lookup/:printId", async (req, res) => {
    try {
      const { printId } = req.params;
      const jobs = await PrintJob.find({ jobId: printId }).lean();
      if (!jobs || jobs.length === 0) {
        return res.status(404).json({ message: "No print job found for this code." });
      }
      res.json(jobs.map(j => ({ ...j, id: j._id })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update job details (copies, color, orientation, etc.)
  app.patch("/api/jobs/:id/details", async (req, res) => {
    try {
      const { id } = req.params;
      const updates: any = {};
      if (req.body.pageCount !== undefined) updates.pageCount = req.body.pageCount;
      if (req.body.colorMode !== undefined) updates.colorMode = req.body.colorMode;
      if (req.body.copies !== undefined) updates.copies = req.body.copies;
      if (req.body.duplex !== undefined) updates.duplex = req.body.duplex;
      if (req.body.orientation !== undefined) updates.orientation = req.body.orientation;
      if (req.body.paperSize !== undefined) updates.paperSize = req.body.paperSize;

      const job = await PrintJob.findByIdAndUpdate(id, updates, { new: true });
      if (!job) {
        return res.status(404).json({ message: "Print job not found" });
      }
      res.json(job.toJSON());
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to update job details" });
    }
  });

  // Delete a job item
  app.delete("/api/jobs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await PrintJob.findByIdAndDelete(id);
      if (!result) {
        return res.status(404).json({ message: "Print job not found" });
      }
      res.json({ success: true, id });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to delete print job" });
    }
  });

  // Update job status by PIN (kiosk uses this for batch status updates)
  app.patch("/api/jobs/:printId/status", async (req, res) => {
    try {
      const { printId } = req.params;
      const { status } = req.body;

      const result = await PrintJob.updateMany({ jobId: printId }, { status });
      if (result.modifiedCount === 0) {
        return res.status(404).json({ message: "Print job not found" });
      }

      const updatedJobs = await PrintJob.find({ jobId: printId }).lean();
      const mapped = updatedJobs.map(j => ({ ...j, id: j._id }));

      // Broadcast via WebSocket
      for (const job of mapped) {
        broadcastJobUpdate(job);
      }

      res.json(mapped);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to update status" });
    }
  });

  // Fetch confirmed jobs (kiosk queue display)
  app.get("/api/jobs/confirmed", async (req, res) => {
    try {
      const jobs = await PrintJob.find({ status: 'payment_confirmed' })
        .sort({ createdAt: -1 })
        .lean();
      res.json(jobs.map(j => ({ ...j, id: j._id })));
    } catch (err: any) {
      console.error('Jobs fetch Error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return httpServer;
}
