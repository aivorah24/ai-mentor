// Bug 1 follow-up: routes/user.js's POST /user/send-password-reset shares the
// exact same sendPasswordResetEmail() call (and the exact same bare
// try/catch-around-everything shape) as routes/parent.js's child-reset route,
// which was the route actually reported broken. mailer-password-reset-error-
// handling.test.js already proves the shared root cause (mailer.js silently
// swallowing delivery failures) is fixed at the function level. This file
// closes the remaining gap: routes/user.js itself had ZERO test coverage
// before this (confirmed via a repo-wide search), so nothing proved its
// try/catch actually turns the now-thrown mailer error into a real 500
// instead of some other silent-success path unique to this route.

process.env.SUPABASE_URL         = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'mock-service-key';

const mockResendSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResendSend } })),
}));
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn() })) }));

const mockGeneratePasswordResetLink = jest.fn();
jest.mock('firebase-admin', () => ({
  apps: [{}], // pretend already initialised so routes/user.js skips its own initializeApp() path
  credential: { cert: jest.fn() },
  initializeApp: jest.fn(),
  auth: jest.fn(() => ({ generatePasswordResetLink: mockGeneratePasswordResetLink })),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  })),
}));

jest.mock('cloudinary', () => ({ v2: { config: jest.fn(), uploader: { upload: jest.fn() } } }));

const express = require('express');
const http = require('http');
process.env.RESEND_API_KEY = 'test-resend-key';
const userRouter = require('../routes/user');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/user', userRouter);
  return app;
}

function post(app, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        {
          hostname: '127.0.0.1', port, path, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        },
        (res) => {
          let raw = '';
          res.on('data', c => (raw += c));
          res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }); });
        }
      );
      req.on('error', e => { server.close(); reject(e); });
      req.write(data);
      req.end();
    });
  });
}

describe('POST /user/send-password-reset (Bug 1 — shared mailer path)', () => {
  beforeEach(() => {
    mockResendSend.mockReset();
    mockGeneratePasswordResetLink.mockReset();
    mockGeneratePasswordResetLink.mockResolvedValue('https://aivorah.firebaseapp.com/__/auth/action?oobCode=abc123&mode=resetPassword');
  });

  test('returns 200 ok:true when the reset link generates and the email actually sends', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const app = makeApp();
    const res = await post(app, '/user/send-password-reset', { email: 'realuser@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
  }, 15000);

  test('returns 500 (not a false 200) when the email provider fails to actually send', async () => {
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'Resend API down' } });
    const app = makeApp();
    const res = await post(app, '/user/send-password-reset', { email: 'realuser@example.com' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Resend API down/);
  }, 20000);

  test('returns 400 when email is missing (route-level validation, unaffected by the mailer fix)', async () => {
    const app = makeApp();
    const res = await post(app, '/user/send-password-reset', {});
    expect(res.status).toBe(400);
    expect(mockGeneratePasswordResetLink).not.toHaveBeenCalled();
  });
});
