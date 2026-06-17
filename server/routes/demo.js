const express = require('express');
const crypto = require('crypto');
const supabase = require('../services/supabase');
const gcal = require('../services/gcal');
const { sendDemoRequestToFounder, sendDemoConfirmation } = require('../services/mailer');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FOUNDER_INBOX = process.env.CONTACT_INBOX || process.env.EMAIL_USER || 'aivorah24@gmail.com';

function baseUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0d0d0d;color:#f5f3ee;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
    .card{width:100%;max-width:460px;background:#161616;border:1px solid rgba(245,243,238,0.14);border-radius:18px;padding:32px}
    h1{font-size:22px;margin:0 0 6px}
    p{color:#a7a39b;font-size:14px;line-height:1.6;margin:0 0 18px}
    label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#a7a39b;margin:14px 0 6px}
    input,select{width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(245,243,238,0.18);border-radius:10px;padding:11px 13px;color:#f5f3ee;font-size:14px}
    input[type=datetime-local]{color-scheme:dark}
    .dur{display:flex;gap:8px}
    .dur-opt{flex:1;margin:0}
    .dur-opt input{position:absolute;opacity:0;pointer-events:none}
    .dur-opt span{display:block;text-align:center;padding:11px 0;border:1px solid rgba(245,243,238,0.18);border-radius:10px;color:#f5f3ee;font-size:14px;cursor:pointer;transition:all .15s}
    .dur-opt span:hover{border-color:#BAA467}
    .dur-opt input:checked+span{background:#B7CBB0;color:#0b0b0b;border-color:#B7CBB0;font-weight:700}
    .meta{background:rgba(255,255,255,0.04);border-radius:10px;padding:14px;font-size:13.5px;line-height:1.7;margin-bottom:8px}
    .meta b{color:#f5f3ee}
    button{width:100%;margin-top:20px;background:#B7CBB0;color:#0b0b0b;border:0;border-radius:999px;padding:13px;font-size:15px;font-weight:700;cursor:pointer}
    .muted{color:#7e7a72;font-size:12px;margin-top:14px}
    a{color:#BAA467}
  </style></head><body><div class="card">${body}</div></body></html>`;
}

// ── Public: visitor submits a demo request ───────────────────────────────────
router.post('/api/demo-request', async (req, res) => {
  try {
    const { name, email, school, role, size, slot, message } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });
    if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'Please enter a valid email address.' });

    // Parse the requested slot (ISO with IST offset). Optional — visitor may skip it.
    let requested_slot = null, preferred_times = null;
    if (slot) {
      const d = new Date(String(slot));
      if (!isNaN(d.getTime())) {
        requested_slot = d.toISOString();
        preferred_times = d.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short',
          hour: 'numeric', minute: '2-digit', hour12: true,
        }) + ' IST';
      }
    }

    const confirm_token = crypto.randomBytes(24).toString('hex');
    const record = {
      name: String(name).slice(0, 120),
      email: String(email).slice(0, 200),
      school: school ? String(school).slice(0, 200) : null,
      role: role ? String(role).slice(0, 120) : null,
      team_size: size ? String(size).slice(0, 60) : null,
      preferred_times,
      requested_slot,
      message: message ? String(message).slice(0, 4000) : null,
      status: 'pending',
      confirm_token,
    };

    const { error } = await supabase.from('demo_requests').insert(record);
    if (error) throw new Error(error.message);

    const confirmUrl = `${baseUrl(req)}/demo/confirm?token=${confirm_token}`;
    // Email the founder (don't fail the request if email hiccups)
    sendDemoRequestToFounder({ inbox: FOUNDER_INBOX, req: { ...record }, confirmUrl })
      .catch(err => console.warn('[demo] founder notify failed:', err.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('[demo] request failed:', err.message);
    res.status(500).json({ error: 'Could not submit your request. Please try again later.' });
  }
});

// ── Founder: review & confirm page (secure link) ─────────────────────────────
router.get('/demo/confirm', async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).send(page('Invalid link', '<h1>Invalid link</h1><p>This confirmation link is missing its token.</p>'));

  const { data: r } = await supabase.from('demo_requests').select('*').eq('confirm_token', token).maybeSingle();
  if (!r) return res.status(404).send(page('Not found', '<h1>Request not found</h1><p>This link is no longer valid.</p>'));

  if (r.status === 'confirmed') {
    return res.send(page('Already confirmed', `<h1>Already confirmed</h1>
      <p>This demo with <b>${esc(r.name)}</b> was confirmed for <b>${esc(r.scheduled_at ? new Date(r.scheduled_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '')}</b>.</p>
      ${r.meet_link ? `<p>Meet link: <a href="${esc(r.meet_link)}">${esc(r.meet_link)}</a></p>` : ''}`));
  }

  // Pre-fill with the visitor's requested slot if they picked one; else tomorrow 11:00 IST.
  const pad = (n) => String(n).padStart(2, '0');
  // Build a datetime-local value (YYYY-MM-DDTHH:mm) expressed in IST.
  const toIstLocal = (date) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date).reduce((o, x) => (o[x.type] = x.value, o), {});
    return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
  };
  const defVal = r.requested_slot
    ? toIstLocal(new Date(r.requested_slot))
    : (() => { const d = new Date(Date.now() + 24 * 3600 * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T11:00`; })();

  res.send(page('Confirm demo', `
    <h1>Confirm demo</h1>
    <p>Set a time and we'll email <b>${esc(r.name)}</b> a Google Meet invite.</p>
    <div class="meta">
      <div><b>${esc(r.name)}</b> · ${esc(r.email)}</div>
      ${r.school ? `<div>School: ${esc(r.school)}</div>` : ''}
      ${r.role ? `<div>Role: ${esc(r.role)}</div>` : ''}
      ${r.team_size ? `<div>Students: ${esc(r.team_size)}</div>` : ''}
      ${r.preferred_times ? `<div>Prefers: ${esc(r.preferred_times)}</div>` : ''}
      ${r.message ? `<div style="margin-top:6px;color:#a7a39b">"${esc(r.message)}"</div>` : ''}
    </div>
    <form method="POST" action="/demo/confirm">
      <input type="hidden" name="token" value="${esc(token)}">
      <label>Date &amp; time (IST)</label>
      <input type="datetime-local" name="scheduled_at" value="${defVal}" required>
      <label>Duration</label>
      <div class="dur">
        <label class="dur-opt"><input type="radio" name="duration" value="30" checked><span>30 min</span></label>
        <label class="dur-opt"><input type="radio" name="duration" value="45"><span>45 min</span></label>
        <label class="dur-opt"><input type="radio" name="duration" value="60"><span>60 min</span></label>
      </div>
      <button type="submit">Confirm &amp; send invite</button>
    </form>
    <p class="muted">${gcal.isConfigured() ? 'A Google Meet link will be generated automatically.' : 'Note: Google Calendar is not configured — the visitor will get a calendar invite (.ics) without a live Meet link. Add Google OAuth env vars to enable Meet.'}</p>
  `));
});

// ── Founder: submit confirmation ─────────────────────────────────────────────
router.post('/demo/confirm', async (req, res) => {
  try {
    const token = String(req.body.token || '');
    const scheduledRaw = String(req.body.scheduled_at || '');
    const duration = Math.min(180, Math.max(15, parseInt(req.body.duration, 10) || 30));
    if (!token || !scheduledRaw) return res.status(400).send(page('Missing info', '<h1>Missing info</h1><p>Please go back and set a time.</p>'));

    const { data: r } = await supabase.from('demo_requests').select('*').eq('confirm_token', token).maybeSingle();
    if (!r) return res.status(404).send(page('Not found', '<h1>Request not found</h1>'));
    if (r.status === 'confirmed') return res.send(page('Already confirmed', '<h1>Already confirmed</h1><p>This demo was already confirmed.</p>'));

    // datetime-local has no timezone — interpret as IST (+05:30)
    const startISO = new Date(scheduledRaw + ':00+05:30').toISOString();
    const whenText = new Date(startISO).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }) + ' IST';

    const summary = `Aivorah demo · ${r.name}${r.school ? ' (' + r.school + ')' : ''}`;
    const description = `Aivorah product demo.\n\nContact: ${r.name} <${r.email}>` +
      (r.school ? `\nSchool: ${r.school}` : '') + (r.role ? `\nRole: ${r.role}` : '') +
      (r.message ? `\n\nNote: ${r.message}` : '');

    let meetLink = null, eventId = null;
    if (gcal.isConfigured()) {
      try {
        const ev = await gcal.createMeetEvent({
          summary, description, startISO, durationMinutes: duration,
          attendees: [r.email, FOUNDER_INBOX],
        });
        meetLink = ev.meetLink; eventId = ev.eventId;
      } catch (err) {
        console.warn('[demo] gcal event failed, falling back to .ics:', err.message);
      }
    }

    const ics = gcal.buildIcs({
      summary, description: description + (meetLink ? `\n\nJoin: ${meetLink}` : ''),
      startISO, durationMinutes: duration, organizerEmail: FOUNDER_INBOX,
      attendeeEmail: r.email, location: meetLink || 'Google Meet',
    });

    await supabase.from('demo_requests').update({
      status: 'confirmed', scheduled_at: startISO, duration_minutes: duration,
      meet_link: meetLink, calendar_event_id: eventId, confirmed_at: new Date().toISOString(),
    }).eq('confirm_token', token);

    await sendDemoConfirmation({
      to: r.email, name: r.name, whenText, meetLink,
      founderEmail: FOUNDER_INBOX, icsContent: ics,
    }).catch(err => console.warn('[demo] confirmation email failed:', err.message));

    res.send(page('Confirmed', `<h1>Demo confirmed ✓</h1>
      <p>We've emailed <b>${esc(r.name)}</b> the details for <b>${esc(whenText)}</b>.</p>
      ${meetLink ? `<p>Meet link: <a href="${esc(meetLink)}">${esc(meetLink)}</a></p>` : '<p class="muted">No Meet link (Google Calendar not configured) — an .ics invite was sent instead.</p>'}`));
  } catch (err) {
    console.error('[demo] confirm failed:', err.message);
    res.status(500).send(page('Error', '<h1>Something went wrong</h1><p>Please try again.</p>'));
  }
});

module.exports = router;
