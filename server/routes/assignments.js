const express    = require('express');
const router     = express.Router();
const supabase   = require('../services/supabase');
const Groq       = require('groq-sdk');
const fs         = require('fs');
const path       = require('path');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MCQ_LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3 };

const SCHEDULE_PATH = path.join(__dirname, '../data/schedule.json');
function readSchedule() {
  try { return JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8')); } catch { return []; }
}
function writeSchedule(data) {
  try { fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(data, null, 2)); } catch (_) {}
}

// â”€â”€ GET /assignments?studentId=xxx â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/', async (req, res) => {
  const { studentId, teacherId } = req.query;

  if (teacherId) {
    const creatorId = await resolveUserId(teacherId);
    const query = supabase
      .from('assignments')
      .select('*')
      .order('due_date', { ascending: true });
    // If we have a creatorId, filter by it; otherwise return all (fallback for unregistered teachers)
    const { data, error } = creatorId
      ? await query.eq('created_by_id', creatorId)
      : await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json((data || []).map(normalise));
  }

  if (!studentId) return res.status(400).json({ error: 'studentId or teacherId required' });

  const userId = await resolveUserId(studentId);
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .or(`student_id.eq.${userId},student_id.is.null`)
    .order('due_date', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(normalise));
});

// â”€â”€ POST /assignments/generate-quiz â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Generate quiz questions from Qdrant textbook content + teacher notes.
// Body: { subject, chapter, grade, curriculum, difficulty, count, teacherNotes }

router.post('/generate-quiz', async (req, res) => {
  const {
    subject = '', chapter = '', grade = '', curriculum = '',
    difficulty = 'medium', count = 5, teacherNotes = '',
  } = req.body;

  const cleanSubject = String(subject || '').trim();
  const cleanChapter = String(chapter || '').trim();
  const cleanGrade = String(grade || '').trim();
  const cleanCurriculum = String(curriculum || '').trim();
  const cleanNotes = String(teacherNotes || '').trim();
  const requestedCount = normalizeQuizCount(count, 5);

  if (!cleanChapter && !cleanSubject) return res.status(400).json({ error: 'subject or chapter required' });

  try {
    let context = '';
    let sourceChunks = 0;
    try {
      const { embed } = require('../services/embeddings');
      const { searchContent } = require('../services/qdrant');

      const queryText = [cleanSubject, cleanChapter, cleanGrade, cleanCurriculum, cleanNotes].filter(Boolean).join(' ');
      const vector = await embed(queryText);
      const results = await searchContent({
        vector,
        curriculum: cleanCurriculum || undefined,
        grade: cleanGrade || undefined,
        subject: cleanSubject || undefined,
        limit: 10,
      });

      sourceChunks = results.length;
      context = results.length > 0
        ? results.map(r => {
            const p = r.payload || {};
            return `[${p.subject || cleanSubject} > ${p.unit || ''} > ${p.topic || cleanChapter}]\n${p.content || p.text || ''}`;
          }).join('\n\n---\n\n')
        : '';
    } catch (retrievalErr) {
      console.warn('generate-quiz retrieval warning:', retrievalErr.message);
    }

    const difficultyGuide = {
      easy:   'Simple, recall-based. Single-step. Vocabulary and basic facts.',
      medium: 'Understanding-based. Requires applying the concept, not just recall.',
      hard:   'Application and analysis. Multi-step thinking, real-world scenarios.',
    }[difficulty] || 'moderate difficulty';

    const prompt = `You are creating a quiz for Grade ${cleanGrade || '3'} students.
Subject: ${cleanSubject || 'General'}
Chapter/Topic: ${cleanChapter || cleanSubject}
Curriculum: ${cleanCurriculum || 'NCERT'}

${context ? `TEXTBOOK CONTENT (use this as the primary source):\n\n${context}` : ''}
${cleanNotes ? `\nTEACHER'S ADDITIONAL NOTES (include these specific requirements):\n${cleanNotes}` : ''}

Generate exactly ${requestedCount} quiz questions.
Difficulty: ${difficultyGuide}
Format: ALL questions must be MCQ (4 options each).

Rules:
- Base questions STRICTLY on the subject + chapter/topic above
- If textbook content is available, align closely to it
- If textbook content is unavailable, still stay strictly within this chapter/topic
- Age-appropriate language for ${cleanGrade || 'Grade 3'} students (8-10 year olds)
- Every question MUST be type "mcq"
- Each MCQ must have exactly 4 clear options
- Only ONE correct option per question
- Hint: one gentle clue without giving away the answer
- Explanation: why the correct answer is right (for post-quiz learning)

Respond ONLY as valid JSON:
{
  "questions": [
    {
      "id": "q1",
      "question": "question text here",
      "type": "mcq",
      "options": ["option1", "option2", "option3", "option4"],
      "correct": "option1",
      "hint": "Think about...",
      "explanation": "The correct answer is A because..."
    }
  ]
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const generated = normalizeQuizQuestions(Array.isArray(result.questions) ? result.questions : [], requestedCount);
    if (generated.length === 0) {
      const fallbackQuestions = buildFallbackQuiz({
        subject: cleanSubject,
        chapter: cleanChapter,
        count: requestedCount,
      });
      if (fallbackQuestions.length > 0) {
        return res.json({ questions: fallbackQuestions, sourceChunks, fallback: true });
      }
      return res.status(502).json({ error: 'Quiz generation returned no valid MCQ questions. Please try again.' });
    }

    res.json({ questions: generated, sourceChunks });

  } catch (e) {
    console.error('generate-quiz error:', e.message);
    const fallbackQuestions = buildFallbackQuiz({
      subject: cleanSubject,
      chapter: cleanChapter,
      count: requestedCount,
    });
    if (fallbackQuestions.length > 0) {
      return res.json({ questions: fallbackQuestions, sourceChunks: 0, fallback: true });
    }
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /assignments/extract-questions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Upload a PDF or image and extract questions from it using Groq.
// Body: { fileBase64: string, mimeType: string }

router.post('/extract-questions', async (req, res) => {
  const { fileBase64, mimeType = 'image/jpeg' } = req.body;
  if (!fileBase64) return res.status(400).json({ error: 'fileBase64 required' });

  try {
    let questions = [];

    if (mimeType === 'application/pdf') {
      // Extract text from PDF then use LLM to pull out questions
      const pdfParse = require('pdf-parse');
      const buffer = Buffer.from(fileBase64, 'base64');
      const pdfData = await pdfParse(buffer);
      const text = pdfData.text?.trim();
      if (!text) return res.json({ questions: [] });

      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'user',
          content: `Extract all questions from this assignment or worksheet text.
Return ONLY a JSON object in this format: {"questions": ["Q1 text", "Q2 text", ...]}
Extract up to 10 questions. Write each question exactly as it appears.

Assignment text:
${text.slice(0, 4000)}`,
        }],
        response_format: { type: 'json_object' },
      });
      const result = JSON.parse(completion.choices[0].message.content);
      questions = Array.isArray(result.questions) ? result.questions : [];

    } else {
      // Use Groq Vision for image files
      const completion = await groq.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Look at this assignment or worksheet image and extract all the questions.
Return ONLY a JSON object: {"questions": ["Q1 text", "Q2 text", ...]}
Extract up to 10 questions. Write each question exactly as shown in the image.`,
            },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
          ],
        }],
      });
      const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
      const result = JSON.parse(raw);
      questions = Array.isArray(result.questions) ? result.questions : [];
    }

    res.json({ questions: questions.slice(0, 10) });
  } catch (e) {
    console.error('extract-questions error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /assignments/upload-doc â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Upload a document (PDF or image) to Cloudinary; returns the URL.
// Body: { fileBase64: string, fileName: string, mimeType: string }

router.post('/upload-doc', async (req, res) => {
  const { fileBase64, fileName = 'assignment', mimeType = 'application/pdf' } = req.body;
  if (!fileBase64) return res.status(400).json({ error: 'fileBase64 required' });
  try {
    const dataUri = `data:${mimeType};base64,${fileBase64}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder:        'ai_mentor/assignments',
      public_id:     `doc_${Date.now()}`,
      resource_type: 'auto',
    });
    res.json({ url: result.secure_url, publicId: result.public_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€ POST /assignments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Body: { title, subject, chapter, dueDate, type, note, studentId, createdById,
//         createdByRole, grade, curriculum, questions: string[] }

router.post('/', async (req, res) => {
  const {
    title, subject = '', chapter = '', dueDate, type = 'assignment',
    note = '', studentId, createdById, createdByRole = 'teacher',
    grade = null, curriculum = null, questions = [], documentUrl = null, documentUrls = [],
    successCriteria = [], taskSteps = [], quizQuestions = [],
  } = req.body;

  if (!title || !dueDate) return res.status(400).json({ error: 'title and dueDate required' });
  const normalizedQuizQuestions = normalizeQuizQuestions(Array.isArray(quizQuestions) ? quizQuestions : []);
  if (type === 'quiz' && normalizedQuizQuestions.length === 0) {
    return res.status(400).json({ error: 'Quiz must include valid MCQ questions (4 options each).' });
  }

  const userId    = studentId   ? await resolveUserId(studentId)   : null;
  const creatorId = createdById ? await resolveUserId(createdById) : null;

  const { data, error } = await supabase
    .from('assignments')
    .insert({
      title, subject, chapter,
      due_date:         dueDate,
      type, note,
      student_id:       userId,
      created_by_id:    creatorId,
      created_by_role:  createdByRole,
      grade, curriculum,
      questions:        Array.isArray(questions) ? questions : [],
      document_url:     documentUrl || null,
      document_urls:    Array.isArray(documentUrls) && documentUrls.length > 0 ? documentUrls : (documentUrl ? [documentUrl] : []),
      success_criteria: Array.isArray(successCriteria) ? successCriteria : [],
      task_steps:       Array.isArray(taskSteps) ? taskSteps : [],
      quiz_questions:   normalizedQuizQuestions,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Auto-add deadline to schedule.json so it appears in all calendars
  try {
    const schedule = readSchedule();
    const deadlineId = 'asgn_' + data.id.slice(0, 8);
    if (!schedule.find(e => e.id === deadlineId)) {
      schedule.push({
        id:        deadlineId,
        title:     `${title} â€” Due`,
        date:      dueDate,
        startTime: '23:59',
        endTime:   '23:59',
        type:      'deadline',
        note:      `${subject}${chapter ? ' Â· ' + chapter : ''}${grade ? ' Â· ' + grade : ''}`,
        studentId: 'all',
        createdBy: 'teacher',
        tag:       subject,
        createdAt: new Date().toISOString(),
        assignmentId: data.id,
      });
      writeSchedule(schedule);
    }
  } catch (_) {}

  res.json(normalise(data));
});

// â”€â”€ POST /assignments/:id/submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Student submits text answers OR a base64 image; Groq grades it.
// Body: { studentId, answers: string[], imageBase64?: string, imageMime?: string }

router.post('/:id/submit', async (req, res) => {
  const { id } = req.params;
  // questionImages: [{ imageBase64: string|null, imageMime: string }] â€” one per question (new flow)
  // imageBase64 / imageMime â€” legacy single-image fallback
  const {
    studentId,
    answers = [],
    imageBase64,
    imageMime = 'image/jpeg',
    questionImages,
    stepAnswers,
    selfAssessment,
    quizAnswers,
    quizQuestions: submittedQuizQuestions = [],
  } = req.body;

  const { data: assignment, error: fetchErr } = await supabase
    .from('assignments')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !assignment) return res.status(404).json({ error: 'Assignment not found' });

  const questions = assignment.questions || [];
  let score = null;
  let feedback = 'Good effort! Your submission has been recorded.';
  let perQuestion = [];

  // Worksheet page URLs stored in DB â€” used as visual context for grading
  const worksheetUrls = Array.isArray(assignment.document_urls) && assignment.document_urls.length > 0
    ? assignment.document_urls
    : (assignment.document_url ? [assignment.document_url] : []);

  // Teacher-provided success criteria (may be empty â€” Groq will auto-detect from worksheet images)
  const successCriteria = Array.isArray(assignment.success_criteria) ? assignment.success_criteria : [];

  try {
    if (Array.isArray(quizAnswers) && quizAnswers.length > 0) {
      // â”€â”€ QUIZ FLOW: grade each answered question â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const storedQuizQuestions = Array.isArray(assignment.quiz_questions) ? assignment.quiz_questions : [];
      const legacyQuizQuestions = Array.isArray(assignment.questions)
        ? assignment.questions.filter(q => q && typeof q === 'object' && q.question)
        : [];
      const requestQuizQuestions = Array.isArray(submittedQuizQuestions)
        ? submittedQuizQuestions.filter(q => q && typeof q === 'object' && q.question)
        : [];

      const sourceQuizQuestions = storedQuizQuestions.length > 0
        ? storedQuizQuestions
        : (legacyQuizQuestions.length > 0 ? legacyQuizQuestions : requestQuizQuestions);
      const quizQuestions = normalizeQuizQuestions(sourceQuizQuestions);

      if (quizQuestions.length === 0) {
        return res.status(400).json({ error: 'Quiz has no questions configured. Ask your teacher to regenerate the quiz.' });
      }

      if (storedQuizQuestions.length === 0 && quizQuestions.length > 0) {
        try {
          await supabase.from('assignments').update({ quiz_questions: quizQuestions }).eq('id', id);
        } catch (_) {}
      }

      const totalQuizQuestions = quizQuestions.length;
      const graded = await Promise.all(Array.from({ length: totalQuizQuestions }).map(async (_, i) => {
        const ans = quizAnswers[i] || {};
        const q = quizQuestions[i] || {};
        const studentAns = (ans.answer || '').trim();

        if (!studentAns) {
          return { number: i+1, question: q.question || '', type: q.type || 'mcq',
            answered: false, score: 0, correct: false,
            studentAnswer: null, correctAnswer: q.correct || '',
            comment: 'You skipped this question.', explanation: q.explanation || '' };
        }

        if (q.type === 'mcq') {
          const expected = normaliseAnswerToOptionText(q.correct, q.options || []);
          const selected = normaliseAnswerToOptionText(studentAns, q.options || []);
          const isCorrect = !!expected && !!selected && normalizeText(expected) === normalizeText(selected);
          const correctAnswer = expected || String(q.correct || '');
          return {
            number: i+1, question: q.question, type: 'mcq',
            answered: true, score: isCorrect ? 100 : 0, correct: isCorrect,
            studentAnswer: selected || studentAns, correctAnswer,
            comment: isCorrect ? 'Correct! Well done.' : `Not quite. The correct answer is: ${correctAnswer}`,
            explanation: q.explanation || '',
          };
        } else {
          // Short answer: Groq evaluates
          try {
            const gradingPrompt = `Grade this short answer for a Grade ${assignment.grade || '3'} student.

Question: "${q.question}"
Expected answer / key points: "${q.correct}"
Student's answer: "${studentAns}"

Is the student's answer correct or mostly correct?
- Full credit (score 100): covers the key points accurately
- Partial credit (score 50): partially correct, missing some key points
- No credit (score 0): incorrect or completely off-topic

Respond ONLY as JSON: {"score":0-100,"correct":bool,"comment":"one warm, specific sentence for an 8-year-old","explanation":"${q.explanation || ''}"}`;

            const comp = await groq.chat.completions.create({
              model: 'llama-3.3-70b-versatile',
              messages: [{ role: 'user', content: gradingPrompt }],
              response_format: { type: 'json_object' },
            });
            const result = JSON.parse(comp.choices[0].message.content);
            return {
              number: i+1, question: q.question, type: 'short_answer',
              answered: true,
              score: Math.max(0, Math.min(100, Number(result.score) || 0)),
              correct: !!result.correct,
              studentAnswer: studentAns, correctAnswer: q.correct,
              comment: result.comment || '',
              explanation: q.explanation || '',
            };
          } catch {
            return { number: i+1, question: q.question, type: 'short_answer',
              answered: true, score: 50, correct: false,
              studentAnswer: studentAns, correctAnswer: q.correct,
              comment: 'Good attempt!', explanation: q.explanation || '' };
          }
        }
      }));

      perQuestion = graded;
      const answeredCount = graded.filter(q => q.answered).length;
      const correctCount  = graded.filter(q => q.correct).length;
      score = graded.length > 0 ? Math.round(graded.reduce((s, q) => s + q.score, 0) / graded.length) : 0;

      try {
        const summaryComp = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: `Grade ${assignment.grade || '3'} student scored ${score}% on a quiz about "${assignment.chapter || assignment.title}" (${assignment.subject}). Got ${correctCount} out of ${graded.length} correct (${answeredCount} attempted).
Write 2 warm sentences of feedforward for an 8-year-old.
JSON: {"text":"...","wellDone":"specific strength","improve":"one specific topic to review","stamp":"Amazing Work! or Good Effort! or Keep Trying!"}` }],
          response_format: { type: 'json_object' },
        });
        const summary = JSON.parse(summaryComp.choices[0].message.content);
        feedback = JSON.stringify({
          text: summary.text || '',
          stamp: summary.stamp || '',
          wellDone: summary.wellDone || '',
          improve: summary.improve || '',
          perQuestion: graded,
        });
      } catch {
        // Keep deterministic quiz score even if AI summary generation fails.
        feedback = JSON.stringify({
          text: `You scored ${score}% with ${correctCount} correct out of ${graded.length}.`,
          stamp: score >= 85 ? 'Amazing Work!' : score >= 60 ? 'Good Effort!' : 'Keep Trying!',
          wellDone: correctCount > 0 ? `You answered ${correctCount} question${correctCount > 1 ? 's' : ''} correctly.` : '',
          improve: 'Review the missed questions and try again.',
          perQuestion: graded,
        });
      }

    } else if (Array.isArray(stepAnswers) && stepAnswers.length > 0) {
      // â”€â”€ SCAFFOLDED FLOW: grade each task step â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const taskSteps = Array.isArray(assignment.task_steps) ? assignment.task_steps : [];
      const criteria  = Array.isArray(assignment.success_criteria) ? assignment.success_criteria : [];

      const gradingPromises = stepAnswers.map(async (ans, i) => {
        const step = taskSteps[i] || { type: ans.type, label: `Step ${i + 1}`, instructions: '' };
        const stepLabel = step.label || `Step ${i + 1}`;

        // Build the text description of the student's answer for this step
        let answerDescription = '';
        const contentParts = [];

        if (ans.type === 'brainstorm') {
          const kw = Array.isArray(ans.keywords) ? ans.keywords.filter(Boolean) : [];
          answerDescription = kw.length > 0 ? `Student brainstormed these keywords: ${kw.join(', ')}` : 'Student did not write any keywords.';
          const unanswered = kw.length === 0;
          if (unanswered) return { number: i+1, stepLabel, type: ans.type, answered: false, score: 0, studentAnswer: 'No keywords written.', correct: false, comment: 'Try writing at least 3 keywords about the topic next time!' };
        } else if (ans.type === 'structured_writing') {
          const secs = Array.isArray(ans.sections) ? ans.sections : [];
          const filled = secs.filter(s => s.text?.trim());
          if (filled.length === 0) return { number: i+1, stepLabel, type: ans.type, answered: false, score: 0, studentAnswer: 'No writing in any section.', correct: false, comment: 'Try filling in the Beginning, Middle, and End sections next time!' };
          answerDescription = secs.map(s => `${s.label}: "${s.text?.trim() || '(blank)'}"`).join('\n');
        } else if ((ans.type === 'drawing' || ans.type === 'photo') && ans.drawingBase64) {
          // image-based step â€” handled via contentParts below
        } else if (ans.type === 'photo' && ans.photoBase64) {
          // photo upload
        } else {
          return { number: i+1, stepLabel, type: ans.type, answered: false, score: 0, studentAnswer: 'Not submitted.', correct: false, comment: 'This step was not completed.' };
        }

        const criteriaBlock = criteria.length > 0
          ? `\nSUCCESS CRITERIA:\n${criteria.map((c, n) => `${n+1}. ${c}`).join('\n')}\n`
          : '\nLook for any success criteria visible in the worksheet images.\n';

        let prompt = '';

        if (ans.type === 'brainstorm') {
          prompt = `You are grading a Grade 3 student's brainstorming step for "${assignment.title}" (${assignment.subject}).
Step: "${stepLabel}" â€” ${step.instructions || ''}
${criteriaBlock}
${answerDescription}

Grade this brainstorm: Are the keywords relevant to the topic? Do they show understanding?
- Highly relevant, 4+ keywords = 80-100%
- Mostly relevant, 2-3 keywords = 50-75%
- Few/irrelevant keywords = 20-45%
Be warm and encouraging for an 8-year-old.

Respond ONLY as JSON: {"answered":true,"score":0-100,"studentAnswer":"list the keywords","correct":bool,"comment":"short encouraging feedback"}`;
          contentParts.push({ type: 'text', text: prompt });

        } else if (ans.type === 'structured_writing') {
          prompt = `You are grading a Grade 3 student's structured writing for "${assignment.title}" (${assignment.subject}).
Step: "${stepLabel}" â€” ${step.instructions || ''}
${criteriaBlock}
Student's writing:
${answerDescription}

Grade the writing quality per section AND overall:
- Does it have a clear Beginning, Middle, End structure?
- Are sentences complete with capital letters and full stops?
- Are ideas logical and connected?
- Does it use relevant vocabulary?
For Grade 3: 3-4 sentences per section is excellent. Be encouraging.

Respond ONLY as JSON: {"answered":true,"score":0-100,"studentAnswer":"brief summary of what they wrote","correct":bool,"comment":"specific, warm feedforward for each section"}`;
          contentParts.push({ type: 'text', text: prompt });

        } else {
          // Drawing or photo â€” vision model
          const imageB64 = ans.drawingBase64 || ans.photoBase64;
          const imageMimeVal = ans.drawingMime || ans.photoMime || 'image/jpeg';
          if (!imageB64) return { number: i+1, stepLabel, type: ans.type, answered: false, score: 0, studentAnswer: 'No image submitted.', correct: false, comment: 'Please submit your drawing or photo next time!' };

          prompt = `You are grading a Grade 3 student's ${ans.type === 'drawing' ? 'drawing' : 'photo submission'} for "${assignment.title}" (${assignment.subject}).
Step: "${stepLabel}" â€” ${step.instructions || ''}
${criteriaBlock}
${worksheetUrls.length > 0 ? `The first ${worksheetUrls.length} image(s) are the ORIGINAL WORKSHEET for context. The LAST image is the STUDENT'S ${ans.type === 'drawing' ? 'DRAWING' : 'PHOTO'}.` : 'The image is the student\'s submission.'}

For drawing tasks (Grade 3):
- Relevance to topic (40%): does the drawing match the task?
- Effort & detail (30%): recognizable elements, multiple items drawn
- Completeness (30%): filled the space, attempted the whole task
- Grade 3 drawing with clear topic relevance = 60-85%
- Be warm and specific about what you see drawn

Respond ONLY as JSON: {"answered":true,"score":0-100,"studentAnswer":"describe exactly what is drawn/shown","correct":bool,"comment":"warm specific feedforward for an 8-year-old"}`;

          contentParts.push({ type: 'text', text: prompt });
          worksheetUrls.slice(0, 3).forEach(url => contentParts.push({ type: 'image_url', image_url: { url } }));
          contentParts.push({ type: 'image_url', image_url: { url: `data:${imageMimeVal};base64,${imageB64}` } });
        }

        try {
          const model = contentParts.some(p => p.type === 'image_url')
            ? 'meta-llama/llama-4-scout-17b-16e-instruct'
            : 'llama-3.3-70b-versatile';
          const completion = await groq.chat.completions.create({
            model,
            messages: [{ role: 'user', content: contentParts.length === 1 ? contentParts[0].text : contentParts }],
            ...(model === 'llama-3.3-70b-versatile' ? { response_format: { type: 'json_object' } } : {}),
          });
          const raw = completion.choices[0].message.content.replace(/```json[\s\S]*?```|```/g, '').trim();
          const result = JSON.parse(raw);
          return {
            number: i + 1,
            stepLabel,
            type: ans.type,
            answered: !!result.answered,
            score: Math.max(0, Math.min(100, Number(result.score) || 0)),
            studentAnswer: result.studentAnswer || null,
            correct: !!result.correct,
            comment: result.comment || '',
          };
        } catch (e) {
          console.error(`Step grading error ${i+1}:`, e.message);
          return { number: i+1, stepLabel, type: ans.type, answered: true, score: 50, studentAnswer: null, correct: false, comment: 'Could not fully read this step.' };
        }
      });

      perQuestion = await Promise.all(gradingPromises);
      const answeredSteps = perQuestion.filter(q => q.answered);
      score = answeredSteps.length > 0 ? Math.round(answeredSteps.reduce((s, q) => s + q.score, 0) / answeredSteps.length) : 0;

      // Self-assessment comparison â€” did student correctly assess themselves?
      const selfNote = selfAssessment && Object.keys(selfAssessment).length > 0
        ? `\nStudent self-assessed: ${Object.entries(selfAssessment).filter(([,v])=>v).map(([k])=>k).join(', ') || 'none checked'}.`
        : '';

      const summaryComp = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: `Grade 3 student completed a scaffolded assignment "${assignment.title}" (${assignment.subject}).
Steps completed: ${answeredSteps.length}/${stepAnswers.length}.
Scores: ${perQuestion.map(q => `${q.stepLabel}=${q.score}%`).join(', ')}.
Overall: ${score}%.${selfNote}

Write 2-3 warm, honest sentences of feedforward for an 8-year-old. Mention one specific thing done well and one specific next step.
Respond ONLY as JSON: {"text":"...","wellDone":"specific strength","improve":"specific feedforward for next time","stamp":"Amazing Storyteller or Hardworking Farmer or Creative Writer or Keep Going!"}` }],
        response_format: { type: 'json_object' },
      });
      const summary = JSON.parse(summaryComp.choices[0].message.content);

      feedback = JSON.stringify({
        text:        summary.text || `Great effort on ${answeredSteps.length} steps!`,
        stamp:       summary.stamp || (score >= 85 ? 'Amazing Storyteller' : score >= 60 ? 'Hardworking Farmer' : 'Keep Going!'),
        wellDone:    summary.wellDone || '',
        improve:     summary.improve  || '',
        perQuestion,
      });

    } else if (Array.isArray(questionImages) && questionImages.length > 0) {
      // â”€â”€ NEW FLOW: one image per PAGE (not per extracted question) â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Student uploads one photo per worksheet page â†’ grade per page.
      // Iterating over questionImages (pages submitted), NOT over questions[].
      // This prevents the "18 questions extracted but 4 pages answered = 10% bug".
      const gradingPromises = questionImages.map(async (img, i) => {
        if (!img || !img.imageBase64) {
          return {
            number: i + 1,
            question: `Page ${i + 1}`,
            answered: false,
            score: 0,
            studentAnswer: null,
            correct: false,
            comment: 'You have not submitted an answer for this page.',
          };
        }

        const criteriaBlock = successCriteria.length > 0
          ? `\nSUCCESS CRITERIA (provided by teacher â€” grade specifically against each of these):\n${successCriteria.map((c, n) => `${n + 1}. ${c}`).join('\n')}\n`
          : `\nSUCCESS CRITERIA: Look carefully at the worksheet images â€” if there is a "Success Criteria", "Checklist", "Learning Outcome", or "Rubric" section visible anywhere in the worksheet pages, use those criteria to grade the student's answer. If no criteria are visible, use your best judgement based on the task type and subject.\n`;

        const prompt = `You are a teacher grading a student's assignment.

Assignment: ${assignment.title}
Subject: ${assignment.subject}${assignment.chapter ? '\nChapter: ' + assignment.chapter : ''}${assignment.grade ? '\nGrade: ' + assignment.grade : ''}
${assignment.curriculum ? 'Curriculum: ' + assignment.curriculum : ''}
${criteriaBlock}
The first ${worksheetUrls.length} image(s) show the ORIGINAL WORKSHEET â€” study ALL of them carefully to understand the full task, including any cloud prompts, drawing tasks, paragraph writing sections, word banks, success criteria checklists, and visual elements.

The LAST image is the STUDENT'S HANDWRITTEN ANSWER for Page ${i + 1} of ${questionImages.length}.

Instructions:
1. Find and apply the success criteria (from the teacher input above OR from the worksheet images)
2. Carefully look at EVERYTHING on the student's page â€” written text, drawings, diagrams, filled-in boxes, circled words, any marks at all
3. Grade each success criterion: did the student meet it?
4. Only set answered=false if the page is genuinely completely blank â€” no marks, no drawings, nothing
5. Give a fair score 0-100 reflecting how many success criteria were met

DRAWING TASKS â€” IMPORTANT (especially for Grade 3 students):
- If the task involves drawing (e.g. "Draw your farm", "Illustrate", "Sketch"), evaluate the drawing on:
  * Relevance â€” does the drawing relate to the topic? (worth 40% of score)
  * Effort & detail â€” can you identify recognizable elements? (worth 30%)
  * Completeness â€” did they attempt the whole space/task? (worth 30%)
- A Grade 3 student's drawing that is recognizable and topic-relevant should score 60-85%
- A detailed, accurate drawing with multiple labelled elements = 85-100%
- A minimal but relevant attempt = 40-60%
- Completely unrelated scribbles = 10-30%
- Blank = 0%
- In "studentAnswer": describe specifically what you see drawn â€” name the elements (e.g. "drew 3 rows of crops including carrots and vegetables in an organized grid pattern")
- Never penalize a child for drawing style â€” only for relevance and effort

MIXED PAGES (drawing + writing):
- If a page has both a drawing task AND a writing task (e.g. draw + write a paragraph), score each part separately and average them
- If drawing is done but writing is blank, give partial credit (e.g. drawing=75%, writing=0% â†’ page score ~37%)
- Mention both parts clearly in "comment"

GENERAL:
- In "comment": be warm and encouraging for Grade 3, mention what you actually see, reference the criteria
- Never give 0% to a page where the student made a genuine attempt

Respond ONLY as valid JSON:
{
  "answered": true or false,
  "score": 0-100,
  "studentAnswer": "specific description of what the student wrote AND/OR drew â€” name actual elements visible",
  "correct": true if score >= 70,
  "comment": "encouraging, specific feedback for a Grade 3 student â€” what they did well and one thing to add"
}`;

        // Build content: all worksheet pages as visual context + student's answer last
        const contentParts = [{ type: 'text', text: prompt }];
        worksheetUrls.slice(0, 4).forEach(url => {
          contentParts.push({ type: 'image_url', image_url: { url } });
        });
        contentParts.push({ type: 'image_url', image_url: { url: `data:${img.imageMime || 'image/jpeg'};base64,${img.imageBase64}` } });

        try {
          const completion = await groq.chat.completions.create({
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            messages: [{ role: 'user', content: contentParts }],
          });
          const raw = completion.choices[0].message.content.replace(/```json[\s\S]*?```|```/g, '').trim();
          const result = JSON.parse(raw);
          return {
            number: i + 1,
            question: `Page ${i + 1}`,
            answered: !!result.answered,
            score: Math.max(0, Math.min(100, Number(result.score) || 0)),
            studentAnswer: result.studentAnswer || null,
            correct: !!result.correct,
            comment: result.comment || '',
          };
        } catch (e) {
          console.error(`Grading error Page ${i+1}:`, e.message);
          return {
            number: i + 1,
            question: `Page ${i + 1}`,
            answered: true,
            score: 50,
            studentAnswer: null,
            correct: false,
            comment: 'Could not read this page clearly â€” please ask your teacher to review.',
          };
        }
      });

      perQuestion = await Promise.all(gradingPromises);

      // Compute real overall score
      const totalScore = perQuestion.reduce((s, q) => s + q.score, 0);
      score = Math.round(totalScore / perQuestion.length);

      // Generate overall summary via LLM
      const answeredCount  = perQuestion.filter(q => q.answered).length;
      const correctCount   = perQuestion.filter(q => q.correct).length;
      const summaryPrompt  = `A student completed ${answeredCount} out of ${questionImages.length} pages of their assignment.
Pages scoring 70%+: ${correctCount}. Scores per page: ${perQuestion.map(q => `Page${q.number}=${q.score}%`).join(', ')}.
Overall score: ${score}%.
Assignment: ${assignment.title}, Subject: ${assignment.subject}${assignment.grade ? ', Grade: ' + assignment.grade : ''}.

Write a 2-3 sentence warm but honest summary feedback for an 8-year-old student.
Also provide: a "wellDone" (one specific strength), and an "improve" (one specific area to work on).
Respond ONLY as JSON: {"text": "...", "wellDone": "...", "improve": "..."}`;

      const summaryComp = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: summaryPrompt }],
        response_format: { type: 'json_object' },
      });
      const summary = JSON.parse(summaryComp.choices[0].message.content);

      feedback = JSON.stringify({
        text:        summary.text     || `You answered ${answeredCount} of ${questions.length} questions.`,
        stamp:       score >= 85 ? 'Amazing Work!' : score >= 60 ? 'Good Effort!' : 'Keep Trying!',
        wellDone:    summary.wellDone || '',
        improve:     summary.improve  || '',
        perQuestion,
      });

    } else if (imageBase64) {
      // â”€â”€ LEGACY FLOW: single image, all questions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const questionList = questions.length > 0
        ? questions.map((q, i) => `Q${i+1}: ${q}`).join('\n')
        : 'No specific questions â€” assess overall work.';

      const prompt = `You are a teacher grading a student's handwritten assignment.
Assignment: ${assignment.title}, Subject: ${assignment.subject}
${assignment.grade ? 'Grade: ' + assignment.grade : ''}

Questions:
${questionList}

For EACH question: check if answered in the image. If not answered set answered=false, score=0.
Overall score = honest average of per-question scores.

Respond ONLY as JSON:
{
  "score": 0-100,
  "feedback": "2-3 sentence warm honest summary",
  "stamp": "Amazing Work! or Good Effort! or Keep Trying!",
  "wellDone": "specific strength",
  "improve": "specific gap",
  "perQuestion": [{"number":1,"question":"...","answered":bool,"score":0-100,"studentAnswer":"...","correct":bool,"comment":"..."}]
}`;

      const completion = await groq.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
          ],
        }],
      });
      const raw  = completion.choices[0].message.content.replace(/```json[\s\S]*?```|```/g, '').trim();
      const result = JSON.parse(raw);
      perQuestion = Array.isArray(result.perQuestion) ? result.perQuestion : [];
      if (perQuestion.length > 0) {
        score = Math.round(perQuestion.reduce((s, q) => s + (Number(q.score) || 0), 0) / perQuestion.length);
      } else {
        score = Math.max(0, Math.min(100, Number(result.score) || 70));
      }
      feedback = JSON.stringify({
        text: result.feedback || '', stamp: result.stamp || '', wellDone: result.wellDone || '', improve: result.improve || '', perQuestion,
      });
    }

  } catch (e) {
    console.error('Grading error:', e.message);
    score    = null;
    feedback = 'Your submission was received! Your teacher will review it soon.';
  }

  const { data: updated, error: updateErr } = await supabase
    .from('assignments')
    .update({
      status:          'completed',
      score,
      ai_feedback:     feedback,
      submission_text: perQuestion.length > 0 ? JSON.stringify({ perQuestion }) : null,
      completed_at:    new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  res.json({ ...normalise(updated), aiFeedback: feedback, perQuestion });
});

// â”€â”€ PUT /assignments/:id/complete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.put('/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { score = null } = req.body;

  const { data, error } = await supabase
    .from('assignments')
    .update({ status: 'completed', score, completed_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(normalise(data));
});

// â”€â”€ DELETE /assignments/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  // Also remove from schedule
  try {
    const schedule = readSchedule();
    writeSchedule(schedule.filter(e => e.assignmentId !== id));
  } catch (_) {}
  const { error } = await supabase.from('assignments').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function stripOptionPrefix(value) {
  return String(value ?? '').replace(/^[A-D]\.\s*/i, '').trim();
}

function normalizeQuizCount(value, fallback = 5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

function normaliseAnswerToOptionText(answer, options = []) {
  const safeOptions = Array.isArray(options)
    ? options.map(opt => stripOptionPrefix(opt)).filter(Boolean)
    : [];
  if (safeOptions.length === 0) return stripOptionPrefix(answer);

  if (typeof answer === 'number' && Number.isInteger(answer) && answer >= 0 && answer < safeOptions.length) {
    return safeOptions[answer];
  }

  if (typeof answer === 'string') {
    const raw = answer.trim();
    if (!raw) return '';

    const letter = raw.match(/^([A-D])(?:\.|\b)/i)?.[1]?.toUpperCase();
    if (letter && MCQ_LETTER_TO_INDEX[letter] != null) {
      return safeOptions[MCQ_LETTER_TO_INDEX[letter]] || safeOptions[0];
    }

    if (/^\d+$/.test(raw)) {
      const parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= safeOptions.length) {
        return safeOptions[parsed - 1];
      }
      if (Number.isInteger(parsed) && parsed >= 0 && parsed < safeOptions.length) {
        return safeOptions[parsed];
      }
    }
  }

  const cleaned = stripOptionPrefix(answer);
  const exact = safeOptions.find(opt => normalizeText(opt) === normalizeText(cleaned));
  return exact || cleaned;
}

function normalizeQuizQuestion(question, index) {
  if (!question || typeof question !== 'object') return null;

  const prompt = String(question.question || '').trim();
  const options = Array.isArray(question.options)
    ? question.options.map(opt => stripOptionPrefix(opt)).filter(Boolean).slice(0, 4)
    : [];

  if (!prompt || options.length !== 4) return null;

  const correctOption = normaliseAnswerToOptionText(question.correct, options);
  const correct = options.find(opt => normalizeText(opt) === normalizeText(correctOption)) || options[0];

  return {
    id: String(question.id || `q${index + 1}`),
    question: prompt,
    type: 'mcq',
    options,
    correct,
    hint: question.hint ? String(question.hint) : '',
    explanation: question.explanation ? String(question.explanation) : '',
  };
}

function normalizeQuizQuestions(items = [], count = null) {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item, index) => normalizeQuizQuestion(item, index))
    .filter(Boolean);

  if (count == null) return normalized;
  const safeCount = normalizeQuizCount(count, 5);
  return normalized.slice(0, safeCount);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildFallbackQuiz({ subject = '', chapter = '', count = 5 }) {
  const safeCount = normalizeQuizCount(count, 5);
  const topic = `${chapter || subject}`.toLowerCase();
  const subjectLower = String(subject || '').toLowerCase();

  let bank = [
    { question: 'What is 7 + 5?', options: ['12', '10', '13', '11'], correct: '12', hint: 'Count forward from 7.', explanation: '7 and 5 together make 12.' },
    { question: 'What is 15 - 6?', options: ['9', '8', '10', '7'], correct: '9', hint: 'Take away 6 from 15.', explanation: '15 minus 6 equals 9.' },
    { question: 'How many sides does a triangle have?', options: ['3', '4', '5', '6'], correct: '3', hint: 'A triangle is the simplest polygon.', explanation: 'A triangle always has 3 sides.' },
    { question: 'What comes next: 2, 4, 6, 8, ?', options: ['10', '9', '12', '11'], correct: '10', hint: 'The pattern adds 2 each time.', explanation: 'After 8, adding 2 gives 10.' },
    { question: 'How many rupees are in 2 coins of ₹5 each?', options: ['10', '5', '15', '20'], correct: '10', hint: 'Add 5 and 5.', explanation: 'Two ₹5 coins add up to ₹10.' },
  ];

  if (topic.includes('fraction')) {
    bank = [
      { question: 'Which fraction means one half?', options: ['1/2', '1/3', '2/3', '3/4'], correct: '1/2', hint: 'Half means 2 equal parts.', explanation: 'One half is written as 1/2.' },
      { question: 'Which fraction is bigger?', options: ['3/4', '1/4', '1/2', '2/8'], correct: '3/4', hint: 'Think about which is closest to 1 whole.', explanation: '3/4 is greater than 1/2 and 1/4.' },
      { question: 'If a pizza is cut into 4 equal parts and you eat 1 part, what fraction did you eat?', options: ['1/4', '1/2', '2/4', '3/4'], correct: '1/4', hint: 'One part out of four.', explanation: 'Eating 1 of 4 equal parts is 1/4.' },
      { question: 'Which shows two equal parts out of four?', options: ['2/4', '1/4', '3/4', '4/2'], correct: '2/4', hint: 'Look for numerator 2 and denominator 4.', explanation: '2/4 means two out of four equal parts.' },
      { question: 'Which fraction is equal to 1/2?', options: ['2/4', '1/4', '3/4', '4/5'], correct: '2/4', hint: 'Double top and bottom of 1/2.', explanation: '1/2 and 2/4 represent the same amount.' },
    ];
    for (let i = 0; i < 6; i += 1) {
      const denominator = [2, 3, 4, 5, 6, 8][randInt(0, 5)];
      const numerator = randInt(1, denominator - 1);
      const correct = `${numerator}/${denominator}`;
      const options = shuffleArray([
        correct,
        `${Math.max(1, numerator - 1)}/${denominator}`,
        `${Math.min(denominator - 1, numerator + 1)}/${denominator}`,
        `${numerator}/${denominator + 1}`,
      ]).slice(0, 4);
      bank.push({
        question: `Which fraction shows ${numerator} part${numerator > 1 ? 's' : ''} out of ${denominator} equal parts?`,
        options,
        correct,
        hint: 'Read numerator first, denominator second.',
        explanation: `${correct} means ${numerator} out of ${denominator} equal parts.`,
      });
    }
  } else if (topic.includes('decimal')) {
    bank = [
      { question: 'Which is greater?', options: ['0.8', '0.6', '0.5', '0.4'], correct: '0.8', hint: 'Tenths: 8 tenths is more than 6 tenths.', explanation: '0.8 is the largest among these decimals.' },
      { question: 'What is 0.2 + 0.3?', options: ['0.5', '0.4', '0.6', '0.3'], correct: '0.5', hint: '2 tenths + 3 tenths.', explanation: '0.2 + 0.3 = 0.5.' },
      { question: 'Which decimal is equal to one whole?', options: ['1.0', '0.1', '0.01', '10.0'], correct: '1.0', hint: 'One whole can be written with a decimal point.', explanation: '1.0 means one whole.' },
      { question: 'Which is smaller?', options: ['0.25', '0.5', '0.75', '0.9'], correct: '0.25', hint: 'Compare tenths and hundredths carefully.', explanation: '0.25 is less than 0.5, 0.75, and 0.9.' },
      { question: 'What is 0.7 - 0.2?', options: ['0.5', '0.4', '0.6', '0.3'], correct: '0.5', hint: 'Subtract tenths.', explanation: '7 tenths minus 2 tenths is 5 tenths.' },
    ];
    for (let i = 0; i < 6; i += 1) {
      const a = randInt(2, 8) / 10;
      const b = randInt(1, 3) / 10;
      const sum = (a + b).toFixed(1);
      const options = shuffleArray([
        sum,
        (a + b + 0.1).toFixed(1),
        (a + b - 0.1).toFixed(1),
        (a + b + 0.2).toFixed(1),
      ]).slice(0, 4);
      bank.push({
        question: `What is ${a.toFixed(1)} + ${b.toFixed(1)}?`,
        options,
        correct: sum,
        hint: 'Add tenths carefully.',
        explanation: `${a.toFixed(1)} plus ${b.toFixed(1)} equals ${sum}.`,
      });
    }
  } else if (subjectLower.includes('science')) {
    bank = [
      { question: 'Which is a living thing?', options: ['Plant', 'Rock', 'Table', 'Bottle'], correct: 'Plant', hint: 'Living things grow.', explanation: 'Plants are living because they grow and need water.' },
      { question: 'Which part of a plant takes water from soil?', options: ['Roots', 'Leaves', 'Flower', 'Fruit'], correct: 'Roots', hint: 'This part stays underground.', explanation: 'Roots absorb water and minerals from the soil.' },
      { question: 'Which habit keeps us healthy?', options: ['Washing hands', 'Skipping sleep', 'Eating only sweets', 'Never exercising'], correct: 'Washing hands', hint: 'Clean habits prevent germs.', explanation: 'Washing hands helps stop germs from spreading.' },
      { question: 'The Sun gives us:', options: ['Light and heat', 'Rain', 'Soil', 'Plastic'], correct: 'Light and heat', hint: 'Think daytime warmth.', explanation: 'The Sun gives Earth light and heat.' },
      { question: 'Which item should go in a dustbin?', options: ['Banana peel', 'Clean water', 'Fresh air', 'Sunlight'], correct: 'Banana peel', hint: 'It is waste after eating fruit.', explanation: 'Food waste like peels should be put in a bin.' },
    ];
  } else {
    for (let i = 0; i < 8; i += 1) {
      const a = randInt(4, 20);
      const b = randInt(2, 9);
      const correct = String(a + b);
      const options = shuffleArray([
        correct,
        String(a + b + 1),
        String(Math.max(0, a + b - 1)),
        String(a + b + 2),
      ]).slice(0, 4);
      bank.push({
        question: `What is ${a} + ${b}?`,
        options,
        correct,
        hint: 'Add ones and tens carefully.',
        explanation: `${a} + ${b} = ${correct}.`,
      });
    }
  }

  const shuffled = shuffleArray(bank);
  const chosen = Array.from({ length: safeCount }).map((_, idx) => {
    const tpl = shuffled[idx % shuffled.length];
    return {
      id: `q${idx + 1}`,
      question: tpl.question,
      type: 'mcq',
      options: shuffleArray(tpl.options),
      correct: tpl.correct,
      hint: tpl.hint,
      explanation: tpl.explanation,
    };
  });

  return normalizeQuizQuestions(chosen, safeCount);
}

const DEMO_MAP = {
  'student_alex001': '00000000-0000-0000-0000-000000000001',
  'student_mia001':  '00000000-0000-0000-0000-000000000002',
  'sarah@demo.com':  '00000000-0000-0000-0000-000000000003',
  'teacher@demo.com':'00000000-0000-0000-0000-000000000004',
};

async function resolveUserId(id) {
  if (!id) return null;
  if (DEMO_MAP[id]) return DEMO_MAP[id];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id;
  if (id.includes('@')) {
    const { data } = await supabase.from('users').select('id').eq('email', id).single();
    return data?.id || null;
  }
  return null;
}

function normalise(a) {
  return {
    id:          a.id,
    title:       a.title,
    subject:     a.subject,
    chapter:     a.chapter,
    dueDate:     a.due_date,
    type:        a.type,
    note:        a.note,
    studentId:   a.student_id,
    createdBy:   a.created_by_role ?? 'teacher',
    status:      a.status,
    score:       a.score,
    createdAt:   a.created_at,
    completedAt: a.completed_at,
    grade:       a.grade,
    curriculum:  a.curriculum,
    questions:   a.questions || [],
    aiFeedback:       a.ai_feedback || null,
    documentUrl:      a.document_url || null,
    documentUrls:     a.document_urls || [],
    successCriteria:  a.success_criteria || [],
    taskSteps:        Array.isArray(a.task_steps) ? a.task_steps : [],
    quizQuestions:    Array.isArray(a.quiz_questions) ? a.quiz_questions : [],
  };
}

module.exports = router;

