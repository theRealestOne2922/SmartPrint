// Shared TypeScript Interfaces & Zod Schemas
// Replaces the old Drizzle ORM table definitions.
// Original Drizzle version backed up in _supabase_backup/
import { z } from "zod";

// PrintJob
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
  teacherEmpId?: string | null;
  fileName: string;
  filePath: string;
  pageCount: number;
  colorMode: string;
  copies: number;
  duplex?: boolean;
  orientation?: string;
  paperSize?: string;
  pageRange?: string;
  price: number;
}

export const insertPrintJobSchema = z.object({
  jobId: z.string().max(6).optional(),
  studentName: z.string().optional(),
  teacherEmpId: z.string().nullable().optional(),
  fileName: z.string(),
  filePath: z.string(),
  pageCount: z.number(),
  colorMode: z.enum(["bw", "color"]),
  copies: z.number().min(1).max(10),
  duplex: z.boolean().optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  paperSize: z.enum(["a4", "a3"]).optional(),
  pageRange: z.string().optional(),
  price: z.number().optional(),
});

// Teacher
export interface Teacher {
  id: string;
  empId: string;
  name: string;
  email: string;
  department: string | null;
  createdAt: Date;
}

// Admin
export interface Admin {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
}

// SystemSetting
export interface SystemSetting {
  id: string;
  key: string;
  value: string;
  updatedAt: Date;
}
