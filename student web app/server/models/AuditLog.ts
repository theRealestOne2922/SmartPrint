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

// Rows are written on paths an outsider can drive — every failed faculty
// verification appends one — and nothing ever removed them. On a shared or
// free-tier cluster that is a slow denial of service anyone can run: fill the
// storage quota and every write in the application starts failing, printing
// included. Mongo drops these ninety days after they are written.
//
// Ninety days outlives any exam cycle you would investigate, and the rows are
// tiny; if an audit trail ever needs to be kept longer than that, it should be
// shipped somewhere off this cluster rather than accumulated here.
const AUDIT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: AUDIT_RETENTION_SECONDS });

export const AuditLog = mongoose.model<IAuditLogDocument>('AuditLog', auditLogSchema);
