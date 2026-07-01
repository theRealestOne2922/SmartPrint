import mongoose, { Schema, type Document } from 'mongoose';

export interface IPrintJob {
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
  confidential?: boolean;
  encrypted?: boolean;
  stripeSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPrintJobDocument extends IPrintJob, Document {}

const printJobSchema = new Schema<IPrintJobDocument>(
  {
    jobId: { type: String, required: true, maxlength: 6 },
    studentName: { type: String, required: true, default: 'Teacher' },
    teacherEmpId: { type: String, default: null },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    pageCount: { type: Number, required: true },
    colorMode: { type: String, required: true, enum: ['bw', 'color'] },
    copies: { type: Number, required: true },
    duplex: { type: Boolean, default: false },
    orientation: {
      type: String,
      default: 'portrait',
      enum: ['portrait', 'landscape'],
    },
    paperSize: { type: String, default: 'a4', enum: ['a4', 'a3'] },
    pageRange: { type: String, default: 'all' },
    price: { type: Number, required: true },
    status: { type: String, required: true, default: 'uploaded' },
    confidential: { type: Boolean, default: false },
    encrypted: { type: Boolean, default: false },
    stripeSessionId: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc: any, ret: Record<string, any>) => {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const PrintJob = mongoose.model<IPrintJobDocument>(
  'PrintJob',
  printJobSchema,
);
