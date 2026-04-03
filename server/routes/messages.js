const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');

// ── GET /messages/unread-count?userEmail= ───────────────
// Returns total unread count + latest unread message for bell notification

router.get('/unread-count', async (req, res) => {
  try {
    const userEmail = (req.query.userEmail || '').trim().toLowerCase();
    if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

    const { data, error } = await supabase
      .from('messages')
      .select('id, sender_name, sender_email, content, created_at')
      .eq('recipient_email', userEmail)
      .is('read_at', null)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const msgs = data ?? [];
    res.json({
      count:  msgs.length,
      latest: msgs.length > 0 ? {
        senderName:  msgs[0].sender_name,
        senderEmail: msgs[0].sender_email,
        preview:     msgs[0].content.substring(0, 60),
        createdAt:   msgs[0].created_at,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /messages/read?userEmail=&otherEmail= ──────────
// Mark all messages from otherEmail → userEmail as read
// MUST be defined before /:id so Express doesn't swallow "read" as an id param

router.patch('/read', async (req, res) => {
  try {
    const userEmail  = (req.query.userEmail  || '').trim().toLowerCase();
    const otherEmail = (req.query.otherEmail || '').trim().toLowerCase();
    if (!userEmail || !otherEmail) return res.status(400).json({ error: 'userEmail and otherEmail required' });

    const { error } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('sender_email', otherEmail)
      .eq('recipient_email', userEmail)
      .is('read_at', null);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /messages/:id ──────────────────────────────────
// Edit a sent message (only sender can edit)

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { senderEmail, content } = req.body;
    if (!senderEmail || !content) return res.status(400).json({ error: 'senderEmail and content required' });

    const { data, error } = await supabase
      .from('messages')
      .update({ content: content.trim(), is_edited: true })
      .eq('id', id)
      .eq('sender_email', senderEmail.toLowerCase().trim())
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Message not found or not yours' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /messages/contacts?userEmail= ───────────────────
// Returns list of people this user can message:
//   parent  → teachers of their children
//   teacher → parents of their students

router.get('/contacts', async (req, res) => {
  try {
    const userEmail = (req.query.userEmail || '').trim().toLowerCase();
    if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

    // Look up the user's id, role, and school
    const { data: me, error: meErr } = await supabase
      .from('users')
      .select('id, role, name, school')
      .eq('email', userEmail)
      .single();

    if (meErr || !me) return res.status(404).json({ error: 'User not found' });

    if (me.role === 'parent') {
      // 1. Get parent's children
      const { data: links } = await supabase
        .from('parent_children')
        .select('child_id, users!parent_children_child_id_fkey(id, name)')
        .eq('parent_email', userEmail);

      if (!links || links.length === 0) return res.json([]);

      const childIds   = links.map(l => l.child_id);
      const childNames = {};
      links.forEach(l => { childNames[l.child_id] = l.users?.name || 'Your child'; });

      // 2. Find teachers assigned to those children via teacher_student table
      const { data: tsLinks } = await supabase
        .from('teacher_student')
        .select('teacher_id, student_id')
        .in('student_id', childIds);

      if (!tsLinks || tsLinks.length === 0) return res.json([]);

      // Map teacher_id → [child names they teach from this parent]
      const teacherChildMap = {};
      tsLinks.forEach(ts => {
        if (!teacherChildMap[ts.teacher_id]) teacherChildMap[ts.teacher_id] = [];
        const cname = childNames[ts.student_id];
        if (cname) teacherChildMap[ts.teacher_id].push(cname);
      });

      const teacherIds = Object.keys(teacherChildMap);

      // 3. Get teacher user details
      const { data: teachers } = await supabase
        .from('users')
        .select('id, name, email')
        .in('id', teacherIds);

      const contacts = (teachers || []).map(t => ({
        id:      t.id,
        name:    t.name || t.email,
        email:   t.email,
        role:    'teacher',
        context: `Teacher of ${[...new Set(teacherChildMap[t.id] || [])].join(', ')}`,
      }));

      return res.json(contacts);
    }

    if (me.role === 'teacher') {
      // 1. Get students this teacher is assigned to via teacher_student table
      const { data: tsLinks } = await supabase
        .from('teacher_student')
        .select('student_id')
        .eq('teacher_id', me.id);

      if (!tsLinks || tsLinks.length === 0) return res.json([]);

      const studentIds = tsLinks.map(ts => ts.student_id);

      // 2. Get student names
      const { data: students } = await supabase
        .from('users')
        .select('id, name')
        .in('id', studentIds);

      const studentNames = {};
      (students || []).forEach(s => { studentNames[s.id] = s.name; });

      // 3. Get parent links for those students
      const { data: parentLinks } = await supabase
        .from('parent_children')
        .select('parent_email, child_id')
        .in('child_id', studentIds);

      if (!parentLinks || parentLinks.length === 0) return res.json([]);

      // Build parent_email → child names
      const parentChildMap = {};
      parentLinks.forEach(p => {
        if (!parentChildMap[p.parent_email]) parentChildMap[p.parent_email] = [];
        const cname = studentNames[p.child_id];
        if (cname) parentChildMap[p.parent_email].push(cname);
      });

      const parentEmails = Object.keys(parentChildMap);

      // 4. Get parent user details
      const { data: parents } = await supabase
        .from('users')
        .select('id, name, email')
        .in('email', parentEmails);

      const contacts = (parents || []).map(p => ({
        id:      p.id,
        name:    p.name || p.email,
        email:   p.email,
        role:    'parent',
        context: `Parent of ${[...new Set(parentChildMap[p.email] || [])].join(', ')}`,
      }));

      return res.json(contacts);
    }

    res.json([]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /messages/conversations?userEmail= ───────────────
// Returns all unique conversation threads for a user
router.get('/conversations', async (req, res) => {
  try {
    const userEmail = (req.query.userEmail || '').trim().toLowerCase();
    if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

    // Get all messages where user is sender or recipient
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_email.eq.${userEmail},recipient_email.eq.${userEmail}`)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Group into threads — keyed by the other person's email
    const threadMap = {};
    (data ?? []).forEach(msg => {
      const otherEmail = msg.sender_email === userEmail ? msg.recipient_email : msg.sender_email;
      const otherName  = msg.sender_email === userEmail ? msg.recipient_name  : msg.sender_name;
      const otherRole  = msg.sender_email === userEmail ? msg.recipient_role  : msg.sender_role;

      if (!threadMap[otherEmail]) {
        threadMap[otherEmail] = {
          otherEmail,
          otherName,
          otherRole,
          lastMessage: msg.content,
          lastMessageAt: msg.created_at,
          unreadCount: 0,
        };
      }
      // Count unread messages sent TO this user
      if (msg.recipient_email === userEmail && !msg.read_at) {
        threadMap[otherEmail].unreadCount += 1;
      }
    });

    res.json(Object.values(threadMap));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /messages/thread?userEmail=&otherEmail= ──────────
// Returns all messages in a conversation thread
router.get('/thread', async (req, res) => {
  try {
    const userEmail  = (req.query.userEmail  || '').trim().toLowerCase();
    const otherEmail = (req.query.otherEmail || '').trim().toLowerCase();
    if (!userEmail || !otherEmail) return res.status(400).json({ error: 'userEmail and otherEmail required' });

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(
        `and(sender_email.eq.${userEmail},recipient_email.eq.${otherEmail}),` +
        `and(sender_email.eq.${otherEmail},recipient_email.eq.${userEmail})`
      )
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /messages ────────────────────────────────────────
// Send a message
router.post('/', async (req, res) => {
  try {
    const {
      senderEmail, senderName, senderRole,
      recipientEmail, recipientName,
      content, studentId, studentName,
    } = req.body;

    if (!senderEmail || !recipientEmail || !content) {
      return res.status(400).json({ error: 'senderEmail, recipientEmail, content required' });
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        sender_email:    senderEmail.toLowerCase().trim(),
        sender_name:     senderName || senderEmail,
        sender_role:     senderRole,
        recipient_email: recipientEmail.toLowerCase().trim(),
        recipient_name:  recipientName || recipientEmail,
        content:         content.trim(),
        student_id:      studentId || null,
        student_name:    studentName || null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
