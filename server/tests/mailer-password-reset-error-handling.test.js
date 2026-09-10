// Bug 1 RCA: parent-reset-password and self-reset-password routes
// (routes/parent.js:603, routes/user.js "send-password-reset") return
// { ok: true } to the frontend unconditionally, even when the actual email
// provider send fails. Root cause traced to services/mailer.js:
//   - sendPasswordResetEmail() wraps sendEmail() in try/catch and only
//     console.warn()s on failure — it never rethrows, so callers (the routes)
//     can never learn delivery failed.
//   - sendEmail() itself, when NO provider is configured at all
//     (no RESEND_API_KEY and no EMAIL_USER/EMAIL_PASS), just console.warn()s
//     and resolves — never throws.
// These tests assert sendPasswordResetEmail() must reject when delivery
// genuinely fails, so the route's existing try/catch (already present in both
// routes) can correctly surface a 500 instead of a false "ok: true".

const mockResendSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn() })),
}));

describe('sendPasswordResetEmail — delivery failure must propagate (Bug 1)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    mockResendSend.mockReset();
    process.env = { ...ORIGINAL_ENV, RESEND_API_KEY: 'test-resend-key' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('rejects when the email provider fails on every retry attempt', async () => {
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'Resend API down' } });
    const { sendPasswordResetEmail } = require('../services/mailer');

    await expect(sendPasswordResetEmail({
      to: 'parent@example.com',
      resetLink: 'https://aivorah.ai/reset-password?oobCode=abc123',
      childName: 'Test Child',
    })).rejects.toThrow(/Resend API down/);
  }, 20000);

  test('resolves normally when the provider send actually succeeds', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'email-123' }, error: null });
    const { sendPasswordResetEmail } = require('../services/mailer');

    await expect(sendPasswordResetEmail({
      to: 'parent@example.com',
      resetLink: 'https://aivorah.ai/reset-password?oobCode=abc123',
      childName: 'Test Child',
    })).resolves.toBeDefined();
    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });

  test('rejects when no email provider is configured at all (misconfiguration)', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;
    const { sendPasswordResetEmail } = require('../services/mailer');

    await expect(sendPasswordResetEmail({
      to: 'parent@example.com',
      resetLink: 'https://aivorah.ai/reset-password?oobCode=abc123',
      childName: 'Test Child',
    })).rejects.toThrow(/no email provider configured/i);
  });
});
