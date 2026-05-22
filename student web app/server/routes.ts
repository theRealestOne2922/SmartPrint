import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import multer from "multer";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import rateLimit from "express-rate-limit";
import { printJobs } from "@shared/schema";
import { db } from "./db";
import { eq, and, gt } from "drizzle-orm";
import { supabase } from "./supabase";
import express from "express";
import officeCrypto from "officecrypto-tool";
import { cleanupExpiredJobs } from "./cleanup";

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

  app.post(api.upload.path, uploadLimiter, upload.single("file"), async (req: Request, res: Response) => {
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

  // Decrypt password-protected Office files (DOCX, XLSX, PPTX, etc.)
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

  app.post(api.printJobs.create.path, async (req, res) => {
    try {
      const input = api.printJobs.create.input.parse(req.body);

      const pricePerPage = input.colorMode === "bw" ? 2 : 10;
      const price = input.pageCount * input.copies * pricePerPage;

      let jobId = generatePrintId();
      while (await storage.getPrintJob(jobId)) {
        jobId = generatePrintId();
      }

      const job = await storage.createPrintJob({
        jobId,
        studentName: input.studentName || "Student",
        fileName: input.fileName,
        filePath: input.filePath,
        pageCount: input.pageCount,
        colorMode: input.colorMode,
        copies: input.copies,
        price,
      });

      res.status(201).json(job);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      console.error("Create print job error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.printJobs.get.path, async (req, res) => {
    const job = await storage.getPrintJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ message: "Print job not found" });
    }
    res.json(job);
  });

  // Demo simulated payment route
  app.post("/api/jobs/:jobId/demo-pay", async (req, res) => {
    try {
      const jobId = req.params.jobId;

      if (!jobId) {
        return res.status(400).json({ error: 'jobId is required' });
      }

      // Save session id to supabase and set payment_confirmed
      const { error: updateError } = await supabase
        .from('print_jobs')
        .update({ status: 'payment_confirmed' })
        .eq('job_id', jobId);

      if (updateError) {
        console.error('Failed to update status to Supabase:', updateError);
        return res.status(500).json({ error: 'Failed to process order internally' });
      }

      console.log(`Demo pay for job ${jobId}`);
      // In a real app this would verify payment status with a gateway
      return res.json({ success: true, message: 'Payment simulated successfully' });
    } catch (err) {
      console.error('Demo Pay Error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
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

  app.get("/api/settings", async (req, res) => {
    try {
      const { data } = await supabase.from("system_settings").select("*");
      res.json(data || []);
    } catch (err) {
      console.error("Settings Fetch Error:", err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return httpServer;
}
