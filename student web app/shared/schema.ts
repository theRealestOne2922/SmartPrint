import { pgTable, text, serial, integer, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const printJobs = pgTable("print_jobs", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 6 }).notNull().unique(), // 6-digit ID
  studentName: text("student_name").notNull().default("Teacher"), // Keeping column name for backwards compatibility, but it will store Teacher name
  teacherEmpId: text("teacher_emp_id"), // Store the teacher's Employee ID
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  pageCount: integer("page_count").notNull(),
  colorMode: text("color_mode").notNull(), // 'bw' or 'color'
  copies: integer("copies").notNull(),
  duplex: boolean("duplex").default(false),
  orientation: text("orientation").default('portrait'), // 'portrait' or 'landscape'
  paperSize: text("paper_size").default('a4'), // 'a4' or 'a3'
  pageRange: text("page_range").default('all'),
  price: integer("price").notNull(), // price in whole currency units (₹)
  status: text("status").notNull().default('uploaded'), // uploaded
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

export const teachers = pgTable("teachers", {
  id: serial("id").primaryKey(),
  empId: varchar("emp_id", { length: 20 }).notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  department: text("department"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 50 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
