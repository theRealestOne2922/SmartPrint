// Database Storage Layer — MongoDB (Mongoose)
// Original Drizzle version backed up in _supabase_backup/
import { PrintJob } from "./models/PrintJob";
import type { PrintJob as PrintJobType, InsertPrintJob } from "@shared/schema";

export interface IStorage {
  createPrintJob(job: InsertPrintJob): Promise<PrintJobType>;
  getPrintJob(jobId: string): Promise<PrintJobType | undefined>;
}

export class DatabaseStorage implements IStorage {
  async createPrintJob(insertJob: InsertPrintJob): Promise<PrintJobType> {
    const job = await PrintJob.create(insertJob);
    return job.toJSON() as unknown as PrintJobType;
  }

  async getPrintJob(jobId: string): Promise<PrintJobType | undefined> {
    const job = await PrintJob.findOne({ jobId });
    return job ? (job.toJSON() as unknown as PrintJobType) : undefined;
  }
}

export const storage = new DatabaseStorage();
