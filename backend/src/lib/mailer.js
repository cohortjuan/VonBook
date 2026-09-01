import nodemailer from 'nodemailer';

let transporter;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

// fail-open, same philosophy as isPasswordBreached would be in lib/password.js:
// a notification email should never block or fail whatever triggered it. No
// SMTP_HOST configured (true until it's actually set up -- see
// .env.example) logs the email instead of sending it, so password reset
// links are still recoverable (from the Render/local logs) before SMTP
// exists, rather than just silently going nowhere.
export async function sendMail({ to, subject, text }) {
  const client = getTransporter();
  if (!client) {
    console.log(`[mailer] SMTP not configured, logging instead of sending to ${to}: ${subject}\n${text}`);
    return;
  }
  try {
    await client.sendMail({
      from: process.env.SMTP_FROM || 'VonBook <noreply@vonbook.app>',
      to,
      subject,
      text,
    });
  } catch (err) {
    console.warn('failed to send email (continuing anyway):', err.message);
  }
}
