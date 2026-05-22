import { db } from "./db";
import { printJobs, type PrintJob, type InsertPrintJob } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  createPrintJob(job: InsertPrintJob): Promise<PrintJob>;
  getPrintJob(jobId: string): Promise<PrintJob | undefined>;
}

export class DatabaseStorage implements IStorage {
  async createPrintJob(insertJob: InsertPrintJob): Promise<PrintJob> {
    const [job] = await db.insert(printJobs).values(insertJob).returning();
    return job;
  }

  async getPrintJob(jobId: string): Promise<PrintJob | undefined> {
    const [job] = await db.select().from(printJobs).where(eq(printJobs.jobId, jobId));
    return job;
  }
}

export const storage = new DatabaseStorage();
