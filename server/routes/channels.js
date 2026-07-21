/**
 * Group / class chat channels (Toddle-style) — dedicated to group rooms with a
 * member roster + posting rule. Completely separate from the 1:1 `messages`
 * table, so direct messaging is never touched.
 *   • posting 'staff_only' → only teachers/admins/managers post (broadcast).
 *   • posting 'members'    → any member posts (family channels).
 * Identity re-derived server-side via services/classAccess.getUserContext.
 */
const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const { getUserContext } = require('../services/classAccess');

const STAFF_ROLES = ['teacher', 'school_admin', 'super_admin'];
const isStaff = (role) => STAFF_ROLES.includes(role);
// Toddle shows a staff member's real role ("Teacher", "School Administrator"),
// never a generic "School staff" — this is what a member row's label should read.
const staffRoleLabel = (role) => (role === 'teacher' ? 'Teacher' : role === 'super_admin' ? 'Super Admin' : 'School Administrator');

async function membership(channelId, email) {
  const { data } = await supabase
    .from('chat_channel_members')
    .select('id, is_manager, role_label')
    .eq('channel_id', channelId).eq('user_email', email).maybeSingle();
  return data || null;
}
function canPost(channel, userCtx, member) {
  if (!member) return false;
  if (channel.posting === 'staff_only') return isStaff(userCtx.role) || member.is_manager;
  return true;
}
async function nameMap(emails) {
  const distinct = [...new Set(emails.filter(Boolean))];
  const map = new Map();
  if (!distinct.length) return map;
  const { data } = await supabase.from('users').select('email, name').in('email', distinct);
  for (const u of data || []) map.set(u.email, u.name);
  return map;
}
function postingNote(channel) {
  return channel.posting === 'staff_only' ? 'Only admins and teachers can send messages in this channel' : null;
}

// GET /channels?email=  — the channels this user belongs to
router.get('/', async (req, res) => {
  try {
    const userCtx = await getUserContext(req.query.email);
    if (!userCtx) return res.status(401).json({ error: 'Unknown user' });

    const { data: mine } = await supabase
      .from('chat_channel_members').select('channel_id, is_manager').eq('user_email', userCtx.email);
    const ids = (mine || []).map((m) => m.channel_id);
    if (!ids.length) return res.json([]);
    const mgrMap = new Map((mine || []).map((m) => [m.channel_id, m.is_manager]));

    const { data: channels } = await supabase
      .from('chat_channels').select('*').in('id', ids);
    const { data: allMembers } = await supabase
      .from('chat_channel_members').select('channel_id').in('channel_id', ids);
    const memberCount = new Map();
    for (const m of allMembers || []) memberCount.set(m.channel_id, (memberCount.get(m.channel_id) || 0) + 1);

    const { data: reads } = await supabase
      .from('chat_channel_reads').select('channel_id, last_read_at').eq('user_email', userCtx.email).in('channel_id', ids);
    const readAt = new Map((reads || []).map((r) => [r.channel_id, r.last_read_at]));

    // Last message + unread per channel (fetch recent messages for these channels).
    const { data: msgs } = await supabase
      .from('chat_channel_messages').select('channel_id, sender_email, body, created_at')
      .in('channel_id', ids).order('created_at', { ascending: false }).limit(600);
    const lastMsg = new Map();
    const unread = new Map();
    for (const m of msgs || []) {
      if (!lastMsg.has(m.channel_id)) lastMsg.set(m.channel_id, m);
      const since = readAt.get(m.channel_id);
      if (m.sender_email !== userCtx.email && (!since || new Date(m.created_at) > new Date(since))) {
        unread.set(m.channel_id, (unread.get(m.channel_id) || 0) + 1);
      }
    }

    const out = (channels || []).map((c) => ({
      id: c.id, name: c.name, category: c.category, iconLabel: c.icon_label || (c.name || '?').slice(0, 4).toUpperCase(),
      grade: c.grade, section: c.section, posting: c.posting,
      memberCount: memberCount.get(c.id) || 0,
      unread: unread.get(c.id) || 0,
      lastMessage: lastMsg.get(c.id) ? { body: lastMsg.get(c.id).body, at: lastMsg.get(c.id).created_at } : null,
      canPost: canPost(c, userCtx, { is_manager: mgrMap.get(c.id) }),
      postingNote: postingNote(c),
      isManager: !!mgrMap.get(c.id) || isStaff(userCtx.role),
    })).sort((a, b) => new Date(b.lastMessage?.at || 0) - new Date(a.lastMessage?.at || 0));

    res.json(out);
  } catch (err) {
    console.error('[GET /channels] error:', err.message);
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

// GET /channels/:id/messages?email=
router.get('/:id/messages', async (req, res) => {
  try {
    const userCtx = await getUserContext(req.query.email);
    if (!userCtx) return res.status(401).json({ error: 'Unknown user' });
    const member = await membership(req.params.id, userCtx.email);
    if (!member) return res.status(403).json({ error: 'Not a member of this channel' });

    const { data: channel } = await supabase.from('chat_channels').select('*').eq('id', req.params.id).maybeSingle();
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const { data: msgs } = await supabase
      .from('chat_channel_messages').select('id, sender_email, body, created_at')
      .eq('channel_id', req.params.id).order('created_at', { ascending: true }).limit(500);
    const names = await nameMap((msgs || []).map((m) => m.sender_email));

    res.json({
      channel: { id: channel.id, name: channel.name, posting: channel.posting, postingNote: postingNote(channel) },
      canPost: canPost(channel, userCtx, member),
      messages: (msgs || []).map((m) => ({
        id: m.id, body: m.body, at: m.created_at,
        senderEmail: m.sender_email, senderName: names.get(m.sender_email) || m.sender_email,
        mine: m.sender_email === userCtx.email,
      })),
    });
  } catch (err) {
    console.error('[GET /channels/:id/messages] error:', err.message);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /channels/:id/messages { email, body }
router.post('/:id/messages', async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message cannot be empty' });
  try {
    const userCtx = await getUserContext(req.body?.email);
    if (!userCtx) return res.status(401).json({ error: 'Unknown user' });
    const { data: channel } = await supabase.from('chat_channels').select('*').eq('id', req.params.id).maybeSingle();
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const member = await membership(req.params.id, userCtx.email);
    if (!canPost(channel, userCtx, member)) return res.status(403).json({ error: 'You cannot post in this channel' });

    const { data, error } = await supabase.from('chat_channel_messages')
      .insert({ channel_id: req.params.id, sender_email: userCtx.email, body }).select('id, created_at').single();
    if (error) throw error;
    await supabase.from('chat_channels').update({ updated_at: new Date().toISOString() }).eq('id', req.params.id);
    res.status(201).json({ ok: true, id: data.id, at: data.created_at });
  } catch (err) {
    console.error('[POST /channels/:id/messages] error:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /channels/:id/members?email=
router.get('/:id/members', async (req, res) => {
  try {
    const userCtx = await getUserContext(req.query.email);
    if (!userCtx) return res.status(401).json({ error: 'Unknown user' });
    if (!(await membership(req.params.id, userCtx.email))) return res.status(403).json({ error: 'Not a member' });

    const { data: members } = await supabase
      .from('chat_channel_members').select('user_email, role_label, is_manager').eq('channel_id', req.params.id);
    const names = await nameMap((members || []).map((m) => m.user_email));
    res.json((members || []).map((m) => ({
      email: m.user_email, name: names.get(m.user_email) || m.user_email,
      roleLabel: m.role_label || null, isManager: m.is_manager,
      you: m.user_email === userCtx.email,
    })));
  } catch (err) {
    console.error('[GET /channels/:id/members] error:', err.message);
    res.status(500).json({ error: 'Failed to load members' });
  }
});

// POST /channels/:id/read { email }
router.post('/:id/read', async (req, res) => {
  try {
    const userCtx = await getUserContext(req.body?.email);
    if (!userCtx) return res.status(401).json({ error: 'Unknown user' });
    await supabase.from('chat_channel_reads').upsert(
      { channel_id: req.params.id, user_email: userCtx.email, last_read_at: new Date().toISOString() },
      { onConflict: 'channel_id,user_email' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /channels/:id/read] error:', err.message);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

const { buildGradesSectionsView } = require('../services/academicStructure');

// GET /channels/grades-sections?email=  — grade/section list for the create-
// channel dropdown, scoped to the caller's own school. Any staff member (not
// just admins) can read this so teachers can scope auto-add correctly. Also
// returns `myHomerooms` so the UI can pre-select the caller's own class
// instead of asking a class teacher to re-enter a grade/section we already
// know from academic_structure.
router.get('/grades-sections', async (req, res) => {
  const gate = await requireStaff(req.query.email);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
  try {
    const grades = await buildGradesSectionsView(gate.userCtx.school_id);
    const list = grades.filter((g) => !g.archived).map((g) => ({
      name: g.name, sections: g.sections.filter((s) => !s.archived).map((s) => s.name),
    }));
    const myHomerooms = [];
    for (const g of grades) {
      if (g.archived) continue;
      for (const s of g.sections) {
        if (!s.archived && s.classTeacherEmail && s.classTeacherEmail.toLowerCase() === gate.userCtx.email.toLowerCase()) {
          myHomerooms.push({ grade: g.name, section: s.name });
        }
      }
    }
    res.json({ grades: list, myHomerooms });
  } catch (err) {
    console.error('[GET /channels/grades-sections] error:', err.message);
    res.status(500).json({ error: 'Failed to load grades & sections' });
  }
});

// GET /channels/my-students?email=  — students this teacher is linked to via
// teacher_student, for the "Create Family Room" student picker.
router.get('/my-students', async (req, res) => {
  const gate = await requireStaff(req.query.email);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
  try {
    const { data: teacher } = await supabase.from('users').select('id').eq('email', gate.userCtx.email).maybeSingle();
    if (!teacher) return res.json([]);
    const { data: links } = await supabase.from('teacher_student').select('student_id').eq('teacher_id', teacher.id);
    const ids = [...new Set((links || []).map((l) => l.student_id))];
    if (!ids.length) return res.json([]);
    const { data: students } = await supabase.from('users').select('id, name, grade, section').in('id', ids).order('name');
    res.json(students || []);
  } catch (err) {
    console.error('[GET /channels/my-students] error:', err.message);
    res.status(500).json({ error: 'Failed to load students' });
  }
});

// GET /channels/people?email=&grade=&section=&q=  — WhatsApp-style combined
// search over students AND their parents at the caller's school, for
// building a group one person at a time. grade/section narrow the pool
// (e.g. "Grade 3 A"); q filters by name; both optional.
router.get('/people', async (req, res) => {
  const gate = await requireStaff(req.query.email);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
  try {
    let studentQuery = supabase.from('users').select('id, name, email, grade, section')
      .eq('school_id', gate.userCtx.school_id).eq('role', 'student').order('name').limit(200);
    if (req.query.grade) studentQuery = studentQuery.eq('grade', String(req.query.grade));
    if (req.query.section) studentQuery = studentQuery.eq('section', String(req.query.section));
    const { data: students } = await studentQuery;
    const studentIds = (students || []).map((s) => s.id);
    const nameById = new Map((students || []).map((s) => [s.id, s.name]));

    const { data: parentLinks } = studentIds.length
      ? await supabase.from('parent_children').select('parent_email, child_id').in('child_id', studentIds)
      : { data: [] };
    const parentEmails = [...new Set((parentLinks || []).map((p) => String(p.parent_email).toLowerCase().trim()).filter(Boolean))];
    const { data: parentUsers } = parentEmails.length
      ? await supabase.from('users').select('email, name').in('email', parentEmails)
      : { data: [] };
    const parentNameByEmail = new Map((parentUsers || []).map((u) => [u.email.toLowerCase(), u.name]));

    const people = [];
    for (const s of students || []) {
      if (!s.email) continue; // only addable if they have a login identity
      people.push({ email: s.email, name: s.name, roleLabel: `Student • ${s.grade || ''}${s.section ? ' ' + s.section : ''}`.trim() });
    }
    for (const l of parentLinks || []) {
      const em = String(l.parent_email).toLowerCase().trim();
      if (!em) continue;
      const childName = nameById.get(l.child_id) || 'student';
      people.push({ email: em, name: parentNameByEmail.get(em) || em, roleLabel: `Family member of ${childName}` });
    }

    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
    // De-dupe (a parent with two kids in the same pool would otherwise repeat).
    const seen = new Set();
    const result = filtered.filter((p) => (seen.has(p.email) ? false : (seen.add(p.email), true)));
    res.json(result.slice(0, 100));
  } catch (err) {
    console.error('[GET /channels/people] error:', err.message);
    res.status(500).json({ error: 'Failed to search people' });
  }
});

// POST /channels/family  { email, studentId }
// One-click "Family of <Student>" room: student + all linked parents + the
// requesting teacher, posting: 'members' (everyone can post, Toddle-style).
// Reuses an existing family room for that student+teacher pair if one exists.
router.post('/family', async (req, res) => {
  const gate = await requireStaff(req.body?.email);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
  const studentId = req.body?.studentId;
  if (!studentId) return res.status(400).json({ error: 'studentId is required' });
  try {
    const { data: student } = await supabase.from('users').select('id, name, grade, section, school_id').eq('id', studentId).maybeSingle();
    if (!student || student.school_id !== gate.userCtx.school_id) return res.status(404).json({ error: 'Student not found' });

    const channelName = `Family of ${student.name}`;
    const { data: existing } = await supabase.from('chat_channels')
      .select('id').eq('school_id', gate.userCtx.school_id).eq('name', channelName).eq('created_by', gate.userCtx.email).maybeSingle();
    if (existing) return res.json({ ok: true, id: existing.id, reused: true });

    const { data: ch, error } = await supabase.from('chat_channels').insert({
      school_id: gate.userCtx.school_id, name: channelName, category: 'class',
      grade: student.grade || null, section: student.section || null,
      posting: 'members', icon_label: student.name.slice(0, 4), created_by: gate.userCtx.email,
    }).select('id').single();
    if (error) throw error;

    const memberRows = new Map();
    memberRows.set(gate.userCtx.email, { role_label: staffRoleLabel(gate.userCtx.role), is_manager: true });

    const { data: parentLinks } = await supabase.from('parent_children').select('parent_email').eq('child_id', student.id);
    for (const p of parentLinks || []) {
      const em = String(p.parent_email).toLowerCase().trim();
      if (em && !memberRows.has(em)) memberRows.set(em, { role_label: `Family member of ${student.name}`, is_manager: false });
    }

    // Toddle's Family Room = teacher + parents only, never the student
    // themselves — confirmed against a live Toddle screenshot (Members(3):
    // 2 parents + teacher, no student row).

    const rows = [...memberRows.entries()].map(([email, v]) => ({ channel_id: ch.id, user_email: email, role_label: v.role_label, is_manager: v.is_manager }));
    if (rows.length) await supabase.from('chat_channel_members').insert(rows);

    res.status(201).json({ ok: true, id: ch.id, memberCount: rows.length });
  } catch (err) {
    console.error('[POST /channels/family] error:', err.message);
    res.status(500).json({ error: 'Failed to create family room' });
  }
});

async function requireStaff(email) {
  const userCtx = await getUserContext(email);
  if (!userCtx || !userCtx.school_id) return { ok: false, code: 401, error: 'Unknown user' };
  if (!isStaff(userCtx.role)) return { ok: false, code: 403, error: 'Only teachers and school admins can manage channels' };
  return { ok: true, userCtx };
}

// POST /channels  { email, name, category?, grade?, section?, posting?, iconLabel?,
//                   memberEmails?: [], autoAddParentsOfGrade?: 'Grade 5' }
// Creates a channel, adds the creator as a manager, plus any listed members and
// (optionally) every parent of a grade in one click.
router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Channel name is required' });
  const gate = await requireStaff(req.body?.email);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
  const schoolId = gate.userCtx.school_id;
  try {
    const { data: ch, error } = await supabase.from('chat_channels').insert({
      school_id: schoolId, name,
      category: ['class', 'public', 'staff'].includes(req.body?.category) ? req.body.category : 'class',
      grade: req.body?.grade || null, section: req.body?.section || null,
      posting: req.body?.posting === 'staff_only' ? 'staff_only' : 'members',
      icon_label: req.body?.iconLabel || null,
      created_by: gate.userCtx.email,
    }).select('id').single();
    if (error) throw error;

    // Build the member set: creator (manager) + explicit emails + auto parents.
    const memberRows = new Map();
    memberRows.set(gate.userCtx.email, { role_label: staffRoleLabel(gate.userCtx.role), is_manager: true });

    for (const e of (Array.isArray(req.body?.memberEmails) ? req.body.memberEmails : [])) {
      const em = String(e).toLowerCase().trim(); if (em) memberRows.set(em, memberRows.get(em) || { role_label: null, is_manager: false });
    }
    // { email, roleLabel } pairs — used by the "Create group" people picker,
    // which already knows each pick's exact label (Student • Grade 3 A /
    // Family member of X) so we don't have to re-derive it.
    for (const m of (Array.isArray(req.body?.members) ? req.body.members : [])) {
      const em = String(m?.email || '').toLowerCase().trim();
      if (em) memberRows.set(em, { role_label: m?.roleLabel || null, is_manager: false });
    }

    async function addParentsOf(ids, nameById) {
      if (!ids.length) return;
      const { data: links } = await supabase.from('parent_children').select('parent_email, child_id').in('child_id', ids);
      for (const l of links || []) {
        const em = String(l.parent_email).toLowerCase().trim();
        if (em && !memberRows.has(em)) memberRows.set(em, { role_label: `Family member of ${nameById.get(l.child_id) || 'student'}`, is_manager: false });
      }
    }

    if (req.body?.autoAddParentsOfGrade) {
      const grade = String(req.body.autoAddParentsOfGrade);
      const section = req.body?.autoAddParentsOfSection ? String(req.body.autoAddParentsOfSection) : null;
      let studentQuery = supabase.from('users')
        .select('id, name').eq('school_id', schoolId).eq('role', 'student').eq('grade', grade);
      if (section) studentQuery = studentQuery.eq('section', section);
      const { data: students } = await studentQuery;
      await addParentsOf((students || []).map((s) => s.id), new Map((students || []).map((s) => [s.id, s.name])));
    }

    // Activity/interest groups (e.g. "Dance Club") — explicit student picks
    // that cut across grades/sections; adds each picked student's parents.
    const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds.filter(Boolean) : [];
    if (studentIds.length) {
      const { data: students } = await supabase.from('users').select('id, name').eq('school_id', schoolId).in('id', studentIds);
      await addParentsOf((students || []).map((s) => s.id), new Map((students || []).map((s) => [s.id, s.name])));
    }

    // "Staff" scope — an internal staff-only room (e.g. "Staff Room"), auto-
    // populated with every teacher + school admin at this school.
    if (req.body?.autoAddAllStaff) {
      const { data: staff } = await supabase.from('users').select('email, role')
        .eq('school_id', schoolId).in('role', ['teacher', 'school_admin']);
      for (const s of staff || []) {
        const em = String(s.email).toLowerCase().trim();
        if (em && !memberRows.has(em)) memberRows.set(em, { role_label: staffRoleLabel(s.role), is_manager: false });
      }
    }

    const rows = [...memberRows.entries()].map(([email, v]) => ({ channel_id: ch.id, user_email: email, role_label: v.role_label, is_manager: v.is_manager }));
    if (rows.length) await supabase.from('chat_channel_members').insert(rows);

    res.status(201).json({ ok: true, id: ch.id, memberCount: rows.length });
  } catch (err) {
    console.error('[POST /channels] error:', err.message);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// POST /channels/:id/members  { email, addEmails: [], roleLabel? }
router.post('/:id/members', async (req, res) => {
  const gate = await requireStaff(req.body?.email);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
  const emails = (Array.isArray(req.body?.addEmails) ? req.body.addEmails : []).map((e) => String(e).toLowerCase().trim()).filter(Boolean);
  if (!emails.length) return res.status(400).json({ error: 'No members to add' });
  try {
    const rows = emails.map((em) => ({ channel_id: req.params.id, user_email: em, role_label: req.body?.roleLabel || null, is_manager: false }));
    // Ignore duplicates (unique channel_id,user_email).
    const { error } = await supabase.from('chat_channel_members').upsert(rows, { onConflict: 'channel_id,user_email', ignoreDuplicates: true });
    if (error) throw error;
    res.json({ ok: true, added: emails.length });
  } catch (err) {
    console.error('[POST /channels/:id/members] error:', err.message);
    res.status(500).json({ error: 'Failed to add members' });
  }
});

module.exports = router;
