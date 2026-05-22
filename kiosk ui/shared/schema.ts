import { pgTable, text, serial, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const printJobs = pgTable("print_jobs", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 6 }).notNull().unique(),
  studentName: text("student_name").notNull().default("Student"),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  pageCount: integer("page_count").notNull(),
  colorMode: text("color_mode").notNull(), // 'bw' or 'color'
  copies: integer("copies").notNull(),
  price: integer("price").notNull(),
  status: text("status").notNull().default("uploaded"), // uploaded, awaiting_payment, payment_confirmed, printing, completed, failed
  stripeSessionId: text("stripe_session_id"), // stripe session id
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPrintJobSchema = createInsertSchema(printJobs).omit({
  id: true,
  createdAt: true,
  status: true,
});

export type PrintJob = typeof printJobs.$inferSelect;
export type InsertPrintJob = z.infer<typeof insertPrintJobSchema>;

export type CreatePrintJobRequest = InsertPrintJob;
export type UpdatePrintJobRequest = Partial<InsertPrintJob>;

export type PrintJobResponse = PrintJob;
