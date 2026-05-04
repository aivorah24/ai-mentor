const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  pool: true,           // reuse connections
  maxConnections: 3,
  maxMessages: 10,
  rateDelta: 2000,      // min 2s between emails
  rateLimit: 5,         // max 5 emails per rateDelta
});

// Retry helper — Gmail SMTP can be flaky, retry up to 3 times
async function sendWithRetry(mailOptions, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[mailer] Sent to ${mailOptions.to} (attempt ${attempt}), messageId: ${info.messageId}`);
      return info;
    } catch (err) {
      console.warn(`[mailer] Attempt ${attempt}/${retries} failed for ${mailOptions.to}: ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * attempt));
      else throw err;
    }
  }
}

async function sendCredentialsEmail({ to, childName, loginId, password, studentId }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !to) return;
  try {
    const studentIdRow = studentId
      ? `<tr><td style="padding:8px 0;color:#888;font-size:13px">Student ID</td><td style="padding:8px 0;font-family:monospace;font-size:14px;color:#1a1a1a">${studentId}</td></tr>`
      : '';
    const passwordRow = password
      ? `<tr><td style="padding:8px 0;color:#888;font-size:13px">Password</td><td style="padding:8px 0;font-family:monospace;font-size:14px;color:#1a1a1a">${password}</td></tr>`
      : '';

    await sendWithRetry({
      from: `"Aivorah" <${process.env.EMAIL_USER}>`,
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
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !to) return;
  try {
    await sendWithRetry({
      from: `"Aivorah" <${process.env.EMAIL_USER}>`,
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
            Or copy and paste this link into your browser:<br/>
            <a href="${verifyUrl}" style="color:#7C3AED;word-break:break-all">${verifyUrl}</a>
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
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !to) return;
  const roleLabel = role === 'teacher' ? 'Teacher' : role === 'parent' ? 'Parent' : 'Student';
  try {
    await sendWithRetry({
      from: `"Aivorah" <${process.env.EMAIL_USER}>`,
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

async function sendPasswordResetEmail({ to, resetLink }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !to || !resetLink) return;
  try {
    await sendWithRetry({
      from: `"Aivorah" <${process.env.EMAIL_USER}>`,
      to,
      subject: 'Reset your Aivorah password',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#fff">
          <div style="background:#7C3AED;border-radius:12px;padding:24px 24px 16px;margin-bottom:24px">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Aivorah</h1>
            <p style="margin:8px 0 0;color:#e9d5ff;font-size:14px">Password Reset</p>
          </div>

          <p style="font-size:15px;color:#333;margin-bottom:4px">Hello,</p>
          <p style="font-size:14px;color:#555;line-height:1.6">
            We received a request to reset the password for your Aivorah account (<strong>${to}</strong>).
            Click the button below to set a new password.
          </p>

          <div style="text-align:center;margin:32px 0">
            <a href="${resetLink}" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">
              Reset Password
            </a>
          </div>

          <p style="font-size:13px;color:#666;line-height:1.6">
            This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password will not change.
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

module.exports = { sendCredentialsEmail, sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail };
