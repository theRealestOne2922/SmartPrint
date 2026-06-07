import mongoose, { Schema, type Document } from 'mongoose';

export interface ITeacher {
  empId: string;
  name: string;
  email: string;
  department: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITeacherDocument extends ITeacher, Document {}

const teacherSchema = new Schema<ITeacherDocument>(
  {
    empId: { type: String, required: true, unique: true, maxlength: 20 },
    name: { type: String, required: true },
    email: { type: String, required: true },
    department: { type: String, default: null },
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

export const Teacher = mongoose.model<ITeacherDocument>(
  'Teacher',
  teacherSchema,
);
