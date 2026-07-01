// ─── Email Service — Nodemailer + Gmail SMTP ───
import nodemailer from 'nodemailer';

const smtpUser = process.env.SMTP_USER || '';
const smtpPass = process.env.SMTP_PASS || '';

let transporter: nodemailer.Transporter | null = null;

if (smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      type: 'Login',
      user: smtpUser,
      pass: smtpPass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    logger: false,
    debug: false,
  });
  // Verify the connection on startup
  transporter.verify()
    .then(() => console.log(`📧 Email service verified & ready (${smtpUser})`))
    .catch((err: any) => console.error(`📧 Email service verification FAILED:`, err.message));
} else {
  console.warn('⚠️  SMTP_USER / SMTP_PASS not set — email sending disabled');
}

export async function sendOtpEmail(
  toEmail: string,
  teacherName: string,
  jobId: string,
  fileName: string,
): Promise<boolean> {
  if (!transporter) {
    console.warn('Email not configured — skipping OTP email');
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"SmartPrint VIT" <${smtpUser}>`,
      to: toEmail,
      subject: `SmartPrint — Your Print Code: ${jobId}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #fafafa; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="font-size: 24px; color: #111; margin: 0;">SmartPrint</h1>
            <p style="color: #666; font-size: 14px; margin: 4px 0 0;">VIT Chennai</p>
          </div>
          
          <div style="background: white; border-radius: 12px; padding: 24px; border: 1px solid #eee;">
            <p style="color: #333; font-size: 15px; margin: 0 0 16px;">
              Hi <strong>${teacherName}</strong>,
            </p>
            <p style="color: #333; font-size: 15px; margin: 0 0 20px;">
              Your print job for <strong>"${fileName}"</strong> has been uploaded successfully.
            </p>
            
            <div style="background: #FFF8E1; border: 2px solid #FFD54F; border-radius: 12px; padding: 20px; text-align: center; margin: 0 0 20px;">
              <p style="color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px; font-weight: 600;">Your Print Code</p>
              <p style="font-size: 40px; font-weight: 800; letter-spacing: 8px; color: #111; margin: 0;">${jobId}</p>
            </div>
            
            <p style="color: #666; font-size: 13px; margin: 0; line-height: 1.5;">
              Enter this 6-digit code at the SmartPrint kiosk to collect your printout.
              <br>This code expires in 24 hours.
            </p>
          </div>
          
          <p style="text-align: center; color: #999; font-size: 11px; margin: 20px 0 0;">
            This is an automated email from SmartPrint. Do not reply.
          </p>
        </div>
      `,
    });

    console.log(`📧 OTP email sent to ${toEmail} for job ${jobId}`);
    return true;
  } catch (err: any) {
    console.error(`📧 Failed to send email to ${toEmail}:`, err.message);
    return false;
  }
}

export async function sendPasswordResetEmail(
  toEmail: string,
  teacherName: string,
  otp: string,
): Promise<boolean> {
  if (!transporter) {
    console.warn('Email not configured — skipping password reset email');
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"SmartPrint VIT" <${smtpUser}>`,
      to: toEmail,
      subject: `SmartPrint — Password Reset Code`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #fafafa; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="font-size: 24px; color: #111; margin: 0;">SmartPrint</h1>
            <p style="color: #666; font-size: 14px; margin: 4px 0 0;">VIT Chennai</p>
          </div>
          
          <div style="background: white; border-radius: 12px; padding: 24px; border: 1px solid #eee;">
            <p style="color: #333; font-size: 15px; margin: 0 0 16px;">
              Hi <strong>${teacherName}</strong>,
            </p>
            <p style="color: #333; font-size: 15px; margin: 0 0 20px;">
              We received a request to reset your password for SmartPrint.
            </p>
            
            <div style="background: #FFF8E1; border: 2px solid #FFD54F; border-radius: 12px; padding: 20px; text-align: center; margin: 0 0 20px;">
              <p style="color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px; font-weight: 600;">Your Reset Code</p>
              <p style="font-size: 40px; font-weight: 800; letter-spacing: 8px; color: #111; margin: 0;">${otp}</p>
            </div>
            
            <p style="color: #666; font-size: 13px; margin: 0; line-height: 1.5;">
              Enter this 6-digit code to reset your password.
              <br>This code expires in 15 minutes.
            </p>
          </div>
          
          <p style="text-align: center; color: #999; font-size: 11px; margin: 20px 0 0;">
            If you did not request this, please ignore this email.
          </p>
        </div>
      `,
    });

    console.log(`📧 Password reset email sent to ${toEmail}`);
    return true;
  } catch (err: any) {
    console.error(`📧 Failed to send password reset email to ${toEmail}:`, err.message);
    return false;
  }
}
