// Quick check that Google Calendar/Meet credentials work.
// Run from the server/ directory:  node test_gcal.js
require('dotenv').config();
const { google } = require('googleapis');

(async () => {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  const start = new Date(Date.now() + 3600 * 1000);
  const end = new Date(start.getTime() + 30 * 60000);

  console.log('Creating test event…');
  const res = await calendar.events.insert({
    calendarId,
    conferenceDataVersion: 1,
    requestBody: {
      summary: 'Aivorah — credentials test (safe to ignore)',
      start: { dateTime: start.toISOString(), timeZone: 'Asia/Kolkata' },
      end: { dateTime: end.toISOString(), timeZone: 'Asia/Kolkata' },
      conferenceData: { createRequest: { requestId: 'test-' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    },
  });
  console.log('✅ Event created:', res.data.id);
  console.log('✅ Meet link:', res.data.hangoutLink || '(none returned)');

  await calendar.events.delete({ calendarId, eventId: res.data.id });
  console.log('🧹 Test event deleted. Google Calendar integration is working.');
})().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
