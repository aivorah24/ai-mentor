const { Resend } = require('resend');
const nodemailer = require('nodemailer');

// ── Primary: Resend (noreply@aivorah.ai) ────────────────────────────────────
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = 'Aivorah <noreply@aivorah.ai>';

// ── Fallback: Gmail SMTP (only if Resend not configured) ────────────────────
const gmailTransporter = (!resend && process.env.EMAIL_USER && process.env.EMAIL_PASS)
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      pool: true, maxConnections: 3, maxMessages: 10, rateDelta: 2000, rateLimit: 5,
    })
  : null;

// Strip HTML to plain text
function htmlToPlainText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Send email (Resend primary, Gmail fallback) ─────────────────────────────
async function sendEmail({ to, subject, html }, retries = 3) {
  const text = htmlToPlainText(html);

  // Try Resend first
  if (resend) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const { data, error } = await resend.emails.send({
          from: FROM_EMAIL,
          to,
          subject,
          html,
          text,
        });
        if (error) throw new Error(error.message);
        console.log(`[mailer:resend] Sent to ${to} (attempt ${attempt}), id: ${data?.id}`);
        return data;
      } catch (err) {
        console.warn(`[mailer:resend] Attempt ${attempt}/${retries} failed for ${to}: ${err.message}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * attempt));
        else throw err;
      }
    }
  }

  // Fallback to Gmail SMTP
  if (gmailTransporter) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const info = await gmailTransporter.sendMail({
          from: `"Aivorah" <${process.env.EMAIL_USER}>`,
          to, subject, html, text,
          replyTo: `"Aivorah" <${process.env.EMAIL_USER}>`,
        });
        console.log(`[mailer:gmail] Sent to ${to} (attempt ${attempt}), messageId: ${info.messageId}`);
        return info;
      } catch (err) {
        console.warn(`[mailer:gmail] Attempt ${attempt}/${retries} failed for ${to}: ${err.message}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * attempt));
        else throw err;
      }
    }
  }

  console.warn(`[mailer] No email provider configured — skipping email to ${to}`);
}

// ── Email functions (templates unchanged) ───────────────────────────────────

async function sendCredentialsEmail({ to, childName, loginId, password, studentId }) {
  if (!to) return;
  try {
    const studentIdRow = studentId
      ? `<tr><td style="padding:8px 0;color:#888;font-size:13px">Student ID</td><td style="padding:8px 0;font-family:monospace;font-size:14px;color:#1a1a1a">${studentId}</td></tr>`
      : '';
    const passwordRow = password
      ? `<tr><td style="padding:8px 0;color:#888;font-size:13px">Password</td><td style="padding:8px 0;font-family:monospace;font-size:14px;color:#1a1a1a">${password}</td></tr>`
      : '';

    await sendEmail({
      to,
      subject: `${childName}'s Aivorah Login Details`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#fff">
          <div style="background:#7C3AED;border-radius:12px;padding:24px 24px 16px;margin-bottom:24px">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Aivorah</h1>
            <p style="margin:8px 0 0;color:#e9d5ff;font-size:14px">Student account ready</p>
          </div>

          <p style="font-size:15px;color:#333;margin-bottom:4px">Hi there!</p>
          <p style="font-size:14px;color:#555;line-height:1.6">
            The student account for <strong>${childName}</strong> has been created on Aivorah.
            Here are the login credentials — please save them somewhere safe.
          </p>

          <div style="background:#f5f3ff;border-radius:10px;padding:20px;margin:20px 0;border:1px solid #ddd6fe">
            <table style="width:100%;border-collapse:collapse">
              ${studentIdRow}
              <tr><td style="padding:8px 0;color:#888;font-size:13px">Login ID</td><td style="padding:8px 0;font-family:monospace;font-size:14px;color:#1a1a1a">${loginId}</td></tr>
              ${passwordRow}
            </table>
          </div>

          <p style="font-size:13px;color:#666;line-height:1.6">
            Your child can log in at <a href="https://aivorah.com" style="color:#7C3AED">aivorah.com</a>
            using the <strong>Login ID</strong> and <strong>Password</strong> above.
            Select <em>Student</em> on the login screen.
          </p>

          <p style="font-size:12px;color:#aaa;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
            This email was sent because a student account was created via Aivorah. If you didn't request this, please contact support.
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.warn('[mailer] sendCredentialsEmail failed:', err.message);
  }
}

async function sendVerificationEmail({ to, name, verifyUrl }) {
  if (!to) return;
  try {
    await sendEmail({
      to,
      subject: 'Verify your Aivorah account',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#fff">
          <div style="background:#7C3AED;border-radius:12px;padding:24px 24px 16px;margin-bottom:24px">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Aivorah</h1>
            <p style="margin:8px 0 0;color:#e9d5ff;font-size:14px">Confirm your email address</p>
          </div>

          <p style="font-size:15px;color:#333;margin-bottom:4px">Hi ${name}!</p>
          <p style="font-size:14px;color:#555;line-height:1.6">
            Thanks for signing up! Click the button below to verify your email address and activate your Aivorah account.
          </p>

          <div style="text-align:center;margin:32px 0">
            <a href="${verifyUrl}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.3px">
              Verify My Email
            </a>
          </div>

          <p style="font-size:13px;color:#666;line-height:1.6">
            If the button doesn't work, <a href="${verifyUrl}" style="color:#7C3AED">click here</a> to verify your email.
          </p>

          <p style="font-size:13px;color:#999;margin-top:24px">This link expires in 24 hours.</p>

          <p style="font-size:12px;color:#aaa;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
            If you didn't create an Aivorah account, you can safely ignore this email.
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.warn('[mailer] sendVerificationEmail failed:', err.message);
  }
}

async function sendWelcomeEmail({ to, name, role }) {
  if (!to) return;
  const roleLabel = role === 'teacher' ? 'Teacher' : role === 'parent' ? 'Parent' : 'Student';
  try {
    await sendEmail({
      to,
      subject: `Welcome to Aivorah, ${name}!`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#fff">
          <div style="background:#7C3AED;border-radius:12px;padding:24px 24px 16px;margin-bottom:24px">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Aivorah</h1>
            <p style="margin:8px 0 0;color:#e9d5ff;font-size:14px">Your account is ready</p>
          </div>

          <p style="font-size:15px;color:#333;margin-bottom:4px">Hi ${name}!</p>
          <p style="font-size:14px;color:#555;line-height:1.6">
            Welcome to <strong>Aivorah</strong> — your ${roleLabel} account has been created successfully.
            You can now log in and complete your profile setup.
          </p>

          <div style="background:#f5f3ff;border-radius:10px;padding:20px;margin:20px 0;border:1px solid #ddd6fe">
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px 0;color:#888;font-size:13px">Email</td><td style="padding:8px 0;font-family:monospace;font-size:14px;color:#1a1a1a">${to}</td></tr>
              <tr><td style="padding:8px 0;color:#888;font-size:13px">Role</td><td style="padding:8px 0;font-size:14px;color:#1a1a1a">${roleLabel}</td></tr>
            </table>
          </div>

          <p style="font-size:13px;color:#666;line-height:1.6">
            Visit <a href="https://aivorah.com" style="color:#7C3AED">aivorah.com</a> to continue setting up your account.
          </p>

          <p style="font-size:12px;color:#aaa;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
            If you didn't create this account, please contact support.
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.warn('[mailer] sendWelcomeEmail failed:', err.message);
  }
}

async function sendPasswordResetEmail({ to, resetLink, childName }) {
  if (!to || !resetLink) return;
  const isChildReset = !!childName;
  const subject = isChildReset ? `Reset ${childName}'s Aivorah password` : 'Reset your Aivorah password';
  const bodyText = isChildReset
    ? `You requested a password reset for your child <strong>${childName}</strong>'s Aivorah account. Click the button below to set a new password.`
    : `We received a request to reset the password for your Aivorah account (<strong>${to}</strong>). Click the button below to set a new password.`;
  try {
    await sendEmail({
      to,
      subject,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#fff">
          <div style="background:#7C3AED;border-radius:12px;padding:24px 24px 16px;margin-bottom:24px">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Aivorah</h1>
            <p style="margin:8px 0 0;color:#e9d5ff;font-size:14px">Password Reset</p>
          </div>

          <p style="font-size:15px;color:#333;margin-bottom:4px">Hello,</p>
          <p style="font-size:14px;color:#555;line-height:1.6">${bodyText}</p>

          <div style="text-align:center;margin:32px 0">
            <a href="${resetLink}" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">
              Reset Password
            </a>
          </div>

          <p style="font-size:13px;color:#666;line-height:1.6">
            This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.
          </p>

          <p style="font-size:12px;color:#aaa;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
            Aivorah · Hyderabad, India
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.warn('[mailer] sendPasswordResetEmail failed:', err.message);
  }
}

async function sendRecoveryOtpEmail({ to, otp }) {
  if (!to || !otp) return;
  try {
    await sendEmail({
      to,
      subject: 'Your Aivorah verification code',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#fff">
          <div style="background:#7C3AED;border-radius:12px;padding:24px 24px 16px;margin-bottom:24px">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Aivorah</h1>
            <p style="margin:8px 0 0;color:#e9d5ff;font-size:14px">Recovery Email Verification</p>
          </div>
          <p style="font-size:15px;color:#333;margin-bottom:4px">Hello,</p>
          <p style="font-size:14px;color:#555;line-height:1.6">
            Use the code below to verify this email as your Aivorah account recovery email.
            This code expires in <strong>10 minutes</strong>.
          </p>
          <div style="text-align:center;margin:32px 0">
            <div style="display:inline-block;background:#f5f3ff;border:2px solid #7C3AED;border-radius:16px;padding:20px 48px">
              <span style="font-size:36px;font-weight:800;color:#7C3AED;letter-spacing:10px">${otp}</span>
            </div>
          </div>
          <p style="font-size:13px;color:#666;line-height:1.6">
            If you didn't request this, you can safely ignore this email.
          </p>
          <p style="font-size:12px;color:#aaa;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
            Aivorah · Hyderabad, India
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.warn('[mailer] sendRecoveryOtpEmail failed:', err.message);
  }
}

async function sendRecoveryEmailConfirmation({ to, accountEmail, accountName }) {
  if (!to) return;
  try {
    await sendEmail({
      to,
      subject: 'Recovery email set for your Aivorah account',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#fff">
          <div style="background:#7C3AED;border-radius:12px;padding:24px 24px 16px;margin-bottom:24px">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Aivorah</h1>
            <p style="margin:8px 0 0;color:#e9d5ff;font-size:14px">Recovery Email Confirmation</p>
          </div>

          <p style="font-size:15px;color:#333;margin-bottom:4px">Hello,</p>
          <p style="font-size:14px;color:#555;line-height:1.6">
            This email address (<strong>${to}</strong>) has been set as the <strong>recovery email</strong>
            for the Aivorah account belonging to <strong>${accountName || accountEmail}</strong>
            (${accountEmail}).
          </p>

          <div style="background:#f5f3ff;border-left:4px solid #7C3AED;border-radius:8px;padding:16px;margin:24px 0">
            <p style="margin:0;font-size:13px;color:#555;line-height:1.6">
              If you ever lose access to that account, use this email address to recover it.
              If you did not authorise this, please contact us immediately at
              <a href="mailto:aivorah24@gmail.com" style="color:#7C3AED">aivorah24@gmail.com</a>.
            </p>
          </div>

          <p style="font-size:12px;color:#aaa;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
            Aivorah · Hyderabad, India
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.warn('[mailer] sendRecoveryEmailConfirmation failed:', err.message);
  }
}

module.exports = { sendCredentialsEmail, sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail, sendRecoveryEmailConfirmation, sendRecoveryOtpEmail };
