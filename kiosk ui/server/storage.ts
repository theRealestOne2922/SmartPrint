import { db } from "./db";
import {
  printJobs,
  type CreatePrintJobRequest,
  type UpdatePrintJobRequest,
  type PrintJobResponse
} from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  getPrintJobByJobId(jobId: string): Promise<PrintJobResponse | undefined>;
  createPrintJob(job: CreatePrintJobRequest): Promise<PrintJobResponse>;
  updatePrintJobStatus(jobId: string, status: string): Promise<PrintJobResponse | undefined>;
  getPendingJobs(): Promise<PrintJobResponse[]>;
}

export class DatabaseStorage implements IStorage {
  async getPrintJobByJobId(jobId: string): Promise<PrintJobResponse | undefined> {
    const [job] = await db!.select().from(printJobs).where(eq(printJobs.jobId, jobId));
    return job;
  }

  async createPrintJob(job: CreatePrintJobRequest): Promise<PrintJobResponse> {
    const [newJob] = await db!.insert(printJobs).values(job).returning();
    return newJob;
  }

  async updatePrintJobStatus(jobId: string, status: string): Promise<PrintJobResponse | undefined> {
    const [updatedJob] = await db!.update(printJobs)
      .set({ status })
      .where(eq(printJobs.jobId, jobId))
      .returning();
    return updatedJob;
  }

  async getPendingJobs(): Promise<PrintJobResponse[]> {
    return await db!.select().from(printJobs).where(eq(printJobs.status, 'awaiting_payment'));
  }
}

export class MemStorage implements IStorage {
  private printJobs: Map<string, PrintJobResponse>;
  private currentId: number;

  constructor() {
    this.printJobs = new Map();
    this.currentId = 1;
  }

  async getPrintJobByJobId(jobId: string): Promise<PrintJobResponse | undefined> {
    return Array.from(this.printJobs.values()).find(job => job.jobId === jobId);
  }

  async createPrintJob(job: CreatePrintJobRequest): Promise<PrintJobResponse> {
    const id = this.currentId++;
    const newJob: PrintJobResponse = {
      ...job,
      id,
      studentName: job.studentName || "Student",
      status: "uploaded",
      stripeSessionId: null,
      createdAt: new Date(),
    };
    this.printJobs.set(newJob.jobId, newJob);
    return newJob;
  }

  async updatePrintJobStatus(jobId: string, status: string): Promise<PrintJobResponse | undefined> {
    const job = await this.getPrintJobByJobId(jobId);
    if (job) {
      job.status = status;
      this.printJobs.set(jobId, job);
    }
    return job;
  }

  async getPendingJobs(): Promise<PrintJobResponse[]> {
    return Array.from(this.printJobs.values()).filter(job => job.status === 'awaiting_payment');
  }
}

export const storage = process.env.DATABASE_URL ? new DatabaseStorage() : new MemStorage();