// Kiosk API Routes — MongoDB Edition
import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { PrintJob } from "./models/PrintJob";
import { broadcastJobUpdate } from "./websocket";
import { signReleaseToken, verifyReleaseToken, sanitizeJob } from "./security";

const verifyFacultyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: { message: "Too many verification attempts. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Get print job by PIN code
  app.get(api.printJobs.getByPrintId.path, async (req, res) => {
    const { printId } = req.params;
    const job = await storage.getPrintJobByJobId(printId);
    if (!job) {
      return res.status(404).json({ message: "Print job not found" });
    }
    res.json(sanitizeJob(job));
  });

  // Create print job
  app.post(api.printJobs.create.path, async (req, res) => {
    try {
      const input = api.printJobs.create.input.parse(req.body);
      const job = await storage.createPrintJob(input);
      res.status(201).json(sanitizeJob(job));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update print job status
  app.patch(api.printJobs.updateStatus.path, async (req, res) => {
    try {
      const { printId } = req.params;
      const { status } = api.printJobs.updateStatus.input.parse(req.body);

      const job = await storage.updatePrintJobStatus(printId, status);
      if (!job) {
        return res.status(404).json({ message: "Print job not found" });
      }

      // Broadcast via WebSocket for realtime updates
      broadcastJobUpdate(job);

      res.json(sanitizeJob(job));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Lookup job(s) by PIN (for IdleScreen and client hooks)
  app.get("/api/jobs/lookup/:printId", lookupLimiter, async (req, res) => {
    try {
      const { printId } = req.params;
      const jobs = await PrintJob.find({ jobId: printId }).lean();
      if (!jobs || jobs.length === 0) {
        return res.status(404).json({ message: "No print job found for this code." });
      }
      res.json(jobs.map(j => sanitizeJob({ ...j, id: j._id })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Server-side faculty verification for confidential jobs
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

      if (!job) {
        return res.status(404).json({ message: "Confidential job not found" });
      }
      if (!match) {
        return res.status(401).json({ message: "Invalid Faculty ID. Please try again." });
      }

      res.json({ success: true, token: signReleaseToken(printId) });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Verification failed" });
    }
  });

  // Update job details (copies, color, etc.)
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
      res.json(sanitizeJob(job.toJSON()));
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

  // Update job status by PIN
  app.patch("/api/jobs/:printId/status", statusLimiter, async (req, res) => {
    try {
      const printId = String(req.params.printId);
      const { status, releaseToken } = req.body;

      if (status === "printing") {
        const hasConfidential = await PrintJob.exists({ jobId: printId, confidential: true });
        if (hasConfidential && !verifyReleaseToken(printId, releaseToken)) {
          return res.status(403).json({ message: "Faculty verification required before releasing this job." });
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
      res.status(500).json({ message: err.message || "Failed to update status" });
    }
  });

  // Fetch paid/confirmed jobs (for IdleScreen queue)
  app.get("/api/jobs/confirmed", async (req, res) => {
    try {
      const jobs = await PrintJob.find({ status: 'payment_confirmed' })
        .sort({ createdAt: -1 })
        .lean();

      res.json(jobs.map(j => sanitizeJob({ ...j, id: j._id })));
    } catch (err: any) {
      console.error('Jobs fetch Error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return httpServer;
}