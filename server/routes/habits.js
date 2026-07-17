const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { sendPush } = require('../services/push');

const STREAK_BONUS_DAYS  = 100;
const STREAK_BONUS_COINS = 20;

function todayStr() { return new Date().toISOString().slice(0, 10); }

// ── Compute streak from array of dated checkin rows ───────────────────────────
function computeStreak(dateSet) {
  // dateSet: Set of date strings where the user completed at least one habit
  const sorted = [...dateSet].sort().reverse();
  if (!sorted.length) return 0;
  let streak = 0;
  let cursor = new Date(todayStr());
  for (const d of sorted) {
    const day  = new Date(d);
    const diff = Math.round((cursor - day) / 86400000);
    if (diff > 1) break;
    streak++; cursor = day;
  }
  return streak;
}

// ── Auto-generate journal from today's checked habits ─────────────────────────
function generateJournal(completedLabels) {
  if (!completedLabels.length) return '';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return [
    `Today is ${dateStr}.`,
    `I am proud of myself for completing these habits:`,
    ...completedLabels.map(l => `• ${l}`),
    `Every small step counts. I am building a better version of myself, one day at a time!`,
  ].join('\n');
}

// ── GET /habits/today?userEmail= ──────────────────────────────────────────────
router.get('/today', async (req, res) => {
  const { userEmail } = req.query;
  if (!userEmail) return res.status(400).json({ error: 'userEmail required' });
  const email = userEmail.toLowerCase().trim();
  const today = todayStr();

  try {
    // 1. Get student's user row
    const { data: userRow } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    const studentId = userRow?.id;

    // 2. Get parent-assigned tasks
    let parentTasks = [];
    if (studentId) {
      const { data: tasks } = await supabase
        .from('parent_daily_tasks')
        .select('id, label, icon, coins')
        .eq('child_id', studentId);
      parentTasks = (tasks ?? []).map(t => ({ ...t, fromParent: true }));
    }

    // 3. Get today's checkins from Supabase
    const { data: checkinRows } = await supabase
      .from('habits_checkins')
      .select('habit_id, checked_at')
      .eq('user_email', email)
      .eq('date', today);

    const completed = (checkinRows ?? []).map(r => r.habit_id);

    // 4. Compute coins earned today
    const allTaskMap = Object.fromEntries(parentTasks.map(t => [t.id, t.coins]));
    const coinsEarned = completed.reduce((sum, id) => sum + (allTaskMap[id] ?? 0), 0);

    // 5. Compute streak — get all distinct dates with checkins
    const { data: allCheckins } = await supabase
      .from('habits_checkins')
      .select('date')
      .eq('user_email', email);
    const dateSet = new Set((allCheckins ?? []).map(r => r.date));
    const streak = computeStreak(dateSet);
    const streakBonus = streak > 0 && streak % STREAK_BONUS_DAYS === 0 ? STREAK_BONUS_COINS : 0;

    // 6. Total coins across all days
    const { data: allPrefs } = await supabase
      .from('student_preferences')
      .select('total_coins')
      .eq('user_email', email)
      .maybeSingle();
    const totalCoins = allPrefs?.total_coins ?? 0;

    // 7. Journal
    const completedLabels = completed.map(id => parentTasks.find(t => t.id === id)?.label).filter(Boolean);
    const journalText = generateJournal(completedLabels);

    res.json({
      habits: [],
      parentTasks,
      today: { completed, coinsEarned },
      streak,
      streakBonus,
      totalCoins,
      date: today,
      journalText,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /habits/checkin ──────────────────────────────────────────────────────
router.post('/checkin', async (req, res) => {
  const { userEmail, habitId } = req.body;
  if (!userEmail || !habitId) return res.status(400).json({ error: 'userEmail and habitId required' });
  const email = userEmail.toLowerCase().trim();
  const today = todayStr();

  try {
    // Look up habit details (parent_daily_tasks)
    const { data: pt } = await supabase.from('parent_daily_tasks').select('id, label, icon, coins').eq('id', habitId).maybeSingle();
    if (!pt) return res.status(404).json({ error: 'Habit not found' });

    // Check if already checked today
    const { data: existing } = await supabase
      .from('habits_checkins')
      .select('id')
      .eq('user_email', email)
      .eq('habit_id', habitId)
      .eq('date', today)
      .maybeSingle();

    let checked = false;
    let coinsChange = 0;

    if (existing) {
      // Uncheck
      await supabase.from('habits_checkins').delete().eq('id', existing.id);
      coinsChange = -pt.coins;
      checked = false;
    } else {
      // Check
      await supabase.from('habits_checkins').insert({ user_email: email, habit_id: habitId, date: today });
      coinsChange = pt.coins;
      checked = true;
    }

    // Get updated completed list for today
    const { data: todayRows } = await supabase
      .from('habits_checkins')
      .select('habit_id')
      .eq('user_email', email)
      .eq('date', today);
    const completed = (todayRows ?? []).map(r => r.habit_id);

    // Get parent tasks for coins calculation
    const { data: userRow } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    let parentTasks = [];
    if (userRow?.id) {
      const { data: tasks } = await supabase.from('parent_daily_tasks').select('id, coins, label').eq('child_id', userRow.id);
      parentTasks = tasks ?? [];
    }
    const allTaskMap = Object.fromEntries(parentTasks.map(t => [t.id, t.coins]));
    const coinsEarned = completed.reduce((sum, id) => sum + (allTaskMap[id] ?? 0), 0);

    // Update total_coins in student_preferences (upsert)
    const { data: prefs } = await supabase.from('student_preferences').select('total_coins').eq('user_email', email).maybeSingle();
    const newTotal = Math.max(0, (prefs?.total_coins ?? 0) + coinsChange);
    await supabase.from('student_preferences').upsert({ user_email: email, total_coins: newTotal, updated_at: new Date().toISOString() }, { onConflict: 'user_email' });

    // Compute streak
    const { data: allDates } = await supabase.from('habits_checkins').select('date').eq('user_email', email);
    const dateSet = new Set((allDates ?? []).map(r => r.date));
    const streak = computeStreak(dateSet);
    const streakBonus = streak > 0 && streak % STREAK_BONUS_DAYS === 0 ? STREAK_BONUS_COINS : 0;

    // Journal
    const completedLabels = completed.map(id => parentTasks.find(t => t.id === id)?.label).filter(Boolean);
    const journalText = generateJournal(completedLabels);

    res.json({ completed, coinsEarned, coinsChange, journalText, streak, streakBonus, totalCoins: newTotal, checked });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /habits/history?userEmail=&days=7 ─────────────────────────────────────
router.get('/history', async (req, res) => {
  const { userEmail, days = 7 } = req.query;
  if (!userEmail) return res.status(400).json({ error: 'userEmail required' });
  const email = userEmail.toLowerCase().trim();

  try {
    const { data: rows } = await supabase
      .from('habits_checkins')
      .select('date, habit_id')
      .eq('user_email', email);

    // Group by date
    const byDate = {};
    for (const r of (rows ?? [])) {
      if (!byDate[r.date]) byDate[r.date] = { count: 0, coins: 0 };
      byDate[r.date].count++;
    }

    const history = [];
    for (let i = 0; i < Number(days); i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dk = d.toISOString().slice(0, 10);
      history.push({ date: dk, completed: byDate[dk]?.count || 0, coinsEarned: byDate[dk]?.coins || 0 });
    }

    const dateSet = new Set(Object.keys(byDate));
    const streak = computeStreak(dateSet);
    res.json({ history, streak });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /habits/parent-tasks?childId= ────────────────────────────────────────
router.get('/parent-tasks', async (req, res) => {
  try {
    const { childId } = req.query;
    if (!childId) return res.status(400).json({ error: 'childId required' });
    const { data, error } = await supabase.from('parent_daily_tasks').select('*').eq('child_id', childId).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const tasks = data ?? [];

    // Mark which tasks the child has completed today so the parent sees live status.
    // habits_checkins.habit_id maps to parent_daily_tasks.id.
    const today = todayStr();
    const taskIds = tasks.map(t => String(t.id));
    let completedSet = new Set();
    if (taskIds.length > 0) {
      const { data: checkins } = await supabase
        .from('habits_checkins')
        .select('habit_id')
        .in('habit_id', taskIds)
        .eq('date', today);
      completedSet = new Set((checkins ?? []).map(c => String(c.habit_id)));
    }
    res.json(tasks.map(t => ({ ...t, completedToday: completedSet.has(String(t.id)) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /habits/parent-tasks ─────────────────────────────────────────────────
router.post('/parent-tasks', async (req, res) => {
  try {
    const { parentEmail, childId, label, icon = 'check-circle', coins = 5 } = req.body;
    if (!parentEmail || !childId || !label) return res.status(400).json({ error: 'parentEmail, childId and label required' });
    const { data, error } = await supabase.from('parent_daily_tasks').insert({ parent_email: parentEmail, child_id: childId, label: label.trim(), icon, coins }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);

    // Notify the child that a new daily task arrived — same bell + push treatment
    // as challenges/assignments. Previously a parent-assigned task landed silently,
    // so the student never knew. Best-effort (non-blocking; never fails the create).
    (async () => {
      try {
        const { data: child } = await supabase.from('users').select('email').eq('id', childId).maybeSingle();
        if (child?.email) {
          await sendPush(child.email, {
            title: 'New daily task',
            body: `Your parent added: ${label.trim()}`,
            data: { type: 'task' },
            prefKey: 'assignmentAlerts',
          });
        }
      } catch (_) { /* best-effort */ }
    })();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /habits/parent-tasks/:taskId ───────────────────────────────────────
router.delete('/parent-tasks/:taskId', async (req, res) => {
  try {
    const { error } = await supabase.from('parent_daily_tasks').delete().eq('id', req.params.taskId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
