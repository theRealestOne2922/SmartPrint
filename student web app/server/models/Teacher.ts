import mongoose, { Schema, type Document } from 'mongoose';

export interface ITeacher {
  empId: string;
  name: string;
  email: string;
  password: string;
  department: string | null;
  approved?: boolean;
  emailVerified?: boolean;
  emailOtp?: string | null;
  emailOtpExpires?: Date | null;
  emailOtpAttempts?: number;
  failedLoginCount?: number;
  lastFailedLoginAt?: Date | null;
  lockedUntil?: Date | null;
  sessionsValidFrom?: Date | null;
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
    // Registration is self-service but not self-authorising. False until the
    // owner confirms their email OTP, at which point the verify-email route
    // sets it true directly — see the comment there for why that is sound only
    // because ALLOWED_SIGNUP_DOMAINS is staff-only. An admin can still flip
    // this false at any time from the dashboard to revoke access; that remains
    // the only way an account goes from approved back to not. Accounts that
    // predate any of this are approved by the startup migration; nobody
    // currently working gets locked out.
    approved: { type: Boolean, default: false },
    // Proof the person registering can read mail at the address they gave.
    // Domain alone is not identity: anyone could type principal@vit.ac.in, and
    // an administrator looking at a plausible VIT address has no way to tell.
    // Accounts predating this rule are marked verified by the startup
    // migration, so nobody in daily use is locked out.
    emailVerified: { type: Boolean, default: false },
    emailOtp: { type: String, default: null },
    emailOtpExpires: { type: Date, default: null },
    // Wrong guesses against the current code, bounded per account for the same
    // reason the reset code is — see consumeOtp in routes.ts.
    emailOtpAttempts: { type: Number, default: 0 },
    // Failed sign-ins for this account, counted wherever they come from.
    // The rate limiter on the login route counts per address, which buys an
    // attacker another budget for every address they use; a password is worth
    // more than that. Reset on success and after the window passes.
    failedLoginCount: { type: Number, default: 0 },
    lastFailedLoginAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
    // Tokens issued before this moment are refused. Set when the password is
    // reset or an admin revokes the account, which is what makes either of
    // those actually end a session that is already open — a signed token is
    // otherwise good for twelve hours no matter what happens to the account.
    sessionsValidFrom: { type: Date, default: null },

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

