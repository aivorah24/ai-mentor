const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const nodemailer = require('nodemailer');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const SUPPORT_TEAM_EMAIL = 'aivorah24@gmail.com';

const SYSTEM_PROMPT = `You are Aivorah's 24/7 Support Assistant — a friendly, helpful support agent for the Aivorah learning platform.

Your job is to answer questions about how the Aivorah platform works. You are NOT a subject tutor — do not teach maths, science, or any academic content.

Topics you can help with:
- XP points: earned by completing lessons (+50 XP), assignments (+75 XP), challenges (+100 XP)
- Levels: increase as XP accumulates; each level needs progressively more XP
- Streaks: log in and complete at least one lesson/challenge every day; missing a day resets streak to 0
- Badges: earned by reaching milestones (e.g. Quick Start = first lesson, Bookworm = 10 topics)
- Learning Paths: curriculum-aligned topics split into Basic / Intermediate / Advanced
- AI Coach: conversational AI tutor for academic questions; personalized to student's level
- Assignments: given by teacher/parent, auto-graded, wrong answers get AI explanation
- Challenges: competitive exam prep, schools can run quarterly challenges
- Schedule: auto-populated from assignments + learning paths
- Progress & Stats: tracks XP, streak, topics explored, study time
- Profile & Avatar: go to Profile in sidebar to change avatar style
- Themes: dark/light/auto available in Settings
- Devices: works on web, tablet, phone — same account syncs everything
- Data & Privacy: data stored securely via Supabase; never sold
- Support: submit a ticket for issues not covered here

Rules:
- Be friendly, concise, and clear
- If asked about academic subjects (maths, science, etc.) say: "For academic questions, please use the AI Coach from the sidebar!"
- Always answer in 2-4 sentences max
- If you don't know something, say "Please submit a support ticket and our team will help you within 24 hours."`;

// POST /help/chat
// Body: { message, userName? }
router.post('/chat', async (req, res) => {
  const { message, userName } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message.trim() },
      ],
      temperature: 0.3,
      max_tokens: 256,
    });

    const reply = response.choices[0].message.content;
    res.json({ reply });
  } catch (err) {
    console.error('Help chat error:', err.message);
    res.status(500).json({ error: 'Support chat unavailable. Please try again.' });
  }
});

// POST /help/ticket
// Body: { email?, subject, message }
router.post('/ticket', async (req, res) => {
  const senderEmail = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';

  if (!subject) {
    return res.status(400).json({ success: false, error: 'subject is required' });
  }
  if (!message) {
    return res.status(400).json({ success: false, error: 'message is required' });
  }

  const { EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS) {
    return res.status(500).json({
      success: false,
      error: 'Email service not configured. Set EMAIL_USER and EMAIL_PASS.',
    });
  }

  const timestamp = new Date().toISOString();
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  try {
    await transporter.sendMail({
      from: `"Aivorah Support" <${EMAIL_USER}>`,
      to: SUPPORT_TEAM_EMAIL,
      replyTo: senderEmail || undefined,
      subject: `[Aivorah Support Ticket] ${subject}`,
      text: [
        'New support ticket submitted.',
        '',
        `Sender Email: ${senderEmail || 'Not provided'}`,
        `Subject: ${subject}`,
        'Message:',
        message,
        '',
        `Timestamp: ${timestamp}`,
      ].join('\n'),
    });

    return res.status(200).json({
      success: true,
      message: 'Support ticket submitted successfully.',
    });
  } catch (err) {
    console.error('Support ticket email error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to submit support ticket. Please try again.',
    });
  }
});

module.exports = router;
