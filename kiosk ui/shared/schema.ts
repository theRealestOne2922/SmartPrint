// ─── Shared TypeScript Interfaces & Zod Schemas (Kiosk UI) ───
// Replaces old Drizzle ORM table definitions.
import { z } from "zod";

export interface PrintJob {
  id: string;
  jobId: string;
  studentName: string;
  teacherEmpId: string | null;
  fileName: string;
  filePath: string;
  pageCount: number;
  colorMode: string;
  copies: number;
  duplex: boolean;
  orientation: string;
  paperSize: string;
  pageRange: string;
  price: number;
  status: string;
  stripeSessionId: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

export interface InsertPrintJob {
  jobId: string;
  studentName?: string;
  fileName: string;
  filePath: string;
  pageCount: number;
  colorMode: string;
  copies: number;
  price: number;
}

export const insertPrintJobSchema = z.object({
  jobId: z.string().max(6),
  studentName: z.string().optional(),
  fileName: z.string(),
  filePath: z.string(),
  pageCount: z.number(),
  colorMode: z.enum(["bw", "color"]),
  copies: z.number().min(1).max(10),
  price: z.number(),
});

export type CreatePrintJobRequest = InsertPrintJob;
export type UpdatePrintJobRequest = Partial<InsertPrintJob>;
export type PrintJobResponse = PrintJob;
