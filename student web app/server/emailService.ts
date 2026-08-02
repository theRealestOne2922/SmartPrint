// Email Service — Brevo API (reliable, free up to 300/day to any address)
const brevoApiKey = process.env.BREVO_API_KEY || '';
const FROM_EMAIL = 'smartprintvit@gmail.com';
const FROM_NAME = 'SmartPrint VIT';

if (brevoApiKey) {
  console.log(`📧 Email service configured (Brevo API)`);
} else {
  console.warn('⚠️  BREVO_API_KEY not set — email sending disabled');
}

// Everything interpolated into the templates below is user-controlled: the
// teacher's name comes from a registration form they filled in, the file name
// from whatever they uploaded. Dropped into the markup raw, a name of
// `<a href="http://…">Click here</a>` renders as a working link inside a mail
// that genuinely arrives from smartprintvit@gmail.com and passes SPF — a
// convincing phishing mail with the institution's own sender behind it.
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendBrevoEmail(to: string, subject: string, htmlContent: string): Promise<boolean> {
  if (!brevoApiKey) return false;

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`📧 Brevo error sending to ${to}:`, errorText);
      return false;
    }

    return true;
  } catch (err: any) {
    console.error(`📧 Failed to send email via Brevo to ${to}:`, err.message);
    return false;
  }
}

export async function sendOtpEmail(
  toEmail: string,
  teacherName: string,
  jobId: string,
  fileName: string,
): Promise<boolean> {
  if (!brevoApiKey) {
    console.warn('Email not configured — skipping OTP email');
    return false;
  }

  // Plain text, not markup — escaping here would show "&amp;" in the subject.
  const subject = `SmartPrint — Your Print Code: ${jobId}`;
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #fafafa; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="font-size: 24px; color: #111; margin: 0;">SmartPrint</h1>
        <p style="color: #666; font-size: 14px; margin: 4px 0 0;">VIT Chennai</p>
      </div>
      
      <div style="background: white; border-radius: 12px; padding: 24px; border: 1px solid #eee;">
        <p style="color: #333; font-size: 15px; margin: 0 0 16px;">
          Hi <strong>${esc(teacherName)}</strong>,
        </p>
        <p style="color: #333; font-size: 15px; margin: 0 0 20px;">
          Your print job for <strong>"${esc(fileName)}"</strong> has been uploaded successfully.
        </p>
        
        <div style="background: #FFF8E1; border: 2px solid #FFD54F; border-radius: 12px; padding: 20px; text-align: center; margin: 0 0 20px;">
          <p style="color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px; font-weight: 600;">Your Print Code</p>
          <p style="font-size: 40px; font-weight: 800; letter-spacing: 8px; color: #111; margin: 0;">${esc(jobId)}</p>
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
  `;

  const success = await sendBrevoEmail(toEmail, subject, html);
  if (success) {
    console.log(`📧 OTP email sent to ${toEmail} for job ${jobId}`);
  }
  return success;
}

export async function sendPasswordResetEmail(
  toEmail: string,
  teacherName: string,
  otp: string,
): Promise<boolean> {
  if (!brevoApiKey) {
    console.warn('Email not configured — skipping password reset email');
    return false;
  }

  const subject = `SmartPrint — Password Reset Code`;
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #fafafa; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="font-size: 24px; color: #111; margin: 0;">SmartPrint</h1>
        <p style="color: #666; font-size: 14px; margin: 4px 0 0;">VIT Chennai</p>
      </div>
      
      <div style="background: white; border-radius: 12px; padding: 24px; border: 1px solid #eee;">
        <p style="color: #333; font-size: 15px; margin: 0 0 16px;">
          Hi <strong>${esc(teacherName)}</strong>,
        </p>
        <p style="color: #333; font-size: 15px; margin: 0 0 20px;">
          We received a request to reset your password for SmartPrint.
        </p>
        
        <div style="background: #FFF8E1; border: 2px solid #FFD54F; border-radius: 12px; padding: 20px; text-align: center; margin: 0 0 20px;">
          <p style="color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px; font-weight: 600;">Your Reset Code</p>
          <p style="font-size: 40px; font-weight: 800; letter-spacing: 8px; color: #111; margin: 0;">${esc(otp)}</p>
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
  `;

  const success = await sendBrevoEmail(toEmail, subject, html);
  if (success) {
    console.log(`📧 Password reset email sent to ${toEmail}`);
  }
  return success;
}
