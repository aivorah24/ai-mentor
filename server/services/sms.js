// ── Fast2SMS OTP delivery ──────────────────────────────────────────
// Fast2SMS discontinued their dedicated "otp" route (confirmed with their
// support), so this uses the "Quick SMS" route (route=q) instead — no DLT
// registration needed, works 24x7 including DND numbers, ~₹5/SMS. Cheaper
// DLT-registered route (~₹0.25/SMS) is a future cost optimization once
// DLT registration (via Smart Ping) is done — not needed to function today.
// Docs: https://docs.fast2sms.com/reference/quick-sms

const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY;
const FAST2SMS_URL = 'https://www.fast2sms.com/dev/bulkV2';

/**
 * Send an OTP SMS to an Indian 10-digit mobile number (no country code prefix).
 * Throws on failure — caller decides how to surface that to the user.
 */
async function sendMobileOtpSms({ to, otp }) {
  if (!FAST2SMS_API_KEY) {
    throw new Error('FAST2SMS_API_KEY not configured');
  }
  const digits = String(to).replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) {
    throw new Error('Fast2SMS only supports 10-digit Indian mobile numbers');
  }

  const res = await fetch(FAST2SMS_URL, {
    method: 'POST',
    headers: {
      authorization: FAST2SMS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      route: 'q',
      message: `Your Aivorah verification code is ${otp}. Do not share this with anyone.`,
      language: 'english',
      numbers: digits,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.return !== true) {
    // Fast2SMS returns `message` as an ARRAY for some error types but a plain
    // STRING for others (e.g. auth failures) — treating it as always-an-array
    // and reading [0] off a string silently grabbed just its first CHARACTER
    // ("Your api key is invalid..." became just "Y"), hiding the real error.
    const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
    throw new Error(msg || `Fast2SMS send failed (${res.status})`);
  }
  return data;
}

module.exports = { sendMobileOtpSms };
