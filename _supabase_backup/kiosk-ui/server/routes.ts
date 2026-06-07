import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { supabase } from "./supabase";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get(api.printJobs.getByPrintId.path, async (req, res) => {
    const { printId } = req.params;
    const job = await storage.getPrintJobByJobId(printId);
    if (!job) {
      return res.status(404).json({ message: "Print job not found" });
    }
    res.json(job);
  });

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

  app.patch(api.printJobs.updateStatus.path, async (req, res) => {
    try {
      const { printId } = req.params;
      const { status } = api.printJobs.updateStatus.input.parse(req.body);

      const job = await storage.updatePrintJobStatus(printId, status);
      if (!job) {
        return res.status(404).json({ message: "Print job not found" });
      }
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

  // Fetch paid jobs for IdleScreen
  app.get("/api/jobs/confirmed", async (req, res) => {
    try {
      const { data: jobs, error } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('status', 'payment_confirmed')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching confirmed jobs:', error);
        return res.status(500).json({ error: 'Failed to fetch jobs' });
      }

      res.json(jobs);
    } catch (err: any) {
      console.error('Jobs fetch Error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return httpServer;
}