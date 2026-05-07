const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const multer   = require('multer');
const path     = require('path');
const crypto   = require('crypto');

// ── File upload config ──────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = /^(pdf|png|jpg|jpeg|gif|webp)$/; // images and PDFs only (issue #45)

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id  = crypto.randomBytes(8).toString('hex');
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = file.mimetype || '';
    const validExt  = ALLOWED_TYPES.test(ext);
    const validMime = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/.test(mime);
    if (validExt && validMime) return cb(null, true);
    cb(new Error('Only images (JPG, PNG, GIF, WebP) and PDFs are allowed'));
  },
});

// ── GET /messages/unread-count?userEmail= ───────────────
// Returns total unread count + latest unread message for bell notification

const NOTIFICATION_DEBUG = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.NOTIFICATION_DEBUG || '').trim().toLowerCase()
);

function logNotificationDebug(message, meta = {}) {
  if (!NOTIFICATION_DEBUG) return;
  console.log(`[messages.notifications] ${message}`, meta);
}

function toMessagePreview(content) {
  if (typeof content !== 'string') return '';
  const trimmed = content.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const text = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
      if (text) return text.slice(0, 60);
      if (parsed?.attachment?.name) {
        return `Shared a file: ${String(parsed.attachment.name).trim().slice(0, 40)}`;
      }
    } catch (_) {
      // Fall through to plain-text preview.
    }
  }
  return trimmed.slice(0, 60);
}

// GET /messages/unread-count?userEmail=
// Returns total unread count + latest unread message for bell notification
router.get('/unread-count', async (req, res) => {
  try {
    const userEmail = (req.query.userEmail || '').trim().toLowerCase();
    if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

    const { count, error: countError } = await supabase
      .from('messages')
      .select('id', { head: true, count: 'exact' })
      .eq('recipient_email', userEmail)
      .is('read_at', null);

    if (countError) return res.status(500).json({ error: countError.message });

    const safeCount = Number.isFinite(count) ? Number(count) : 0;
    let latest = null;

    if (safeCount > 0) {
      const { data, error } = await supabase
        .from('messages')
        .select('id, sender_name, sender_email, content, created_at')
        .eq('recipient_email', userEmail)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });

      if (data) {
        latest = {
          id: data.id,
          senderName: data.sender_name || data.sender_email || 'Someone',
          senderEmail: data.sender_email || '',
          preview: toMessagePreview(data.content),
          createdAt: data.created_at,
        };
      } else {
        logNotificationDebug('Unread count > 0 but latest unread row is missing', {
          userEmail,
          count: safeCount,
        });
      }
    }

    logNotificationDebug('Unread count resolved', {
      userEmail,
      count: safeCount,
      latestId: latest?.id || null,
    });

    res.json({ count: safeCount, latest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /messages/notifications-summary?userEmail=&studentId=&since= ──────────
// Single endpoint that returns messages + assignments + challenges counts in one round-trip.
// Replaces the three separate polling calls.
router.get('/notifications-summary', async (req, res) => {
  try {
    const userEmail  = (req.query.userEmail  || '').trim().toLowerCase();
    const studentId  = (req.query.studentId  || '').trim();
    const since      = req.query.since || null;

    if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

    // 1. Unread messages count + latest
    const msgCountQ = supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_email', userEmail)
      .is('read_at', null);

    // 2. Latest unread message (only fetched if count > 0, done after)
    // 3. Assignments new-count (resolve user + parallel count queries)
    let userId = null;
    if (studentId) {
      if (studentId.includes('@')) {
        const { data: uRow } = await supabase.from('users').select('id, curriculum, grade').eq('email', studentId.toLowerCase().trim()).maybeSingle();
        if (uRow) { userId = uRow.id; }
      } else {
        userId = studentId;
      }
    } else if (userEmail) {
      const { data: uRow } = await supabase.from('users').select('id, curriculum, grade').eq('email', userEmail).maybeSingle();
      if (uRow) { userId = uRow.id; }
    }

    let studentCurriculum = null;
    let studentGrade = null;
    if (userId) {
      const { data: uData } = await supabase.from('users').select('curriculum, grade').eq('id', userId).maybeSingle();
      studentCurriculum = uData?.curriculum || null;
      studentGrade = uData?.grade || null;
    }

    // Parallel: messages count + assignments personal + assignments class-wide + challenges
    const personalAssignQ = userId
      ? supabase.from('assignments').select('id', { count: 'exact', head: true }).eq('student_id', userId)
      : null;
    let classAssignQ = supabase.from('assignments').select('id', { count: 'exact', head: true }).is('student_id', null);
    if (studentCurriculum) classAssignQ = classAssignQ.eq('curriculum', studentCurriculum);
    if (studentGrade)      classAssignQ = classAssignQ.eq('grade', studentGrade);
    if (since) {
      if (personalAssignQ) personalAssignQ.gt('created_at', since);
      classAssignQ = classAssignQ.gt('created_at', since);
    }

    let challengeQ = supabase.from('challenge_assignments').select('id', { count: 'exact', head: true }).neq('status', 'completed');
    if (userId) challengeQ = challengeQ.eq('student_id', userId);
    if (since)  challengeQ = challengeQ.gt('created_at', since);

    const [msgCountRes, personalAssignRes, classAssignRes, challengeRes] = await Promise.all([
      msgCountQ,
      personalAssignQ || Promise.resolve({ count: 0 }),
      classAssignQ,
      challengeQ,
    ]);

    const msgCount = Number.isFinite(msgCountRes.count) ? Number(msgCountRes.count) : 0;
    const assignCount = (personalAssignRes.count || 0) + (classAssignRes.count || 0);
    const challengeCount = Number.isFinite(challengeRes.count) ? Number(challengeRes.count) : 0;

    // Fetch latest unread message only if needed
    let latest = null;
    if (msgCount > 0) {
      const { data } = await supabase
        .from('messages')
        .select('id, sender_name, sender_email, content, created_at')
        .eq('recipient_email', userEmail)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        latest = {
          id: data.id,
          senderName: data.sender_name || data.sender_email || 'Someone',
          senderEmail: data.sender_email || '',
          preview: toMessagePreview(data.content),
          createdAt: data.created_at,
        };
      }
    }

    res.json({ messages: msgCount, assignments: assignCount, challenges: challengeCount, latest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /messages/mark-read
// Marks all unread notifications for the user as read.
router.post('/mark-read', async (req, res) => {
  try {
    const userEmail = (req.body?.userEmail || '').trim().toLowerCase();
    if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

    const readAt = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await supabase
      .from('messages')
      .update({ read_at: readAt })
      .eq('recipient_email', userEmail)
      .is('read_at', null)
      .select('id');

    if (updateError) return res.status(500).json({ error: updateError.message });

    const markedCount = Array.isArray(updatedRows) ? updatedRows.length : 0;
    const { count: unreadCount, error: unreadError } = await supabase
      .from('messages')
      .select('id', { head: true, count: 'exact' })
      .eq('recipient_email', userEmail)
      .is('read_at', null);

    if (unreadError) return res.status(500).json({ error: unreadError.message });

    const payload = {
      success: true,
      markedCount,
      unreadCount: Number.isFinite(unreadCount) ? Number(unreadCount) : 0,
      markedAt: readAt,
    };

    logNotificationDebug('Marked unread messages as read', {
      userEmail,
      markedCount,
      unreadCount: payload.unreadCount,
    });

    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /messages/read?userEmail=&otherEmail=
// Mark all messages from otherEmail -> userEmail as read
// MUST be defined before /:id so Express does not swallow "read" as an id param
router.patch('/read', async (req, res) => {
  try {
    const userEmail  = (req.query.userEmail  || '').trim().toLowerCase();
    const otherEmail = (req.query.otherEmail || '').trim().toLowerCase();
    if (!userEmail || !otherEmail) return res.status(400).json({ error: 'userEmail and otherEmail required' });

    const readAt = new Date().toISOString();
    const { data: updatedRows, error } = await supabase
      .from('messages')
      .update({ read_at: readAt })
      .eq('sender_email', otherEmail)
      .eq('recipient_email', userEmail)
      .is('read_at', null)
      .select('id');

    if (error) return res.status(500).json({ error: error.message });

    const markedCount = Array.isArray(updatedRows) ? updatedRows.length : 0;
    logNotificationDebug('Marked conversation as read', { userEmail, otherEmail, markedCount });
    res.json({ success: true, markedCount, markedAt: readAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// ── Demo mock relationships ──────────────────────────────
// Fallback when Supabase tables are not seeded (for demo/testing)
const DEMO_RELATIONSHIPS = {
  // parent email → { children: [{name, studentEmail}], teachers: [{name, email}] }
  'suresh@test.ai':  { children: [{ name: 'Arjun Sharma',  email: 'arjun@test.ai'  }], teachers: [{ name: 'Ms. Anjali Kumar', email: 'anjali@test.ai' }] },
  'deepa@test.ai':   { children: [{ name: 'Priya Nair',    email: 'priya@test.ai'  }], teachers: [{ name: 'Ms. Anjali Kumar', email: 'anjali@test.ai' }] },
  'fatima@test.ai':  { children: [{ name: 'Zara Ahmed',    email: 'zara@test.ai'   }], teachers: [{ name: 'Ms. Anjali Kumar', email: 'anjali@test.ai' }] },
  'prakash@test.ai': { children: [{ name: 'Aanya Kapoor',  email: 'aanya@test.ai'  }], teachers: [{ name: 'Ms. Anjali Kumar', email: 'anjali@test.ai' }] },
  'parent@demo.com': { children: [{ name: 'Aanya Kapoor',  email: 'aanya@test.ai'  }], teachers: [{ name: 'Ms. Anjali Kumar', email: 'anjali@test.ai' }] },
};
// teacher email → parents they can message
const DEMO_TEACHER_CONTACTS = {
  'anjali@test.ai': [
    { name: 'Suresh Sharma',  email: 'suresh@test.ai',  childName: 'Arjun Sharma'  },
    { name: 'Deepa Nair',     email: 'deepa@test.ai',   childName: 'Priya Nair'    },
    { name: 'Fatima Ahmed',   email: 'fatima@test.ai',  childName: 'Zara Ahmed'    },
    { name: 'Prakash Kapoor', email: 'prakash@test.ai', childName: 'Aanya Kapoor'  },
  ],
};

// ── GET /messages/contacts?userEmail= ───────────────────
// Returns list of people this user can message:
//   parent  → teachers of their children
//   teacher → parents of their students

router.get('/contacts', async (req, res) => {
  try {
    const userEmail = (req.query.userEmail || '').trim().toLowerCase();
    if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

    // ── Demo fallback: return mock contacts for test accounts ──
    if (DEMO_RELATIONSHIPS[userEmail]) {
      const rel = DEMO_RELATIONSHIPS[userEmail];
      return res.json(rel.teachers.map(t => ({
        id:      t.email,
        name:    t.name,
        email:   t.email,
        role:    'teacher',
        context: `Teacher of ${rel.children.map(c => c.name).join(', ')}`,
      })));
    }
    if (DEMO_TEACHER_CONTACTS[userEmail]) {
      return res.json(DEMO_TEACHER_CONTACTS[userEmail].map(p => ({
        id:      p.email,
        name:    p.name,
        email:   p.email,
        role:    'parent',
        context: `Parent of ${p.childName}`,
      })));
    }

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

// ── GET /messages/conversations?userEmail=&role= ─────────
// Returns unique conversation threads for a user, filtered by their active role.
// role=teacher → show conversations with parents only
// role=parent  → show conversations with teachers only
router.get('/conversations', async (req, res) => {
  try {
    const userEmail  = (req.query.userEmail || '').trim().toLowerCase();
    const activeRole = (req.query.role      || '').trim().toLowerCase(); // 'teacher' | 'parent' | ''
    if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

    // Get all messages where user is sender or recipient
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_email.eq.${userEmail},recipient_email.eq.${userEmail}`)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Collect unique other-party emails for role lookup
    const otherEmails = [...new Set(
      (data ?? []).map(msg =>
        msg.sender_email === userEmail ? msg.recipient_email : msg.sender_email
      ).filter(e => e && e !== userEmail)
    )];

    // Batch-lookup roles from users table
    const roleMap = {};
    if (otherEmails.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('email, role')
        .in('email', otherEmails);
      (users ?? []).forEach(u => { roleMap[u.email] = u.role; });
    }

    // Group into threads — keyed by the other person's email
    const threadMap = {};
    (data ?? []).forEach(msg => {
      const otherEmail = msg.sender_email === userEmail ? msg.recipient_email : msg.sender_email;
      const otherName  = msg.sender_email === userEmail ? msg.recipient_name  : msg.sender_name;
      // Use DB role lookup as source of truth; fall back to sender_role for incoming messages
      const otherRole  = roleMap[otherEmail] || (msg.sender_email !== userEmail ? msg.sender_role : null) || 'parent';

      // Filter by active role: teacher sees parents, parent sees teachers
      if (activeRole === 'teacher' && otherRole !== 'parent') return;
      if (activeRole === 'parent'  && otherRole !== 'teacher') return;

      if (!threadMap[otherEmail]) {
        threadMap[otherEmail] = {
          otherEmail,
          otherName:  otherName || otherEmail,
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

// ── POST /messages/upload ─────────────────────────────────
// Upload a file attachment, returns { url, name, size, type }
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  res.json({
    url:  `/data/uploads/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    type: ext,
  });
});

// ── POST /messages ────────────────────────────────────────
// Send a message (with optional attachment metadata)
router.post('/', async (req, res) => {
  try {
    const {
      senderEmail, senderName, senderRole,
      recipientEmail, recipientName,
      content, studentId, studentName,
      attachmentUrl, attachmentName, attachmentSize, attachmentType,
    } = req.body;

    if (!senderEmail || !recipientEmail || (!content && !attachmentUrl)) {
      return res.status(400).json({ error: 'senderEmail, recipientEmail, and content or attachment required' });
    }

    const insertData = {
      sender_email:    senderEmail.toLowerCase().trim(),
      sender_name:     senderName || senderEmail,
      sender_role:     senderRole,
      recipient_email: recipientEmail.toLowerCase().trim(),
      recipient_name:  recipientName || recipientEmail,
      content:         (content || '').trim() || (attachmentName ? `Shared a file: ${attachmentName}` : ''),
      student_id:      studentId || null,
      student_name:    studentName || null,
    };

    // Store attachment metadata in content as JSON prefix if present
    if (attachmentUrl) {
      insertData.content = JSON.stringify({
        text: (content || '').trim(),
        attachment: { url: attachmentUrl, name: attachmentName, size: attachmentSize, type: attachmentType },
      });
    }

    const { data, error } = await supabase
      .from('messages')
      .insert(insertData)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /messages/test-notification ────────────────────────────────────────
// DEV ONLY — injects a fake unread message so you can test the bell sound/toast.
// Body: { recipientEmail }
router.post('/test-notification', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'Not available in production' });
  const recipientEmail = (req.body?.recipientEmail || '').trim().toLowerCase();
  if (!recipientEmail) return res.status(400).json({ error: 'recipientEmail required' });

  // Lookup recipient name
  const { data: rUser } = await supabase.from('users').select('name').eq('email', recipientEmail).maybeSingle();

  const { data, error } = await supabase.from('messages').insert({
    sender_name:     'Aivorah Test',
    sender_email:    'test@aivorah.com',
    sender_role:     'teacher',
    recipient_email: recipientEmail,
    recipient_name:  rUser?.name || 'Student',
    content:         'This is a test notification — sound and badge should appear!',
    read_at:         null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, message: data });
});

module.exports = router;
