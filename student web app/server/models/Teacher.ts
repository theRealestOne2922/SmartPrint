import mongoose, { Schema, type Document } from 'mongoose';

export interface ITeacher {
  empId: string;
  name: string;
  email: string;
  password: string;
  department: string | null;
  approved?: boolean;
  resetPasswordOtp?: string;
  resetPasswordExpires?: Date;
  resetPasswordAttempts?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITeacherDocument extends ITeacher, Document {}

const teacherSchema = new Schema<ITeacherDocument>(
  {
    empId: { type: String, required: true, unique: true, maxlength: 20 },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    department: { type: String, default: null },
    // Registration is self-service but not self-authorising. Anyone could sign
    // themselves up as staff, and a staff account is what creates confidential
    // jobs — so an account exists as soon as it is requested, and can do nothing
    // until an admin approves it. Accounts that predate this are approved by the
    // startup migration; nobody currently working gets locked out.
    approved: { type: Boolean, default: false },
    resetPasswordOtp: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    // Wrong guesses against the current code. Rate limiting is per address, so
    // it does nothing about someone spread across many; a six digit code needs
    // a bound that belongs to the account instead. See consumeOtp in routes.ts.
    resetPasswordAttempts: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc: any, ret: Record<string, any>) => {
        ret.id = ret._id;
        delete ret.__v;
        delete ret.password; // Never expose password in API responses
        return ret;
      },
    },
  },
);

export const Teacher = mongoose.model<ITeacherDocument>(
  'Teacher',
  teacherSchema,
);

