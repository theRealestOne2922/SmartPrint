// Email Service — Brevo API (reliable, free up to 300/day to any address)
const brevoApiKey = process.env.BREVO_API_KEY || '';

// Gmail's own SMTP, used in preference to Brevo when credentials are present.
//
// The delivery problem was never the gmail.com address as such, it was sending
// that address from somebody else's servers: gmail.com authorises Google's
// ranges and no others, so a message bearing a gmail.com From and leaving
// Brevo fails SPF and carries no DKIM signature aligned to gmail.com. Sent
// through smtp.gmail.com the same message passes both, and because the
// recipients here are on Google Workspace it is then Google delivering to
// Google.
//
// GMAIL_APP_PASSWORD must be an App Password, not the account password.
// Google refuses account passwords on SMTP outright — the WebLoginRequired
// error — and an App Password can only be generated once 2-Step Verification
// is enabled on the account.
const gmailUser = (process.env.GMAIL_USER || '').trim();
const gmailAppPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const smtpEnabled = !!(gmailUser && gmailAppPassword);

// The From address must be on a domain we control and have verified in Brevo,
// with Brevo's SPF and DKIM records published for it.
//
// It used to be a gmail.com address, and that is why institutional recipients
// never received their codes. gmail.com publishes "v=spf1
// redirect=_spf.google.com", which authorises Google's own ranges and nothing
// else, so a message sent through Brevo's servers bearing a gmail.com From
// fails SPF and has no DKIM signature aligned to gmail.com. Consumer Gmail
// still delivers it, because gmail.com's DMARC policy is p=none — which is
// exactly why testing against a personal Gmail account showed no problem.
// Google Workspace tenants apply their own filtering on top, and a gmail.com
// sender arriving from third-party infrastructure is a textbook forgery
// signature, so those messages are filed as spam or dropped outright. Every
// recipient we actually care about is on such a tenant.
const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || 'smartprintvit@gmail.com';
const FROM_NAME = process.env.MAIL_FROM_NAME || 'SmartPrint VIT';

if (smtpEnabled) {
  console.log(`📧 Email service configured (Gmail SMTP), sending as ${gmailUser}`);
} else if (brevoApiKey) {
  console.log(`📧 Email service configured (Brevo API), sending as ${FROM_EMAIL}`);
  if (/@(gmail|googlemail|yahoo|outlook|hotmail)\.com$/i.test(FROM_EMAIL)) {
    console.warn(`⚠️  MAIL_FROM_EMAIL is a free-webmail address (${FROM_EMAIL}).`);
    console.warn('⚠️  Such mail fails SPF and DKIM alignment when sent via Brevo and is');
    console.warn('⚠️  filtered by Google Workspace and Microsoft 365 recipients. Set');
    console.warn('⚠️  MAIL_FROM_EMAIL to an address on a domain verified in Brevo.');
  }
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

// Created once, on first use, so that a deployment without SMTP credentials
// neither builds a transport nor pays for the module.
let transporter: any = null;
async function getTransporter() {
  if (transporter) return transporter;
  const nodemailer = await import('nodemailer');
  transporter = (nodemailer as any).default.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,          // STARTTLS on 587
    auth: { user: gmailUser, pass: gmailAppPassword },
  });
  return transporter;
}

async function sendGmailEmail(to: string, subject: string, htmlContent: string): Promise<boolean> {
  try {
    const t = await getTransporter();
    await t.sendMail({ from: `"${FROM_NAME}" <${gmailUser}>`, to, subject, html: htmlContent });
    return true;
  } catch (e: any) {
    console.error(`📧 Gmail SMTP error sending to ${to}:`, e?.message);
    return false;
  }
}

// Gmail first where it is configured, Brevo otherwise. Where both exist Gmail
// is tried first and Brevo is the fallback, so a transient SMTP failure does
// not cost the message.
async function sendBrevoEmail(to: string, subject: string, htmlContent: string): Promise<boolean> {
  if (smtpEnabled) {
    if (await sendGmailEmail(to, subject, htmlContent)) return true;
    if (!brevoApiKey) return false;
    console.warn(`📧 Falling back to Brevo for ${to}`);
  }
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
  if (!brevoApiKey && !smtpEnabled) {
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
  if (!brevoApiKey && !smtpEnabled) {
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

export async function sendVerificationEmail(
  toEmail: string,
  teacherName: string,
  otp: string,
): Promise<boolean> {
  if (!brevoApiKey && !smtpEnabled) {
    console.warn('Email not configured — skipping verification email');
    return false;
  }

  const subject = `SmartPrint — Verify your email`;
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
          Someone requested a SmartPrint staff account for this address. Enter the
          code below to confirm it is you.
        </p>

        <div style="background: #FFF8E1; border: 2px solid #FFD54F; border-radius: 12px; padding: 20px; text-align: center; margin: 0 0 20px;">
          <p style="color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px; font-weight: 600;">Verification Code</p>
          <p style="font-size: 40px; font-weight: 800; letter-spacing: 8px; color: #111; margin: 0;">${esc(otp)}</p>
        </div>

        <p style="color: #666; font-size: 13px; margin: 0; line-height: 1.5;">
          This code expires in 15 minutes. After verifying, an administrator still
          has to approve the account before you can sign in.
        </p>
      </div>

      <p style="text-align: center; color: #999; font-size: 11px; margin: 20px 0 0;">
        If you did not request this, ignore this email — no account becomes usable without it.
      </p>
    </div>
  `;

  const success = await sendBrevoEmail(toEmail, subject, html);
  if (success) console.log(`📧 Verification email sent to ${toEmail}`);
  return success;
}
