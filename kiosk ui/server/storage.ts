// Kiosk Storage Layer — MongoDB Edition
// Original Drizzle version backed up in _supabase_backup/
import { PrintJob } from "./models/PrintJob";
import type {
  CreatePrintJobRequest,
  PrintJobResponse
} from "@shared/schema";

export interface IStorage {
  getPrintJobByJobId(jobId: string): Promise<PrintJobResponse | undefined>;
  createPrintJob(job: CreatePrintJobRequest): Promise<PrintJobResponse>;
  updatePrintJobStatus(jobId: string, status: string): Promise<PrintJobResponse | undefined>;
  getPendingJobs(): Promise<PrintJobResponse[]>;
}

export class DatabaseStorage implements IStorage {
  async getPrintJobByJobId(jobId: string): Promise<PrintJobResponse | undefined> {
    const job = await PrintJob.findOne({ jobId });
    return job ? (job.toJSON() as unknown as PrintJobResponse) : undefined;
  }

  async createPrintJob(job: CreatePrintJobRequest): Promise<PrintJobResponse> {
    const newJob = await PrintJob.create(job);
    return newJob.toJSON() as unknown as PrintJobResponse;
  }

  async updatePrintJobStatus(jobId: string, status: string): Promise<PrintJobResponse | undefined> {
    const updatedJob = await PrintJob.findOneAndUpdate(
      { jobId },
      { status },
      { new: true }
    );
    return updatedJob ? (updatedJob.toJSON() as unknown as PrintJobResponse) : undefined;
  }

  async getPendingJobs(): Promise<PrintJobResponse[]> {
    const jobs = await PrintJob.find({ status: 'awaiting_payment' });
    return jobs.map(j => j.toJSON() as unknown as PrintJobResponse);
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
    const id = String(this.currentId++);
    const newJob: PrintJobResponse = {
      ...job,
      id,
      studentName: job.studentName || "Student",
      teacherEmpId: null,
      duplex: false,
      orientation: 'portrait',
      paperSize: 'a4',
      pageRange: 'all',
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

export const storage = process.env.MONGODB_URI ? new DatabaseStorage() : new MemStorage();