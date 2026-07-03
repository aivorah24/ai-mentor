// ── Expo push notification sender ────────────────────────────────────────────
// Device push tokens are stored per user inside user_preferences.data.expoPushTokens
// (array). This sends notifications to one or more users by email via Expo's
// push service. Safe to call anywhere — it never throws (logs + swallows errors).
const supabase = require('./supabase');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Collect all Expo push tokens registered for the given user emails.
async function getTokensForEmails(emails) {
  const list = (Array.isArray(emails) ? emails : [emails])
    .filter(Boolean)
    .map((e) => String(e).toLowerCase().trim());
  if (list.length === 0) return [];
  try {
    const { data } = await supabase
      .from('user_preferences')
      .select('user_email, data')
      .in('user_email', list);
    const tokens = [];
    (data ?? []).forEach((row) => {
      const arr = row?.data?.expoPushTokens;
      if (Array.isArray(arr)) tokens.push(...arr);
    });
    // Dedupe + keep only valid-looking Expo tokens
    return [...new Set(tokens)].filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
  } catch (err) {
    console.error('[push] getTokensForEmails:', err?.message);
    return [];
  }
}

// Send a push to one or more users (by email). title/body required; data optional
// (used for deep-linking to a screen when the user taps the notification).
async function sendPush(emails, { title, body, data } = {}) {
  try {
    const tokens = await getTokensForEmails(emails);
    if (tokens.length === 0) return { sent: 0 };

    const messages = tokens.map((to) => ({
      to,
      sound: 'default',
      title: title || 'Aivorah',
      body: body || '',
      data: data || {},
      channelId: 'default',
    }));

    // Expo accepts up to 100 messages per request.
    let sent = 0;
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      });
      if (res.ok) sent += chunk.length;
      else console.error('[push] Expo responded', res.status);
    }
    return { sent };
  } catch (err) {
    console.error('[push] sendPush:', err?.message);
    return { sent: 0, error: err?.message };
  }
}

module.exports = { sendPush, getTokensForEmails };
