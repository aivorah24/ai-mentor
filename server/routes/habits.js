const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const { hashEmail } = require('../utils/encryption');
const supabase = require('../services/supabase');

const CONFIG_PATH   = path.join(__dirname, '../data/habits_config.json');
const CHECKIN_PATH  = path.join(__dirname, '../data/habits_checkins.json');

const STREAK_BONUS_DAYS  = 100;
const STREAK_BONUS_COINS = 20;

function readJson(p)       { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function writeJson(p, d)   { fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function todayStr()        { return new Date().toISOString().slice(0, 10); }

// ── Default habits (used when parent hasn't configured yet) ───────────────────
const DEFAULT_HABITS = [
  { id: 'brush_teeth',  label: 'Brush teeth twice',        icon: 'smile',    coins: 5 },
  { id: 'drink_water',  label: 'Drink 2 bottles of water', icon: 'droplet',  coins: 5 },
  { id: 'eat_fruit',    label: 'Eat a fruit today',         icon: 'sun',      coins: 5 },
  { id: 'no_junk',      label: 'No junk food today',        icon: 'shield',   coins: 10 },
  { id: 'sleep_early',  label: 'Sleep by 9pm',              icon: 'moon',     coins: 10 },
  { id: 'exercise',     label: 'Exercise or yoga',          icon: 'activity', coins: 10 },
  { id: 'read_book',    label: 'Read for 20 minutes',       icon: 'book-open',coins: 5 },
  { id: 'wake_early',   label: 'Wake up by 6:30am',         icon: 'sunrise',  coins: 5 },
];

// ── Compute streak for a user ─────────────────────────────────────────────────
function computeStreak(checkins) {
  const dates = Object.keys(checkins).sort().reverse();
  if (!dates.length) return 0;
  let streak = 0;
  let cursor = new Date(todayStr());
  for (const d of dates) {
    const day = new Date(d);
    const diff = Math.round((cursor - day) / 86400000);
    if (diff > 1) break;
    if (checkins[d]?.completed?.length > 0) { streak++; cursor = day; }
  }
  return streak;
}

// ── Auto-generate journal text from today's check-ins ────────────────────────
function generateJournal(completed, habits) {
  if (!completed.length) return '';
  const habitMap = Object.fromEntries(habits.map(h => [h.id, h.label]));
  const items = completed.map(id => habitMap[id]).filter(Boolean);
  if (!items.length) return '';
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const lines = [
    `Today is ${dateStr}.`,
    `I am proud of myself for completing these habits:`,
    ...items.map(i => `• ${i}`),
    `Every small step counts. I am building a better version of myself, one day at a time!`,
  ];
  return lines.join('\n');
}

// ── GET /habits/config?userEmail= ─────────────────────────────────────────────
router.get('/config', (req, res) => {
  const { userEmail } = req.query;
  if (!userEmail) return res.status(400).json({ error: 'userEmail required' });
  const config = readJson(CONFIG_PATH);
  const key = hashEmail(userEmail);
  const userConfig = config[key] ?? config[userEmail] ?? { habits: DEFAULT_HABITS, configuredBy: null };
  res.json(userConfig);
});

// ── POST /habits/config — parent saves habit list ─────────────────────────────
router.post('/config', (req, res) => {
  const { studentEmail, parentEmail, habits } = req.body;
  if (!studentEmail || !habits) return res.status(400).json({ error: 'studentEmail and habits required' });
  const config = readJson(CONFIG_PATH);
  const key = hashEmail(studentEmail);
  // Migrate old plaintext key if present
  if (config[studentEmail] && !config[key]) delete config[studentEmail];
  config[key] = { habits, configuredBy: parentEmail || null, updatedAt: todayStr() };
  writeJson(CONFIG_PATH, config);
  res.json({ success: true });
});

// ── GET /habits/today?userEmail= ──────────────────────────────────────────────
router.get('/today', async (req, res) => {
  const { userEmail } = req.query;
  if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

  const config   = readJson(CONFIG_PATH);
  const checkins = readJson(CHECKIN_PATH);
  const key      = hashEmail(userEmail);
  const habits   = (config[key] ?? config[userEmail])?.habits || DEFAULT_HABITS;
  const today    = todayStr();
  const userCheckins = checkins[key] ?? checkins[userEmail] ?? {};
  const todayData = userCheckins[today] || { completed: [], coinsEarned: 0 };
  const streak    = computeStreak(userCheckins);
  const streakBonus = streak > 0 && streak % STREAK_BONUS_DAYS === 0 ? STREAK_BONUS_COINS : 0;
  const totalCoins = Object.values(userCheckins).reduce((sum, d) => sum + (d.coinsEarned || 0), 0);

  // Fetch parent-assigned tasks for this student
  let parentTasks = [];
  try {
    const { data: userRow } = await supabase.from('users').select('id').eq('email', userEmail.toLowerCase().trim()).maybeSingle();
    if (userRow?.id) {
      const { data: tasks } = await supabase
        .from('parent_daily_tasks')
        .select('id, label, icon, coins')
        .eq('child_id', userRow.id);
      parentTasks = (tasks ?? []).map(t => ({ ...t, fromParent: true }));
    }
  } catch {}

  res.json({
    habits,
    parentTasks,
    today: todayData,
    streak,
    streakBonus,
    totalCoins,
    date: today,
    journalText: todayData.journalText || '',
  });
});

// ── POST /habits/checkin — child checks off a habit (or parent task) ─────────
router.post('/checkin', async (req, res) => {
  const { userEmail, habitId } = req.body;
  if (!userEmail || !habitId) return res.status(400).json({ error: 'userEmail and habitId required' });

  const config   = readJson(CONFIG_PATH);
  const checkins = readJson(CHECKIN_PATH);
  const key      = hashEmail(userEmail);
  const habits   = (config[key] ?? config[userEmail])?.habits || DEFAULT_HABITS;
  let habit      = habits.find(h => h.id === habitId);

  // If not found in local config, check Supabase parent_daily_tasks
  if (!habit) {
    try {
      const { data: pt } = await supabase.from('parent_daily_tasks').select('id, label, icon, coins').eq('id', habitId).maybeSingle();
      if (pt) habit = pt;
    } catch {}
  }
  if (!habit) return res.status(404).json({ error: 'Habit not found' });

  const today = todayStr();
  // Migrate old plaintext key if present
  if (checkins[userEmail] && !checkins[key]) { checkins[key] = checkins[userEmail]; delete checkins[userEmail]; }
  if (!checkins[key]) checkins[key] = {};
  if (!checkins[key][today]) checkins[key][today] = { completed: [], coinsEarned: 0 };

  const todayData = checkins[key][today];

  // Toggle: if already checked, uncheck
  const idx = todayData.completed.indexOf(habitId);
  let coinsChange = 0;
  if (idx >= 0) {
    todayData.completed.splice(idx, 1);
    todayData.coinsEarned = Math.max(0, todayData.coinsEarned - habit.coins);
    coinsChange = -habit.coins;
  } else {
    todayData.completed.push(habitId);
    todayData.coinsEarned += habit.coins;
    coinsChange = habit.coins;
  }

  // Regenerate journal
  todayData.journalText = generateJournal(todayData.completed, habits);

  writeJson(CHECKIN_PATH, checkins);

  const streak = computeStreak(checkins[key]);
  const streakBonus = streak > 0 && streak % STREAK_BONUS_DAYS === 0 ? STREAK_BONUS_COINS : 0;
  const totalCoins = Object.values(checkins[key] || {})
    .reduce((sum, d) => sum + (d.coinsEarned || 0), 0);

  res.json({
    completed: todayData.completed,
    coinsEarned: todayData.coinsEarned,
    coinsChange,
    journalText: todayData.journalText,
    streak,
    streakBonus,
    totalCoins,
    checked: idx < 0,
  });
});

// ── GET /habits/history?userEmail=&days=7 ─────────────────────────────────────
router.get('/history', (req, res) => {
  const { userEmail, days = 7 } = req.query;
  if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

  const checkins = readJson(CHECKIN_PATH);
  const key = hashEmail(userEmail);
  const userCheckins = checkins[key] ?? checkins[userEmail] ?? {};
  const streak = computeStreak(userCheckins);

  // Last N days
  const history = [];
  for (let i = 0; i < Number(days); i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    history.push({
      date: dateKey,
      completed: userCheckins[dateKey]?.completed?.length || 0,
      coinsEarned: userCheckins[dateKey]?.coinsEarned || 0,
    });
  }

  res.json({ history, streak });
});

// ── GET /habits/parent-tasks?childId= ────────────────────────────────────────
// List all tasks a parent has assigned to a child
router.get('/parent-tasks', async (req, res) => {
  try {
    const { childId } = req.query;
    if (!childId) return res.status(400).json({ error: 'childId required' });
    const { data, error } = await supabase
      .from('parent_daily_tasks')
      .select('*')
      .eq('child_id', childId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data ?? []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /habits/parent-tasks ─────────────────────────────────────────────────
// Parent creates a daily task for a child
// Body: { parentEmail, childId, label, icon, coins }
router.post('/parent-tasks', async (req, res) => {
  try {
    const { parentEmail, childId, label, icon = 'check-circle', coins = 5 } = req.body;
    if (!parentEmail || !childId || !label) return res.status(400).json({ error: 'parentEmail, childId and label required' });
    const { data, error } = await supabase
      .from('parent_daily_tasks')
      .insert({ parent_email: parentEmail, child_id: childId, label: label.trim(), icon, coins })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /habits/parent-tasks/:taskId ───────────────────────────────────────
router.delete('/parent-tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { error } = await supabase.from('parent_daily_tasks').delete().eq('id', taskId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
