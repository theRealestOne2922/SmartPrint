import mongoose, { Schema, type Document } from 'mongoose';

export interface IAdmin {
  username: string;
  passwordHash: string;
  failedLoginCount?: number;
  lastFailedLoginAt?: Date | null;
  lockedUntil?: Date | null;
  sessionsValidFrom?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAdminDocument extends IAdmin, Document {}

const adminSchema = new Schema<IAdminDocument>(
  {
    username: { type: String, required: true, unique: true, maxlength: 50 },
    passwordHash: { type: String, required: true },
    // Failed sign-ins for this account, counted wherever they come from.
    // The rate limiter on the login route counts per address, which buys an
    // attacker another budget for every address they use; a password is worth
    // more than that. Reset on success and after the window passes.
    failedLoginCount: { type: Number, default: 0 },
    lastFailedLoginAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
    // Tokens issued before this moment are refused. Changing the admin password
    // sets it, so a password change ends every admin session that is already
    // open rather than leaving them valid for the next eight hours.
    sessionsValidFrom: { type: Date, default: null },
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

export const Admin = mongoose.model<IAdminDocument>('Admin', adminSchema);
