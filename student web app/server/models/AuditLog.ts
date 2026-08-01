import mongoose, { Schema, type Document } from 'mongoose';

export interface IAuditLog {
  event: string;
  printId: string | null;
  ip: string | null;
  success: boolean;
  detail?: string;
  createdAt: Date;
}

export interface IAuditLogDocument extends IAuditLog, Document {}

const auditLogSchema = new Schema<IAuditLogDocument>(
  {
    event: { type: String, required: true },
    printId: { type: String, default: null },
    ip: { type: String, default: null },
    success: { type: Boolean, required: true },
    detail: { type: String },
  },
  { timestamps: true },
);

// The confidential-release lockout counts failed verifications for one job on
// every attempt, so this must not be a collection scan.
auditLogSchema.index({ event: 1, printId: 1, success: 1, createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLogDocument>('AuditLog', auditLogSchema);
