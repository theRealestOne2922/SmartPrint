import mongoose, { Schema, type Document } from 'mongoose';

export interface ISystemSetting {
  key: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISystemSettingDocument extends ISystemSetting, Document {}

const systemSettingSchema = new Schema<ISystemSettingDocument>(
  {
    key: { type: String, required: true, unique: true, maxlength: 50 },
    value: { type: String, required: true },
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

export const SystemSetting = mongoose.model<ISystemSettingDocument>(
  'SystemSetting',
  systemSettingSchema,
);
