import mongoose, { Schema, type Document } from 'mongoose';

export interface ITeacher {
  empId: string;
  name: string;
  email: string;
  password: string;
  department: string | null;
  resetPasswordOtp?: string;
  resetPasswordExpires?: Date;
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
    resetPasswordOtp: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
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

