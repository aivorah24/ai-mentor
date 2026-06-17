// Google Calendar + Meet integration.
//
// Confirming a demo creates a Google Calendar event with an auto-generated Meet
// link and invites the visitor (Google emails them the invite). If the required
// OAuth env vars are not configured, isConfigured() returns false and callers
// fall back to a plain confirmation email + .ics attachment (no live Meet link).
//
// Required env (one-time setup — see README/notes):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN     (offline refresh token for the founder's account)
//   GOOGLE_CALENDAR_ID       (optional, defaults to "primary")

let google;
try {
  ({ google } = require('googleapis'));
} catch (_) {
  google = null; // package not installed yet — integration disabled
}

function isConfigured() {
  return !!(
    google &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

function getCalendarClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth: oauth2 });
}

// Create an event with a Google Meet link. Returns { meetLink, eventId, htmlLink }.
async function createMeetEvent({ summary, description, startISO, durationMinutes = 30, attendees = [], timeZone = 'Asia/Kolkata' }) {
  if (!isConfigured()) throw new Error('Google Calendar not configured');
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const res = await calendar.events.insert({
    calendarId,
    conferenceDataVersion: 1,
    sendUpdates: 'all', // Google emails the invite to attendees
    requestBody: {
      summary,
      description,
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
      attendees: attendees.filter(Boolean).map(email => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: 'aivorah-' + Date.now(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  });

  const ev = res.data;
  const meetLink =
    ev.hangoutLink ||
    (ev.conferenceData &&
      ev.conferenceData.entryPoints &&
      (ev.conferenceData.entryPoints.find(e => e.entryPointType === 'video') || {}).uri) ||
    null;

  return { meetLink, eventId: ev.id, htmlLink: ev.htmlLink };
}

// Minimal RFC 5545 .ics generator (fallback invite, always attached).
function buildIcs({ summary, description, startISO, durationMinutes = 30, organizerEmail, attendeeEmail, location }) {
  const dt = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const uid = 'aivorah-demo-' + Date.now() + '@aivorah.ai';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aivorah//Demo//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + dt(new Date()),
    'DTSTART:' + dt(start),
    'DTEND:' + dt(end),
    'SUMMARY:' + esc(summary),
    'DESCRIPTION:' + esc(description),
    location ? 'LOCATION:' + esc(location) : null,
    organizerEmail ? 'ORGANIZER;CN=Aivorah:mailto:' + organizerEmail : null,
    attendeeEmail ? 'ATTENDEE;RSVP=TRUE:mailto:' + attendeeEmail : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

module.exports = { isConfigured, createMeetEvent, buildIcs };
