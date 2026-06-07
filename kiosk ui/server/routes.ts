// ─── Kiosk API Routes — MongoDB Edition ───
// Original Supabase version backed up in _supabase_backup/
import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { PrintJob } from "./models/PrintJob";
import { broadcastJobUpdate } from "./websocket";

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
    res.json(job);
  });

  // Create print job
  app.post(api.printJobs.create.path, async (req, res) => {
    try {
      const input = api.printJobs.create.input.parse(req.body);
      const job = await storage.createPrintJob(input);
      res.status(201).json(job);
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

      res.json(job);
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

  // ─── Lookup job(s) by PIN (for IdleScreen and client hooks) ───
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

  // ─── Update job details (copies, color, etc.) ───
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

  // ─── Delete a job item ───
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

  // ─── Update job status by PIN ───
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

  // ─── Fetch paid/confirmed jobs (for IdleScreen queue) ───
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