import React, { useMemo, useState, useEffect, useCallback, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, RefreshControl,
  Platform, KeyboardAvoidingView, Image, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import SERVER_URL from '../../config/serverUrl';
// @ts-ignore — pdfjs-dist v3 CommonJS import
const pdfjsLib = Platform.OS === 'web' ? require('pdfjs-dist/build/pdf') : null;
// @ts-ignore
const pdfjsWorker = Platform.OS === 'web' ? require('pdfjs-dist/build/pdf.worker.entry') : null;
if (pdfjsLib && typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  (window as any).__pdfjsLib = pdfjsLib;
}

/** Convert a PDF file (base64) into per-page JPEG images using browser canvas */
async function pdfToImages(pdfBase64: string): Promise<{ base64: string; mime: string; name: string }[]> {
  if (Platform.OS !== 'web') return [];
  try {
    console.log('[pdfToImages] Starting, pdfjs version:', pdfjsLib.version);
    const raw = atob(pdfBase64);
    const data = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);

    const doc = await pdfjsLib.getDocument({ data, disableWorker: true }).promise;
    console.log('[pdfToImages] PDF parsed, pages:', doc.numPages);

    const pages: { base64: string; mime: string; name: string }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { console.error('[pdfToImages] No canvas context for page', i); continue; }
      await page.render({ canvasContext: ctx, viewport }).promise;
      const jpegUrl = canvas.toDataURL('image/jpeg', 0.85);
      pages.push({ base64: jpegUrl.split(',')[1], mime: 'image/jpeg', name: `page-${i}.jpg` });
      console.log('[pdfToImages] Rendered page', i, '/', doc.numPages);
    }
    return pages;
  } catch (err: any) {
    console.error('[pdfToImages] FAILED:', err?.message || err, err?.stack);
    return [];
  }
}

type Assignment = {
  id: string;
  title: string;
  subject: string;
  chapter: string;
  dueDate: string;
  type: 'assignment' | 'quiz';
  note: string;
  studentId: string | null;
  createdBy: string;
  status: 'pending' | 'completed';
  score: number | null;
  createdAt: string;
  completedAt?: string | null;
  grade?: string | null;
  curriculum?: string | null;
  aiFeedback?: string | null;
  questions?: any[];
  quizQuestions?: any[];
  taskSteps?: any[];
  successCriteria?: string[];
};

interface StudentItem { id: string; name: string; grade: string; curriculum?: string | null; }

type StepType =
  | 'brainstorm' | 'drawing' | 'structured_writing' | 'problem_solving'
  | 'tuning_in' | 'math_reflection' | 'prior_knowledge'
  | 'text_connection' | 'reading_comprehension' | 'writing_reflection'
  | 'language_culture' | 'language_practice' | 'communication'
  | 'social_inquiry' | 'research_notes' | 'social_synthesis'
  | 'artistic_exploration' | 'art_creation' | 'artistic_reflection'
  | 'digital_awareness' | 'tech_skill_practice' | 'digital_citizenship'
  | 'movement_exploration' | 'skill_practice' | 'physical_reflection';

interface TaskStep {
  id: string;
  type: StepType;
  label: string;
  instructions: string;
  sections: string[];
  wordBank: string[];
  problems?: string[];
  reflectionPrompts?: string[];
  provocation?: string;
}

const STEP_DEFAULTS: Record<StepType, Partial<TaskStep>> = {
  brainstorm:           { label: 'Thinking Clouds',         instructions: 'Write keywords that come to mind.', sections: [], wordBank: [] },
  drawing:              { label: 'Draw Your Answer',         instructions: 'Draw and label your answer.', sections: [], wordBank: [] },
  structured_writing:   { label: 'Write a Response',        instructions: 'Write with a clear beginning, middle, and end.', sections: ['Beginning', 'Middle', 'End'], wordBank: [] },
  problem_solving:      { label: 'Practice Problems',        instructions: 'Solve each problem. Show your working.', sections: [], wordBank: [], problems: [] },
  tuning_in:            { label: 'Tuning In',                instructions: 'Read the scenario and write your initial thinking.', sections: [], wordBank: [], provocation: '' },
  math_reflection:      { label: 'Math Reflection',          instructions: 'Reflect using the three prompts below.', sections: ['My Strategy', 'What Was Tricky', 'Real Life Connection'], wordBank: [], reflectionPrompts: [] },
  prior_knowledge:      { label: 'Prior Knowledge',          instructions: 'Write what you know and what you predict.', sections: ['What I Already Know', 'What I Predict'], wordBank: [] },
  text_connection:      { label: 'Text Connection',          instructions: 'Read and write your personal connection to the text.', sections: [], wordBank: [], provocation: '' },
  reading_comprehension:{ label: 'Reading Comprehension',    instructions: 'Answer the questions about the text.', sections: ['What Happened?', 'Reading Between the Lines', 'My Thinking'], wordBank: [] },
  writing_reflection:   { label: 'Writing Reflection',       instructions: 'Reflect on your reading using the three prompts.', sections: ['Most Important Idea', 'Connection to Our Unit', 'My Question for the Author'], wordBank: [], reflectionPrompts: [] },
  language_culture:     { label: 'Language & Culture',        instructions: 'Explore the language and cultural connection.', sections: [], wordBank: [], provocation: '' },
  language_practice:    { label: 'Language Practice',         instructions: 'Practise vocabulary and write in the target language.', sections: ['Vocabulary Practice', 'My Sentences', 'Cultural Connection'], wordBank: [] },
  communication:        { label: 'Communication',             instructions: 'Write a paragraph and reflect on your language learning.', sections: ['My Paragraph', 'Favourite Word or Phrase', 'Cultural Comparison'], wordBank: [], reflectionPrompts: [] },
  social_inquiry:       { label: 'Social Inquiry',            instructions: 'Observe and wonder about the provocation.', sections: [], wordBank: [], provocation: '' },
  research_notes:       { label: 'Research Notes',            instructions: 'Research and record notes in each section.', sections: ['Key Facts', 'People and Perspectives', 'Cause and Effect'], wordBank: [] },
  social_synthesis:     { label: 'Social Synthesis',          instructions: 'Synthesise your learning using the three prompts.', sections: ['What I Learned and Why It Matters', 'Connection to Our World', 'Taking Action'], wordBank: [], reflectionPrompts: [] },
  artistic_exploration: { label: 'Art Exploration',           instructions: 'Observe the artwork and write your response.', sections: [], wordBank: [], provocation: '' },
  art_creation:         { label: 'Art Creation',              instructions: 'Create your artwork and upload a photo.', sections: [], wordBank: [] },
  artistic_reflection:  { label: 'Artist Statement',          instructions: 'Reflect on your artwork using the three prompts.', sections: ['About My Artwork', 'What I Was Trying to Express', 'Challenges and Improvements'], wordBank: [], reflectionPrompts: [] },
  digital_awareness:    { label: 'Digital Awareness',         instructions: 'Explore technology use and write your response.', sections: [], wordBank: [], provocation: '' },
  tech_skill_practice:  { label: 'Tech Skill Practice',       instructions: 'Complete the digital task and describe your creation.', sections: ['Step-by-Step Task', 'My Digital Creation', 'How I Checked My Sources'], wordBank: [] },
  digital_citizenship:  { label: 'Digital Citizenship',       instructions: 'Reflect on responsible technology use.', sections: ['What I Learned to Do', 'Being a Responsible Digital Citizen', 'Technology for Good'], wordBank: [], reflectionPrompts: [] },
  movement_exploration: { label: 'Movement Exploration',      instructions: 'Write about the movement concept.', sections: [], wordBank: [], provocation: '' },
  skill_practice:       { label: 'Skill Practice',            instructions: 'Describe and record your physical practice.', sections: ['Key Skill Steps', 'My Practice Record', 'Teamwork and Fairness'], wordBank: [] },
  physical_reflection:  { label: 'PE Reflection',             instructions: 'Reflect on your physical learning and set goals.', sections: ['What I Did Well', 'My Next Step', 'Health and Wellbeing Connection'], wordBank: [], reflectionPrompts: [] },
};
const STEP_ICONS: Record<StepType, string> = {
  brainstorm: 'cloud', drawing: 'edit-3', structured_writing: 'align-left', problem_solving: 'hash',
  tuning_in: 'zap', math_reflection: 'rotate-ccw', prior_knowledge: 'bookmark',
  text_connection: 'book-open', reading_comprehension: 'search', writing_reflection: 'feather',
  language_culture: 'globe', language_practice: 'message-circle', communication: 'mic',
  social_inquiry: 'compass', research_notes: 'file-text', social_synthesis: 'layers',
  artistic_exploration: 'eye', art_creation: 'edit-3', artistic_reflection: 'aperture',
  digital_awareness: 'monitor', tech_skill_practice: 'cpu', digital_citizenship: 'shield',
  movement_exploration: 'activity', skill_practice: 'trending-up', physical_reflection: 'heart',
};
const STEP_COLORS: Record<StepType, string> = {
  brainstorm: '#C5BD96', drawing: '#D4A898', structured_writing: '#93B0AC', problem_solving: '#C3DCD8',
  tuning_in: '#D8C4E8', math_reflection: '#B8D4C8', prior_knowledge: '#EBD5B8',
  text_connection: '#EAD4D8', reading_comprehension: '#D8C4E8', writing_reflection: '#C5BD96',
  language_culture: '#D4C4A8', language_practice: '#B8CCD4', communication: '#C8D4A8',
  social_inquiry: '#D8C8A8', research_notes: '#B8C8D8', social_synthesis: '#C4D0C4',
  artistic_exploration: '#E8D4C4', art_creation: '#D4A898', artistic_reflection: '#DCC8D4',
  digital_awareness: '#C4D4E0', tech_skill_practice: '#B8D8D0', digital_citizenship: '#C0CCD8',
  movement_exploration: '#C8D8B8', skill_practice: '#B8D4BC', physical_reflection: '#D0D8C0',
};

const TABS = ['All', 'Active', 'Completed'];
const SUBJECTS = [
  'Mathematics', 'Science', 'English', 'Social Studies', 'Language Acquisition',
  'Visual Arts', 'ICT', 'Physical Education',
];
const ALL_GRADES = ['Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'];
const IB_GRADES  = ['Grade 3', 'Grade 4', 'Grade 5'];
const LANGUAGES = ['Telugu', 'Hindi', 'Tamil', 'Kannada', 'French', 'Spanish', 'Mandarin', 'Arabic'];
const TYPES = ['assignment', 'quiz'];
// Enchanting Forest palette
const SUBJECT_COLORS: Record<string, string> = {
  Mathematics:    '#5F8A86',
  Science:        '#5A8A70',
  English:        '#B8797E',
  'Social Studies': '#8A8358',
  'Language Acquisition': '#7AADA8',
  'Visual Arts':          '#9A7A8A',
  'ICT':                  '#6A8AA0',
  'Physical Education':   '#6A8A6A',
};

function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, overdue: true };
  if (days === 0) return { label: 'Due today', overdue: false };
  return { label: `Due in ${days}d`, overdue: false };
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TeacherAssignmentsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('All');
  const [showModal, setShowModal] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Mathematics');
  const teacherCurriculum = user?.teaches?.[0]?.curriculum || user?.curriculum || '';
  const defaultGrade = user?.teaches?.[0]?.grade || 'Grade 3';
  const [grade, setGrade] = useState(defaultGrade);
  const [curriculum, setCurriculum] = useState(teacherCurriculum);
  const [chapter, setChapter] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [type, setType] = useState<'assignment' | 'quiz'>('assignment');
  const [note, setNote] = useState('');
  const [questions, setQuestions] = useState<string[]>(['']);
  const [successCriteria, setSuccessCriteria] = useState<string[]>(['']);
  const [taskSteps, setTaskSteps] = useState<TaskStep[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [generatingSteps, setGeneratingSteps] = useState(false);
  const [stepsError, setStepsError] = useState('');
  const [quizDifficulty, setQuizDifficulty] = useState<'easy'|'medium'|'hard'>('medium');
  const [quizCount, setQuizCount] = useState(5);
  const [teacherNotes, setTeacherNotes] = useState('');
  const [docFiles, setDocFiles] = useState<{ name: string; base64: string; mime: string; url?: string }[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [extractingQuestions, setExtractingQuestions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  // Extracted questions from PDF/image — editable by teacher before publishing
  const [extractedQuestions, setExtractedQuestions] = useState<{ question: string; answer: string; comment: string }[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  // Crop modal state: which question index is being assigned an image
  const [cropModalIdx, setCropModalIdx] = useState<number | null>(null);
  const [cropSelection, setCropSelection] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cropPageIdx, setCropPageIdx] = useState(0);
  const [generatingFromExtracted, setGeneratingFromExtracted] = useState(false);
  // Creation mode: 'choose' (initial), 'ai' (IB PYP AI), 'upload' (PDF/Image worksheet)
  const [createMode, setCreateMode] = useState<'choose' | 'ai' | 'upload'>('choose');
  const [reportAssignment, setReportAssignment] = useState<Assignment | null>(null);
  const [detailAssignment, setDetailAssignment] = useState<Assignment | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'students' | 'questions'>('overview');
  const [detailSubmissions, setDetailSubmissions] = useState<any[]>([]);
  const [detailTotalLinked, setDetailTotalLinked] = useState(0);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [teacherFeedback, setTeacherFeedback] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  // IB PYP fields
  const [selectedLanguage, setSelectedLanguage] = useState('Telugu');
  const [unitOfInquiry, setUnitOfInquiry] = useState('');
  const [ibPurpose, setIbPurpose] = useState('');
  const [ibLearningOutcomes, setIbLearningOutcomes] = useState<string[]>(['']);
  const [ibWordBank, setIbWordBank] = useState<string[]>([]);
  const [ibStamps, setIbStamps] = useState<string[]>([]);
  const [ibCentralIdea, setIbCentralIdea] = useState('');
  const [ibLinesOfInquiry, setIbLinesOfInquiry] = useState<string[]>([]);
  const [ibLearnerProfile, setIbLearnerProfile] = useState('');
  const [ibAtlSkill, setIbAtlSkill] = useState('');
  const [ibKeyConcept, setIbKeyConcept] = useState('');
  const [generatingIB, setGeneratingIB] = useState(false);

  // Student picker
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [assignTo, setAssignTo] = useState<'all' | 'specific'>('all');
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [studentSearch, setStudentSearch] = useState('');

  const teacherEmail = user?.email || 'teacher@demo.com';
  const isIBPYP = (curriculum || teacherCurriculum || '').toLowerCase().includes('ib');

  // Grade pills: only show grades the teacher handles; fall back to full list
  const teacherGrades = Array.isArray(user?.teaches) && user.teaches.length > 0
    ? user.teaches.map((t: any) => t.grade || t).filter(Boolean)
    : null;
  const gradeOptions = teacherGrades
    ? (isIBPYP ? IB_GRADES : ALL_GRADES).filter(g => teacherGrades.includes(g))
    : isIBPYP ? IB_GRADES : ALL_GRADES;

  // When curriculum changes, clamp grade to valid options for this teacher
  useEffect(() => {
    if (gradeOptions.length > 0 && !gradeOptions.includes(grade)) setGrade(gradeOptions[0]);
  }, [isIBPYP]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/assignments?teacherId=${encodeURIComponent(teacherEmail)}`);
      if (res.ok) setAssignments(await res.json());
    } catch {/* network */} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [teacherEmail]);

  useEffect(() => { load(); }, [load]);

  // Keep curriculum + grade in sync when user profile loads after initial render
  useEffect(() => {
    const c = user?.teaches?.[0]?.curriculum || user?.curriculum;
    if (c) setCurriculum(c);
    const g = user?.teaches?.[0]?.grade;
    if (g) setGrade(g);
  }, [user?.curriculum, user?.teaches]);

  useEffect(() => {
    if (!detailAssignment) { setDetailSubmissions([]); setDetailTotalLinked(0); setDetailTab('overview'); setExpandedStudent(null); setTeacherFeedback(''); return; }
    setLoadingSubmissions(true);
    fetch(`${SERVER_URL}/assignments/${detailAssignment.id}/submissions`)
      .then(r => r.ok ? r.json() : { submissions: [], totalLinked: 0 })
      .then(data => { setDetailSubmissions(data.submissions || []); setDetailTotalLinked(data.totalLinked || 0); })
      .catch(() => {})
      .finally(() => setLoadingSubmissions(false));
  }, [detailAssignment?.id]);

  useEffect(() => {
    if (!teacherEmail) return;
    fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(teacherEmail)}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: StudentItem[]) => {
        // Filter to only show students matching the teacher's curriculum
        const tc = user?.teaches?.[0]?.curriculum || user?.curriculum || '';
        const matched = tc
          ? data.filter(s => !s.curriculum || s.curriculum === tc)
          : data;

        if (matched.length > 0) {
          setStudents(matched);
        } else {
          // Fallback: fetch all students by curriculum from server
          const params = tc ? `?curriculum=${encodeURIComponent(tc)}` : '';
          fetch(`${SERVER_URL}/student/by-curriculum${params}`)
            .then(r => r.ok ? r.json() : [])
            .then((fallback: StudentItem[]) => setStudents(fallback))
            .catch(() => setStudents(matched));
        }
      })
      .catch(() => {});
  }, [teacherEmail]);

  const filtered = assignments.filter(a => {
    if (activeTab === 'Active') return a.status === 'pending';
    if (activeTab === 'Completed') return a.status === 'completed';
    return true;
  });

  const stats = {
    total: assignments.length,
    active: assignments.filter(a => a.status === 'pending').length,
    completed: assignments.filter(a => a.status === 'completed').length,
    overdue: assignments.filter(a => a.status === 'pending' && new Date(a.dueDate) < new Date()).length,
  };

  async function createAssignment() {
    if (!title.trim()) { setFormError('Title is required'); return; }
    if (!dueDate.trim()) { setFormError('Due date is required'); return; }
    if (type === 'quiz' && quizQuestions.length === 0) { setFormError('Generate quiz questions first before assigning this quiz.'); return; }
    setFormError('');
    setCreating(true);
    console.log('[createAssignment] Publishing...', { title, subject, grade, curriculum, type, dueDate, docFiles: docFiles.length, questions: questions.length, quizQuestions: quizQuestions.length });
    try {
      // Upload cropped question images to Cloudinary before creating assignment
      const uploadedExtracted = await (async () => {
        if (extractedQuestions.length === 0) return [];
        const results = [];
        for (const eq of extractedQuestions) {
          let imageUrl = '';
          if (eq.croppedImage && eq.croppedImage.startsWith('data:')) {
            try {
              const base64Data = eq.croppedImage.split(',')[1] || '';
              const uploadRes = await fetch(`${SERVER_URL}/assignments/upload-doc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileBase64: base64Data, fileName: `crop_q${results.length + 1}.png`, mimeType: 'image/png' }),
              });
              const uploadData = await uploadRes.json();
              if (uploadData.url) imageUrl = uploadData.url;
            } catch (e) { console.warn('[createAssignment] crop upload failed:', e); }
          }
          results.push({
            question: eq.question,
            expectedAnswer: eq.answer || '',
            comment: eq.comment || '',
            croppedImage: imageUrl,
          });
        }
        return results;
      })();

      const res = await fetch(`${SERVER_URL}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          subject,
          chapter: chapter.trim(),
          dueDate,
          type,
          studentId: assignTo === 'specific' ? (selectedStudent?.id ?? null) : null,
          createdById: teacherEmail,
          createdByRole: 'teacher',
          grade,
          curriculum,
          // Merge plain questions + extracted questions from worksheet as structured objects
          questions: (() => {
            const plain = questions.filter(q => q.trim());
            if (uploadedExtracted.length > 0) return uploadedExtracted;
            return plain;
          })(),
          // Include expected answers from extracted questions for AI validation
          questionAnswers: extractedQuestions.filter(q => q.answer.trim()).reduce((acc, q) => {
            acc[q.question] = q.answer;
            return acc;
          }, {} as Record<string, string>),
          teacherComments: extractedQuestions.filter(q => q.comment.trim()).map(q => ({ question: q.question, comment: q.comment })),
          // Merge IB learning outcomes into successCriteria if present, else use manual list
          successCriteria: ibLearningOutcomes.filter(l => l.trim()).length > 0
            ? ibLearningOutcomes.filter(l => l.trim())
            : successCriteria.filter(c => c.trim()),
          // Merge ibWordBank into the structured_writing step so students see the word bank
          taskSteps: taskSteps.map(s => ({
            ...s,
            wordBank: s.type === 'structured_writing' && ibWordBank.length > 0
              ? ibWordBank
              : (s.wordBank || []),
          })),
          quizQuestions: quizQuestions,
          documentUrl: docFiles[0]?.url || null,
          documentUrls: docFiles.map(f => f.url).filter(Boolean),
          // Store ibPurpose in note field so students see the assignment purpose
          note: ibPurpose.trim() || note.trim(),
          unitOfInquiry: unitOfInquiry.trim() || null,
          language: subject === 'Language Acquisition' ? selectedLanguage : null,
          centralIdea: ibCentralIdea || null,
          linesOfInquiry: ibLinesOfInquiry.filter(l => l.trim()),
          learnerProfile: ibLearnerProfile || null,
          atlSkill: ibAtlSkill || null,
          keyConcept: ibKeyConcept || null,
        }),
      });
      const responseText = await res.text();
      console.log('[createAssignment] Response:', res.status, responseText.substring(0, 500));
      if (res.ok) {
        const created = JSON.parse(responseText);
        setAssignments(prev => [created, ...prev]);
        setShowModal(false);
        setShowPreview(false);
        resetForm();
      } else {
        let errMsg = 'Failed to create';
        try { errMsg = JSON.parse(responseText).error || errMsg; } catch {}
        setFormError(errMsg);
      }
    } catch {
      setFormError('Network error. Check server connection.');
    } finally {
      setCreating(false);
    }
  }

  function pickDoc() {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.multiple = true;
    input.onchange = async (e: any) => {
      const files: File[] = Array.from(e.target.files || []);
      if (files.length === 0) return;
      setUploadingDoc(true);

      // Read all files as base64
      const readFile = (f: File): Promise<{ name: string; base64: string; mime: string }> =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const result = ev.target?.result as string;
            resolve({ name: f.name, base64: result.split(',')[1], mime: f.type });
          };
          reader.readAsDataURL(f);
        });

      let fileDataArr = await Promise.all(files.map(readFile));

      // Convert PDFs to per-page images for vision-based extraction
      console.log('[upload] Files before PDF conversion:', fileDataArr.map(f => `${f.name} (${f.mime})`));
      const expanded: typeof fileDataArr = [];
      for (const fd of fileDataArr) {
        if (fd.mime === 'application/pdf') {
          console.log('[upload] Converting PDF to images:', fd.name);
          const pageImages = await pdfToImages(fd.base64);
          console.log('[upload] PDF converted to', pageImages.length, 'images');
          if (pageImages.length > 0) {
            expanded.push(...pageImages);
          } else {
            console.log('[upload] PDF conversion failed, sending as PDF');
            expanded.push(fd); // Fallback: send PDF as-is
          }
        } else {
          expanded.push(fd);
        }
      }
      fileDataArr = expanded;
      console.log('[upload] Files after PDF conversion:', fileDataArr.map(f => `${f.name} (${f.mime})`));

      // Upload all files (now all images)
      const uploadedFiles: { name: string; base64: string; mime: string; url?: string }[] = [];
      for (const fd of fileDataArr) {
        try {
          const res = await fetch(`${SERVER_URL}/assignments/upload-doc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileBase64: fd.base64, fileName: fd.name, mimeType: fd.mime }),
          });
          const data = await res.json();
          if (res.ok) {
            uploadedFiles.push({ name: fd.name, base64: fd.base64, mime: fd.mime, url: data.url });
          }
        } catch {/* skip failed uploads */}
      }

      if (uploadedFiles.length > 0) {
        setDocFiles(prev => [...prev, ...uploadedFiles]);
      }
      setUploadingDoc(false);

      // Extract content from all uploaded files (all are images now)
      if (uploadedFiles.length > 0) {
        setExtractingQuestions(true);
        try {
          const allBase64 = uploadedFiles.map(f => ({ base64: f.base64, mimeType: f.mime }));
          const eRes = await fetch(`${SERVER_URL}/assignments/extract-questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              allBase64.length === 1
                ? { fileBase64: allBase64[0].base64, mimeType: allBase64[0].mimeType }
                : { files: allBase64 }
            ),
          });
          const eData = await eRes.json();
          if (eRes.ok) {
            if (eData.title && !title.trim()) setTitle(eData.title);
            // Use chapter if available, otherwise fall back to title as chapter/topic
            const chapterVal = eData.chapter || eData.title || '';
            if (chapterVal) setChapter(prev => prev || chapterVal);
            if (eData.subject) {
              const matchSubj = SUBJECTS.find(s => s.toLowerCase().includes(eData.subject.toLowerCase()) || eData.subject.toLowerCase().includes(s.toLowerCase()));
              if (matchSubj) setSubject(matchSubj);
            }
            if (eData.purpose) setNote(prev => prev || eData.purpose);
            // Learning outcomes go into note alongside purpose
            if (Array.isArray(eData.learningOutcomes) && eData.learningOutcomes.length > 0) {
              const loText = eData.learningOutcomes.filter((o: string) => o.trim()).map((o: string) => `• ${o}`).join('\n');
              setNote(prev => prev ? `${prev}\n\nLearning Outcomes:\n${loText}` : `Learning Outcomes:\n${loText}`);
            }
            // Only actual success criteria checklist items
            if (Array.isArray(eData.successCriteria) && eData.successCriteria.length > 0) {
              setSuccessCriteria(eData.successCriteria.filter((c: string) => c.trim()));
            }
            if (eData.taskDescription) setTeacherNotes(prev => prev || eData.taskDescription);
            if (Array.isArray(eData.wordBank) && eData.wordBank.length > 0) {
              setIbWordBank(prev => [...new Set([...prev, ...eData.wordBank])]);
            }
            if (Array.isArray(eData.stamps) && eData.stamps.length > 0) {
              setIbStamps(prev => [...new Set([...prev, ...eData.stamps])]);
            }
            if (Array.isArray(eData.questions) && eData.questions.length > 0) {
              const mappedQuestions = eData.questions.map((q: any) => {
                const qText = typeof q === 'string' ? q : q.text || q;
                const needsImg = typeof q === 'object' ? !!q.needsImage : false;
                const pageIdx = typeof q === 'object' ? q.pageIndex : undefined;
                return { question: qText, answer: '', comment: '', pageIndex: pageIdx, needsImage: needsImg, croppedImage: '' };
              });
              setExtractedQuestions(prev => [...prev, ...mappedQuestions]);
            }
          }
        } catch {/* silent */}
        finally { setExtractingQuestions(false); }
      }
    };
    input.click();
  }

  function resetForm() {
    setTitle(''); setChapter(''); setDueDate(''); setNote('');
    setSubject('Mathematics');
    setGrade(user?.teaches?.[0]?.grade || 'Grade 3');
    setCurriculum(user?.teaches?.[0]?.curriculum || user?.curriculum || 'NCERT');
    setType('assignment'); setQuestions(['']); setSuccessCriteria(['']); setTaskSteps([]); setQuizQuestions([]); setTeacherNotes(''); setDocFiles([]); setFormError('');
    setAssignTo('all'); setSelectedStudent(null); setStudentSearch('');
    setExtractingQuestions(false); setExtractedQuestions([]); setShowPreview(false); setCreateMode('choose');
    setSelectedLanguage('Telugu'); setUnitOfInquiry(''); setIbPurpose('');
    setIbLearningOutcomes(['']); setIbWordBank([]); setIbStamps([]);
    setIbCentralIdea(''); setIbLinesOfInquiry([]); setIbLearnerProfile(''); setIbAtlSkill(''); setIbKeyConcept('');
  }

  // Generate MCQ quiz from extracted worksheet questions
  async function generateQuizFromExtracted() {
    const qs = extractedQuestions.filter(q => q.question.trim());
    if (qs.length === 0) return;
    setGeneratingFromExtracted(true);
    try {
      const prompt = qs.map((q, i) => `${i + 1}. ${q.question}${q.answer ? ` (Answer: ${q.answer})` : ''}`).join('\n');
      const res = await fetch(`${SERVER_URL}/assignments/pdf-to-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: '', mimeType: 'text/plain',
          subject, grade,
          difficulty: quizDifficulty || 'medium',
          count: qs.length,
        }),
      });
      // We'll use a direct LLM call via the existing generate-quiz with the questions as teacherNotes
      const res2 = await fetch(`${SERVER_URL}/assignments/generate-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject, chapter: chapter.trim(), grade, curriculum,
          difficulty: quizDifficulty, count: qs.length,
          teacherNotes: `Convert these worksheet questions into MCQ format. Use these exact questions:\n${prompt}`,
        }),
      });
      const data = await res2.json();
      if (res2.ok && Array.isArray(data.questions) && data.questions.length > 0) {
        setQuizQuestions(data.questions);
        setType('quiz');
      }
    } catch {}
    finally { setGeneratingFromExtracted(false); }
  }

  function addTaskStep(type: StepType) {
    setTaskSteps(prev => [...prev, {
      id: Date.now().toString(),
      type,
      ...STEP_DEFAULTS[type],
    } as TaskStep]);
  }
  function updateTaskStep(id: string, patch: Partial<TaskStep>) {
    setTaskSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }
  function removeTaskStep(id: string) {
    setTaskSteps(prev => prev.filter(s => s.id !== id));
  }

  async function generateSteps() {
    const topic = (title || chapter || subject || '').trim();
    setStepsError('');
    if (!topic) {
      setStepsError('Enter a title above first (e.g. "Food Chain"), then tap Generate with AI.');
      return;
    }
    setGeneratingSteps(true);
    try {
      console.log('[generateSteps] Calling API with topic:', topic, 'grade:', grade, 'curriculum:', curriculum, 'SERVER_URL:', SERVER_URL);
      const res = await fetch(`${SERVER_URL}/assignments/generate-steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, subject, grade, curriculum }),
      });
      const data = await res.json();
      console.log('[generateSteps] response:', JSON.stringify(data));
      if (!res.ok) { setStepsError(data.error || 'Server returned an error'); return; }
      if (Array.isArray(data.steps) && data.steps.length > 0) {
        setTaskSteps(data.steps.map((s: any) => ({
          id: Date.now().toString() + Math.random(),
          type: s.type as StepType,
          label: s.label,
          instructions: s.instructions,
          sections: s.type === 'structured_writing' ? ['Beginning', 'Middle', 'End'] : [],
          wordBank: [],
        })));
      } else {
        setStepsError('AI returned no steps — check browser console (F12) for details.');
      }
    } catch (e: any) {
      console.error('[generateSteps] fetch error:', e);
      setStepsError(`Failed: ${e.message || 'Cannot reach server on port 3006'}`);
    } finally {
      setGeneratingSteps(false);
    }
  }

  async function generateIBAssignment() {
    const topic = (title || chapter || '').trim();
    if (!topic) { setFormError('Enter a title or topic first'); return; }
    setGeneratingIB(true); setFormError('');
    try {
      const res = await fetch(`${SERVER_URL}/assignments/generate-ibpyp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          subject,
          grade,
          curriculum,
          language: subject === 'Language Acquisition' ? selectedLanguage : undefined,
          unitOfInquiry: unitOfInquiry.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || 'IB generation failed'); return; }
      if (data.purpose) setIbPurpose(data.purpose);
      if (data.centralIdea) setIbCentralIdea(data.centralIdea);
      if (Array.isArray(data.linesOfInquiry) && data.linesOfInquiry.length > 0) setIbLinesOfInquiry(data.linesOfInquiry);
      if (data.learnerProfile) setIbLearnerProfile(data.learnerProfile);
      if (data.atlSkill) setIbAtlSkill(data.atlSkill);
      if (data.keyConcept) setIbKeyConcept(data.keyConcept);
      if (Array.isArray(data.learningOutcomes) && data.learningOutcomes.length > 0) {
        setIbLearningOutcomes(data.learningOutcomes);
      }
      if (Array.isArray(data.taskSteps) && data.taskSteps.length > 0) {
        const SUBJECT_STEP_MAP: Record<string, StepType[]> = {
          'Mathematics':          ['tuning_in', 'problem_solving', 'math_reflection'],
          'Science':              ['prior_knowledge', 'drawing', 'structured_writing'],
          'English':              ['text_connection', 'reading_comprehension', 'writing_reflection'],
          'Language Acquisition': ['language_culture', 'language_practice', 'communication'],
          'Social Studies':       ['social_inquiry', 'research_notes', 'social_synthesis'],
          'Visual Arts':          ['artistic_exploration', 'art_creation', 'artistic_reflection'],
          'ICT':                  ['digital_awareness', 'tech_skill_practice', 'digital_citizenship'],
          'Physical Education':   ['movement_exploration', 'skill_practice', 'physical_reflection'],
        };
        const stepMap: StepType[] = SUBJECT_STEP_MAP[subject] || ['brainstorm', 'drawing', 'structured_writing'];
        setTaskSteps(data.taskSteps.slice(0, 3).map((s: any, idx: number) => {
          const enforcedType: StepType = stepMap[idx] || s.type || 'brainstorm';
          const defaults = STEP_DEFAULTS[enforcedType] || {};
          const sections = Array.isArray(s.sections) && s.sections.length ? s.sections : (defaults.sections || []);
          const HOOK_TYPES: StepType[] = ['tuning_in','text_connection','social_inquiry','language_culture','artistic_exploration','digital_awareness','movement_exploration'];
          const REFLECTION_TYPES: StepType[] = ['math_reflection','writing_reflection','social_synthesis','communication','artistic_reflection','digital_citizenship','physical_reflection'];
          return {
            id: Date.now().toString() + Math.random(),
            type: enforcedType,
            label: s.label || (defaults.label as string) || '',
            instructions: s.instructions || (defaults.instructions as string) || '',
            provocation: HOOK_TYPES.includes(enforcedType) ? (s.provocation || '') : undefined,
            sections,
            wordBank: [],
            problems: enforcedType === 'problem_solving' ? (Array.isArray(s.problems) ? s.problems : []) : [],
            reflectionPrompts: REFLECTION_TYPES.includes(enforcedType) ? (Array.isArray(s.reflectionPrompts) ? s.reflectionPrompts : []) : [],
          };
        }));
      }
      if (Array.isArray(data.successCriteria) && data.successCriteria.length > 0) {
        setSuccessCriteria(data.successCriteria);
      }
      if (Array.isArray(data.wordBank) && data.wordBank.length > 0) {
        setIbWordBank(data.wordBank);
      }
      if (Array.isArray(data.stamps) && data.stamps.length > 0) {
        setIbStamps(data.stamps);
      }
    } catch (e: any) {
      setFormError(`IB generation failed: ${e.message}`);
    } finally {
      setGeneratingIB(false);
    }
  }

  async function generateQuiz() {
    if (!chapter.trim() && !subject.trim()) { setFormError('Enter a chapter or topic first'); return; }
    setGeneratingQuiz(true); setFormError('');

    const applyQuestions = (items: any[]) => {
      const normalized = (items || [])
        .map((q: any, i: number) => {
          const question = String(q?.question || '').trim();
          const options = Array.isArray(q?.options)
            ? q.options.map((o: any) => String(o).replace(/^[A-D]\.\s*/i, '').trim()).filter(Boolean)
            : [];
          if (!question || options.length !== 4) return null;

          let correct = '';
          if (typeof q?.correct === 'number' && options[q.correct]) {
            correct = options[q.correct];
          } else if (typeof q?.correct === 'string') {
            const letter = q.correct.trim().match(/^([A-D])(?:\.|\b)/i)?.[1]?.toUpperCase();
            if (letter) {
              const idx = 'ABCD'.indexOf(letter);
              correct = idx >= 0 && options[idx] ? options[idx] : q.correct.replace(/^[A-D]\.\s*/i, '').trim();
            } else {
              correct = q.correct.replace(/^[A-D]\.\s*/i, '').trim();
            }
          }
          if (!correct || !options.some((opt: string) => opt.toLowerCase() === correct.toLowerCase())) {
            correct = options[0];
          } else {
            correct = options.find((opt: string) => opt.toLowerCase() === correct.toLowerCase()) || options[0];
          }

          return {
            id: q?.id || `q${i + 1}`,
            question,
            type: 'mcq',
            options,
            correct,
            hint: q?.hint || '',
            explanation: q?.explanation || '',
          };
        })
        .filter((q: any) => q?.question);

      if (normalized.length === 0) return false;
      setQuizQuestions(normalized);
      setQuestions(normalized.map((q: any) => q.question));
      return true;
    };

    const fallbackToNcertQuiz = async () => {
      try {
        const topic = chapter.trim() || subject.trim();
        const fallbackPath = subject.toLowerCase().includes('science') ? '/ncert/science-quiz' : '/ncert/quiz';
        const fallbackRes = await fetch(`${SERVER_URL}${fallbackPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, context: teacherNotes.trim() }),
        });
        const fallbackData = await fallbackRes.json().catch(() => null);
        if (!fallbackRes.ok || !Array.isArray(fallbackData?.questions)) return false;

        const mapped = fallbackData.questions
          .slice(0, quizCount)
          .map((q: any, i: number) => {
            const options = Array.isArray(q.options) ? q.options.map((o: any) => String(o)) : [];
            const idx = typeof q.correct === 'number' ? q.correct : Number(q.correct);
            const validIdx = Number.isInteger(idx) && idx >= 0 && idx < options.length;
            const correct = validIdx ? options[idx] : (typeof q.correct === 'string' ? q.correct : (options[0] || ''));
            return {
              id: q.id || `q${i + 1}`,
              question: String(q.question || ''),
              type: 'mcq',
              options,
              correct,
              hint: q.hint || '',
              explanation: q.explanation || '',
            };
          })
          .filter((q: any) => q.question);

        if (mapped.length === 0) return false;
        applyQuestions(mapped);
        return true;
      } catch {
        return false;
      }
    };

    try {
      const res = await fetch(`${SERVER_URL}/assignments/generate-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, chapter: chapter.trim(), grade, curriculum, difficulty: quizDifficulty, count: quizCount, teacherNotes: teacherNotes.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data?.questions)) {
        if (applyQuestions(data.questions)) return;
      }

      // Some local servers expose /ncert/quiz but not /assignments/generate-quiz.
      if (res.status === 404 || !data) {
        const recovered = await fallbackToNcertQuiz();
        if (recovered) return;
      }

      setFormError(data?.error || 'Could not generate quiz. Check chapter/topic.');
    } catch {
      const recovered = await fallbackToNcertQuiz();
      if (!recovered) setFormError('Network error generating quiz.');
    } finally {
      setGeneratingQuiz(false);
    }
  }

  async function markComplete(id: string) {
    try {
      const res = await fetch(`${SERVER_URL}/assignments/${id}/complete`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: null }),
      });
      if (res.ok) {
        setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: 'completed' } : a));
      }
    } catch {/* ignore */}
  }

  async function deleteAssignment(id: string) {
    try {
      await fetch(`${SERVER_URL}/assignments/${id}`, { method: 'DELETE' });
      setAssignments(prev => prev.filter(a => a.id !== id));
    } catch {/* ignore */}
  }

  async function sendFeedback(assignmentId: string, studentId: string) {
    if (!teacherFeedback.trim()) return;
    setSendingFeedback(true);
    try {
      const res = await fetch(`${SERVER_URL}/assignments/${assignmentId}/teacher-feedback`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, feedback: teacherFeedback.trim() }),
      });
      if (res.ok) {
        // Update the local submission with teacher feedback
        setDetailSubmissions(prev => prev.map(s => {
          if (s.studentId !== studentId) return s;
          let fbObj: any = {};
          try { fbObj = JSON.parse(s.aiFeedback || '{}'); } catch { fbObj = { text: s.aiFeedback || '' }; }
          fbObj.teacherFeedback = teacherFeedback.trim();
          fbObj.teacherFeedbackAt = new Date().toISOString();
          return { ...s, aiFeedback: JSON.stringify(fbObj) };
        }));
        setTeacherFeedback('');
      }
    } catch {/* ignore */}
    setSendingFeedback(false);
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Assignments"
          subtitle="Manage and track student assignments"
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {/* Stats Row */}
          <View style={styles.statsRow}>
            {[
              { label: 'Total', value: stats.total, color: colors.primary },
              { label: 'Active', value: stats.active, color: colors.accentYellow },
              { label: 'Completed', value: stats.completed, color: colors.accentGreen },
              { label: 'Overdue', value: stats.overdue, color: colors.accentRed },
            ].map((s) => (
              <View key={s.label} style={styles.statCard}>
                <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Create button + Tabs row */}
          <View style={styles.actionsRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
              {TABS.map((tab) => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tab, activeTab === tab && styles.tabActive]}
                  onPress={() => setActiveTab(tab)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.createBtn} onPress={() => setShowModal(true)} activeOpacity={0.85}>
              <Feather name="plus" size={15} color="#fff" />
              <Text style={styles.createBtnText}>New</Text>
            </TouchableOpacity>
          </View>

          {/* Assignment List */}
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="check-square" size={36} color={colors.textDim} />
              <Text style={styles.emptyTitle}>No assignments yet</Text>
              <Text style={styles.emptyText}>Tap "New" to create your first assignment</Text>
            </View>
          ) : (
            filtered.map((a) => {
              const due = daysUntil(a.dueDate);
              const subjectColor = SUBJECT_COLORS[a.subject] || colors.primary;
              return (
                <TouchableOpacity key={a.id} style={styles.card} activeOpacity={0.85} onPress={() => setDetailAssignment(a)}>
                  <View style={[styles.cardAccent, { backgroundColor: subjectColor }]} />
                  <View style={styles.cardBody}>
                    {/* Header */}
                    <View style={styles.cardTop}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.cardMeta}>
                          <View style={[styles.typePill, { backgroundColor: subjectColor + '20', borderColor: subjectColor + '50' }]}>
                            <Text style={[styles.typeText, { color: subjectColor }]}>{a.type}</Text>
                          </View>
                          <Text style={styles.subjectLabel}>{a.subject}</Text>
                          {a.grade ? <Text style={styles.subjectLabel}>{a.grade}</Text> : null}
                          {a.curriculum ? <Text style={styles.subjectLabel}>{a.curriculum}</Text> : null}
                          {a.studentId === null && (
                            <View style={styles.broadcastPill}>
                              <Feather name="users" size={9} color={colors.primary} />
                              <Text style={styles.broadcastText}>All students</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.cardTitle}>{a.title}</Text>
                        {a.chapter ? <Text style={styles.cardChapter}>{a.chapter}</Text> : null}
                      </View>
                      {a.status === 'completed' ? (
                        <View style={{ alignItems: 'flex-end', gap: 4 }}>
                          {a.score != null && (
                            <View style={[styles.completedBadge, { backgroundColor: subjectColor + '20', borderColor: subjectColor + '40' }]}>
                              <Text style={[styles.statusText, { color: subjectColor, fontSize: 13, fontWeight: '800' }]}>{a.score}%</Text>
                            </View>
                          )}
                          <View style={styles.completedBadge}>
                            <Feather name="check" size={12} color={colors.accentGreen} />
                            <Text style={[styles.statusText, { color: colors.accentGreen }]}>Done</Text>
                          </View>
                        </View>
                      ) : (
                        <View style={[styles.pendingBadge, due.overdue && styles.overdueBadge]}>
                          <Feather name="clock" size={12} color={due.overdue ? colors.accentRed : colors.accentYellow} />
                          <Text style={[styles.statusText, { color: due.overdue ? colors.accentRed : colors.accentYellow }]}>{due.label}</Text>
                        </View>
                      )}
                    </View>

                    {/* Footer */}
                    <View style={styles.cardFooter}>
                      <Text style={styles.dueDateText}>
                        <Feather name="calendar" size={11} /> {formatDate(a.dueDate)}
                      </Text>
                      <View style={styles.cardActions}>
                        {a.status === 'completed' && a.aiFeedback && (
                          <TouchableOpacity style={[styles.actionBtn, { borderColor: subjectColor + '50', backgroundColor: subjectColor + '12' }]} onPress={() => setReportAssignment(a)} activeOpacity={0.75}>
                            <Feather name="bar-chart-2" size={13} color={subjectColor} />
                            <Text style={[styles.actionBtnLabel, { color: subjectColor }]}>Report</Text>
                          </TouchableOpacity>
                        )}
                        {a.status === 'pending' && (
                          <TouchableOpacity style={styles.actionBtn} onPress={() => markComplete(a.id)} activeOpacity={0.75}>
                            <Feather name="check" size={13} color={colors.accentGreen} />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={styles.actionBtn} onPress={() => deleteAssignment(a.id)} activeOpacity={0.75}>
                          <Feather name="trash-2" size={13} color={colors.accentRed} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {a.note ? <Text style={styles.noteText}>{a.note}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>

        {/* Assignment Detail Modal */}
        {detailAssignment && (() => {
          const a = detailAssignment;
          const sc = SUBJECT_COLORS[a.subject] || colors.primary;
          const due = daysUntil(a.dueDate);
          const completedCount = detailSubmissions.filter(s => s.status === 'completed').length;
          const totalCount = detailTotalLinked || detailSubmissions.length;
          const completionPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
          const allQs: any[] = (a as any).quizQuestions?.length > 0
            ? (a as any).quizQuestions
            : (a.questions?.length ?? 0) > 0
              ? (a.questions as any[])
              : (a.taskSteps?.length ?? 0) > 0
                ? (a.taskSteps as any[])
                : [];

          return (
            <Modal visible transparent animationType="fade" onRequestClose={() => setDetailAssignment(null)}>
              <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDetailAssignment(null)}>
                <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { maxHeight: '90%' }]}>
                  {/* Colour bar */}
                  <View style={{ height: 5, backgroundColor: sc, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }} />

                  {/* Fixed header */}
                  <View style={{ padding: spacing.lg, paddingBottom: 0, gap: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1, gap: 5 }}>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          <View style={[styles.typePill, { backgroundColor: sc + '20', borderColor: sc + '50' }]}>
                            <Text style={[styles.typeText, { color: sc }]}>{a.type?.toUpperCase()}</Text>
                          </View>
                          {a.grade && <View style={styles.broadcastPill}><Text style={styles.broadcastText}>{a.grade}</Text></View>}
                          {a.curriculum && <View style={styles.broadcastPill}><Text style={styles.broadcastText}>{a.curriculum}</Text></View>}
                          {a.studentId === null && (
                            <View style={styles.broadcastPill}>
                              <Feather name="users" size={9} color={colors.primary} />
                              <Text style={styles.broadcastText}>All students</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ fontSize: 17, fontWeight: '800', color: colors.textMain }}>{a.title}</Text>
                        {a.chapter ? <Text style={{ fontSize: 12, color: colors.textMuted }}>{a.chapter}</Text> : null}
                      </View>
                      <TouchableOpacity onPress={() => setDetailAssignment(null)} style={{ padding: 4 }}>
                        <Feather name="x" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>

                    {/* Tabs */}
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, marginBottom: 10 }}>
                      {(['overview', 'students', 'questions'] as const).map(tab => (
                        <TouchableOpacity
                          key={tab}
                          onPress={() => setDetailTab(tab)}
                          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: detailTab === tab ? sc : colors.borderColor, backgroundColor: detailTab === tab ? sc + '18' : 'transparent' }}
                          activeOpacity={0.75}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: detailTab === tab ? sc : colors.textMuted, textTransform: 'capitalize' }}>
                            {tab === 'students' ? `Students${totalCount > 0 ? ` (${completedCount}/${totalCount})` : ''}` : tab === 'questions' ? `Questions${allQs.length > 0 ? ` (${allQs.length})` : ''}` : 'Overview'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingTop: 4, gap: spacing.md }}>

                    {/* ── OVERVIEW TAB ── */}
                    {detailTab === 'overview' && (
                      <>
                        {/* Meta grid */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                          {[
                            { icon: 'book-open', label: 'Subject', value: a.subject },
                            { icon: 'calendar', label: 'Due Date', value: formatDate(a.dueDate) },
                            { icon: 'clock', label: 'Status', value: due.label },
                            { icon: 'check-circle', label: 'Completion', value: `${completedCount}/${totalCount > 0 ? totalCount : '?'} students` },
                          ].map(item => (
                            <View key={item.label} style={{ width: '47%', backgroundColor: colors.cardDark, borderRadius: radius.md, padding: 12, gap: 4, borderWidth: 1, borderColor: colors.borderColor }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                                <Feather name={item.icon as any} size={11} color={sc} />
                                <Text style={{ fontSize: 10, color: colors.textDim, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{item.label}</Text>
                              </View>
                              <Text style={{ fontSize: 13, color: colors.textMain, fontWeight: '600' }}>{item.value}</Text>
                            </View>
                          ))}
                        </View>

                        {/* Description / note */}
                        {a.note ? (
                          <View style={{ backgroundColor: colors.cardDark, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.borderColor }}>
                            <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Description</Text>
                            <Text style={{ fontSize: 13, color: colors.textMain, lineHeight: 20 }}>{a.note}</Text>
                          </View>
                        ) : null}

                        {/* Worksheet pages */}
                        {(a.documentUrls?.length ?? 0) > 0 && (
                          <View style={{ gap: 8 }}>
                            <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>Worksheet Pages ({a.documentUrls!.length})</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                              <View style={{ flexDirection: 'row', gap: 10 }}>
                                {a.documentUrls!.map((url: string, idx: number) => (
                                  <TouchableOpacity key={idx} activeOpacity={0.8} onPress={() => setFullscreenImage(url)}>
                                    <View style={{ width: 140, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: sc + '40' }}>
                                      <Image source={{ uri: url }} style={{ width: 140, height: 190 }} resizeMode="contain" />
                                      <View style={{ paddingVertical: 3, backgroundColor: sc + '15', alignItems: 'center' }}>
                                        <Text style={{ fontSize: 10, fontWeight: '700', color: sc }}>Page {idx + 1}</Text>
                                      </View>
                                    </View>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </ScrollView>
                          </View>
                        )}

                        {/* Questions summary in overview */}
                        {allQs.length > 0 && (
                          <View style={{ gap: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>Questions ({allQs.length})</Text>
                              <TouchableOpacity onPress={() => setDetailTab('questions')} activeOpacity={0.7}>
                                <Text style={{ fontSize: 11, color: sc, fontWeight: '600' }}>View all</Text>
                              </TouchableOpacity>
                            </View>
                            {allQs.slice(0, 5).map((q: any, i: number) => {
                              const qText = typeof q === 'string' ? q : (q.question || q.label || '');
                              const expectedAns = typeof q === 'object' && q.expectedAnswer ? q.expectedAnswer : null;
                              return (
                                <View key={i} style={{ backgroundColor: colors.cardDark, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.borderColor, gap: 4 }}>
                                  <View style={{ flexDirection: 'row', gap: 8 }}>
                                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: sc + '20', alignItems: 'center', justifyContent: 'center' }}>
                                      <Text style={{ fontSize: 10, fontWeight: '800', color: sc }}>{i + 1}</Text>
                                    </View>
                                    <Text style={{ fontSize: 12, color: colors.textMain, flex: 1, lineHeight: 18 }}>{qText}</Text>
                                  </View>
                                  {expectedAns ? (
                                    <View style={{ flexDirection: 'row', gap: 6, marginLeft: 30, alignItems: 'flex-start' }}>
                                      <Feather name="check-circle" size={11} color={colors.accentGreen} style={{ marginTop: 2 }} />
                                      <Text style={{ fontSize: 11, color: colors.accentGreen, flex: 1 }}>Expected: {expectedAns}</Text>
                                    </View>
                                  ) : null}
                                </View>
                              );
                            })}
                            {allQs.length > 5 && (
                              <TouchableOpacity onPress={() => setDetailTab('questions')} activeOpacity={0.7} style={{ alignSelf: 'center', paddingVertical: 4 }}>
                                <Text style={{ fontSize: 12, color: sc, fontWeight: '600' }}>+{allQs.length - 5} more questions</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}

                        {/* Success criteria */}
                        {(a.successCriteria?.length ?? 0) > 0 && (
                          <View style={{ gap: 6 }}>
                            <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>Success Criteria</Text>
                            {a.successCriteria!.map((c: string, ci: number) => (
                              <View key={ci} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                                <View style={{ width: 16, height: 16, borderRadius: 3, borderWidth: 1.5, borderColor: sc + '60', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                                  <Feather name="check" size={9} color={sc} />
                                </View>
                                <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1, lineHeight: 17 }}>{c}</Text>
                              </View>
                            ))}
                          </View>
                        )}

                        {/* Action buttons */}
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                          {a.status !== 'completed' && (
                            <TouchableOpacity
                              style={[styles.modalSaveBtn, { flex: 1, backgroundColor: sc }]}
                              onPress={() => { markComplete(a.id); setDetailAssignment(null); }}
                              activeOpacity={0.8}
                            >
                              <Feather name="check" size={14} color="#fff" />
                              <Text style={styles.modalSaveBtnText}>Mark Complete</Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={[styles.modalCancelBtn, { flex: 1 }]}
                            onPress={() => { deleteAssignment(a.id); setDetailAssignment(null); }}
                            activeOpacity={0.8}
                          >
                            <Feather name="trash-2" size={14} color={colors.accentRed} />
                            <Text style={[styles.modalCancelBtnText, { color: colors.accentRed }]}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    )}

                    {/* ── STUDENTS TAB ── */}
                    {detailTab === 'students' && (
                      <>
                        {/* Completion progress bar */}
                        {totalCount > 0 && (
                          <View style={{ gap: 8 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ fontSize: 12, color: colors.textMuted, fontWeight: '600' }}>Completion Progress</Text>
                              <Text style={{ fontSize: 12, color: sc, fontWeight: '800' }}>{completedCount}/{totalCount} ({completionPct}%)</Text>
                            </View>
                            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.borderColor, overflow: 'hidden' }}>
                              <View style={{ height: '100%', width: `${completionPct}%` as any, backgroundColor: sc, borderRadius: 4 }} />
                            </View>
                          </View>
                        )}

                        {loadingSubmissions ? (
                          <ActivityIndicator color={sc} style={{ marginTop: 24 }} />
                        ) : detailSubmissions.length === 0 ? (
                          <View style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
                            <Feather name="users" size={32} color={colors.textDim} />
                            <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center' }}>No submissions yet.</Text>
                            <Text style={{ fontSize: 12, color: colors.textDim, textAlign: 'center' }}>Students haven't started this assignment.</Text>
                          </View>
                        ) : (
                          <View style={{ gap: 10 }}>
                            {detailSubmissions.map((sub: any, i: number) => {
                              const done = sub.status === 'completed';
                              const isExpanded = expandedStudent === sub.studentId;
                              const pq: any[] = sub.perQuestion || [];
                              let fbObj: any = {};
                              try { fbObj = JSON.parse(sub.aiFeedback || '{}'); } catch { fbObj = { text: sub.aiFeedback || '' }; }
                              const existingTeacherFb = fbObj.teacherFeedback || '';
                              return (
                                <View key={sub.studentId || i} style={{ backgroundColor: colors.cardDark, borderRadius: radius.md, borderWidth: 1, borderColor: isExpanded ? sc + '60' : (done ? sc + '40' : colors.borderColor), overflow: 'hidden' }}>
                                  {/* Student header — tappable */}
                                  <TouchableOpacity activeOpacity={0.7} onPress={() => { setExpandedStudent(isExpanded ? null : sub.studentId); setTeacherFeedback(existingTeacherFb); }} style={{ padding: 14, gap: 8 }}>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: sc + '25', alignItems: 'center', justifyContent: 'center' }}>
                                          <Text style={{ fontSize: 13, fontWeight: '800', color: sc }}>{(sub.studentName || '?')[0].toUpperCase()}</Text>
                                        </View>
                                        <View style={{ flex: 1 }}>
                                          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.textMain }}>{sub.studentName || 'Unknown'}</Text>
                                          {sub.grade ? <Text style={{ fontSize: 11, color: colors.textDim }}>{sub.grade}</Text> : null}
                                        </View>
                                      </View>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                        <View style={{ alignItems: 'flex-end', gap: 3 }}>
                                          {sub.score != null && (
                                            <View style={{ backgroundColor: sc + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                                              <Text style={{ fontSize: 13, fontWeight: '800', color: sc }}>{sub.score}%</Text>
                                            </View>
                                          )}
                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                            <Feather name={done ? 'check-circle' : 'clock'} size={11} color={done ? colors.accentGreen : colors.accentYellow} />
                                            <Text style={{ fontSize: 11, color: done ? colors.accentGreen : colors.accentYellow, fontWeight: '600' }}>{done ? 'Completed' : 'Pending'}</Text>
                                          </View>
                                        </View>
                                        <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textDim} />
                                      </View>
                                    </View>
                                    {sub.completedAt && (
                                      <Text style={{ fontSize: 11, color: colors.textDim, marginLeft: 40 }}>Submitted {formatDate(sub.completedAt)}</Text>
                                    )}
                                  </TouchableOpacity>

                                  {/* Expanded: per-question answers + feedback */}
                                  {isExpanded && (
                                    <View style={{ borderTopWidth: 1, borderTopColor: colors.borderColor, padding: 14, gap: 12 }}>
                                      {/* Per-question breakdown */}
                                      {pq.length > 0 ? (
                                        <View style={{ gap: 10 }}>
                                          <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>Question-by-Question</Text>
                                          {pq.map((q: any, qi: number) => {
                                            const qScore = q.score ?? 0;
                                            const scoreColor = qScore >= 70 ? colors.accentGreen : qScore >= 40 ? colors.accentYellow : colors.accentRed;
                                            return (
                                              <View key={qi} style={{ backgroundColor: colors.bgDark, borderRadius: 10, padding: 12, gap: 6, borderLeftWidth: 3, borderLeftColor: scoreColor }}>
                                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                  <Text style={{ fontSize: 12, color: colors.textMain, fontWeight: '700', flex: 1 }}>Q{q.number || qi + 1}. {q.question || q.stepLabel || ''}</Text>
                                                  <View style={{ backgroundColor: scoreColor + '20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 }}>
                                                    <Text style={{ fontSize: 11, fontWeight: '800', color: scoreColor }}>{qScore}%</Text>
                                                  </View>
                                                </View>
                                                {q.studentAnswer ? (
                                                  <View style={{ gap: 2 }}>
                                                    <Text style={{ fontSize: 10, color: colors.textDim, fontWeight: '600' }}>Student's Answer:</Text>
                                                    <Text style={{ fontSize: 12, color: colors.textMain, lineHeight: 18, backgroundColor: colors.cardDark, borderRadius: 6, padding: 8 }}>{q.studentAnswer}</Text>
                                                  </View>
                                                ) : null}
                                                {q.comment ? (
                                                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                                                    <Feather name="message-circle" size={11} color={colors.accentCyan} style={{ marginTop: 2 }} />
                                                    <Text style={{ fontSize: 11, color: colors.accentCyan, flex: 1, lineHeight: 16 }}>{q.comment}</Text>
                                                  </View>
                                                ) : null}
                                              </View>
                                            );
                                          })}
                                        </View>
                                      ) : done ? (
                                        <View style={{ alignItems: 'center', paddingVertical: 12, gap: 4 }}>
                                          <Feather name="file-text" size={20} color={colors.textDim} />
                                          <Text style={{ fontSize: 12, color: colors.textDim }}>Submission recorded (no per-question data)</Text>
                                        </View>
                                      ) : null}

                                      {/* AI Feedback summary */}
                                      {(fbObj.text || fbObj.wellDone || fbObj.improve) ? (
                                        <View style={{ backgroundColor: sc + '0E', borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: sc + '60', gap: 6 }}>
                                          <Text style={{ fontSize: 10, color: sc, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>AI Feedback</Text>
                                          {fbObj.text ? <Text style={{ fontSize: 12, color: colors.textMain, lineHeight: 18 }}>{fbObj.text}</Text> : null}
                                          {fbObj.wellDone ? (
                                            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                                              <Feather name="thumbs-up" size={11} color={colors.accentGreen} style={{ marginTop: 2 }} />
                                              <Text style={{ fontSize: 11, color: colors.textMuted, flex: 1, lineHeight: 16 }}>{fbObj.wellDone}</Text>
                                            </View>
                                          ) : null}
                                          {fbObj.improve ? (
                                            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                                              <Feather name="trending-up" size={11} color={colors.accentYellow} style={{ marginTop: 2 }} />
                                              <Text style={{ fontSize: 11, color: colors.textMuted, flex: 1, lineHeight: 16 }}>{fbObj.improve}</Text>
                                            </View>
                                          ) : null}
                                        </View>
                                      ) : null}

                                      {/* Existing teacher feedback */}
                                      {existingTeacherFb && !sendingFeedback ? (
                                        <View style={{ backgroundColor: colors.accentCyan + '0E', borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: colors.accentCyan + '60', gap: 4 }}>
                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <Feather name="user" size={11} color={colors.accentCyan} />
                                            <Text style={{ fontSize: 10, color: colors.accentCyan, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>Teacher Feedback</Text>
                                          </View>
                                          <Text style={{ fontSize: 12, color: colors.textMain, lineHeight: 18 }}>{existingTeacherFb}</Text>
                                          {fbObj.teacherFeedbackAt ? <Text style={{ fontSize: 10, color: colors.textDim }}>Sent {formatDate(fbObj.teacherFeedbackAt)}</Text> : null}
                                        </View>
                                      ) : null}

                                      {/* Teacher feedback input */}
                                      {done && (
                                        <View style={{ gap: 8 }}>
                                          <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                            {existingTeacherFb ? 'Update Feedback' : 'Send Feedback to Student & Parent'}
                                          </Text>
                                          <TextInput
                                            style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                                            placeholder="Write feedback for this student... (visible to student & parent)"
                                            placeholderTextColor={colors.textDim}
                                            value={teacherFeedback}
                                            onChangeText={setTeacherFeedback}
                                            multiline
                                          />
                                          <TouchableOpacity
                                            style={[styles.modalSaveBtn, { backgroundColor: sc, opacity: teacherFeedback.trim() ? 1 : 0.5 }]}
                                            onPress={() => sendFeedback(a.id, sub.studentId)}
                                            disabled={!teacherFeedback.trim() || sendingFeedback}
                                            activeOpacity={0.8}
                                          >
                                            {sendingFeedback ? (
                                              <ActivityIndicator size="small" color="#fff" />
                                            ) : (
                                              <>
                                                <Feather name="send" size={14} color="#fff" />
                                                <Text style={styles.modalSaveBtnText}>{existingTeacherFb ? 'Update Feedback' : 'Send Feedback'}</Text>
                                              </>
                                            )}
                                          </TouchableOpacity>
                                        </View>
                                      )}
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </>
                    )}

                    {/* ── QUESTIONS TAB ── */}
                    {detailTab === 'questions' && (
                      <>
                        {/* Worksheet page images at top of Questions tab — tap for fullscreen */}
                        {(a.documentUrls?.length ?? 0) > 0 && (
                          <View style={{ gap: 8, marginBottom: 16 }}>
                            <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>Worksheet Pages</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                              {a.documentUrls!.map((url: string, idx: number) => (
                                <TouchableOpacity key={idx} activeOpacity={0.8} onPress={() => setFullscreenImage(url)}>
                                  <View style={{ width: 160, marginHorizontal: 4, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: sc + '40' }}>
                                    <Image source={{ uri: url }} style={{ width: 160, height: 210 }} resizeMode="contain" />
                                    <View style={{ paddingVertical: 3, backgroundColor: sc + '15', alignItems: 'center' }}>
                                      <Text style={{ fontSize: 10, fontWeight: '700', color: sc }}>Page {idx + 1}</Text>
                                    </View>
                                  </View>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          </View>
                        )}
                        {allQs.length === 0 && (a.documentUrls?.length ?? 0) === 0 ? (
                          <View style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
                            <Feather name="help-circle" size={32} color={colors.textDim} />
                            <Text style={{ fontSize: 14, color: colors.textMuted }}>No questions added.</Text>
                          </View>
                        ) : allQs.length === 0 ? null : (a as any).quizQuestions?.length > 0 ? (
                          /* MCQ quiz questions */
                          <View style={{ gap: 14 }}>
                            {(a as any).quizQuestions.map((q: any, i: number) => (
                              <View key={i} style={{ backgroundColor: colors.cardDark, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.borderColor, gap: 8 }}>
                                <View style={{ flexDirection: 'row', gap: 8 }}>
                                  <Text style={{ fontSize: 12, color: sc, fontWeight: '800', minWidth: 24 }}>Q{i + 1}.</Text>
                                  <Text style={{ fontSize: 13, color: colors.textMain, flex: 1, lineHeight: 18, fontWeight: '600' }}>{q.question}</Text>
                                </View>
                                {Array.isArray(q.options) && q.options.map((opt: string, oi: number) => {
                                  const letter = ['A','B','C','D'][oi];
                                  const isAnswer = opt === q.answer || letter === q.answer;
                                  return (
                                    <View key={oi} style={{ flexDirection: 'row', gap: 8, marginLeft: 24, alignItems: 'center' }}>
                                      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderColor: isAnswer ? sc : colors.borderColor, backgroundColor: isAnswer ? sc + '25' : 'transparent' }}>
                                        <Text style={{ fontSize: 10, fontWeight: '800', color: isAnswer ? sc : colors.textDim }}>{letter}</Text>
                                      </View>
                                      <Text style={{ fontSize: 12, color: isAnswer ? sc : colors.textMuted, fontWeight: isAnswer ? '700' : '400', flex: 1 }}>{opt}</Text>
                                      {isAnswer && <Feather name="check" size={12} color={sc} />}
                                    </View>
                                  );
                                })}
                              </View>
                            ))}
                          </View>
                        ) : (a.taskSteps?.length ?? 0) > 0 ? (
                          /* IB PYP task steps */
                          <View style={{ gap: 10 }}>
                            {a.taskSteps!.map((step: any, i: number) => (
                              <View key={i} style={{ backgroundColor: colors.cardDark, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.borderColor, gap: 6 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: sc + '25', alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={{ fontSize: 11, fontWeight: '800', color: sc }}>{i + 1}</Text>
                                  </View>
                                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMain, flex: 1 }}>{step.label || step.type}</Text>
                                </View>
                                {step.instructions ? <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17, marginLeft: 32 }}>{step.instructions}</Text> : null}
                                {Array.isArray(step.sections) && step.sections.length > 0 && (
                                  <View style={{ marginLeft: 32, gap: 4 }}>
                                    {step.sections.map((sec: string, si: number) => (
                                      <View key={si} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                                        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: sc + '80' }} />
                                        <Text style={{ fontSize: 12, color: colors.textMuted }}>{sec}</Text>
                                      </View>
                                    ))}
                                  </View>
                                )}
                                {Array.isArray(step.problems) && step.problems.length > 0 && (
                                  <View style={{ marginLeft: 32, gap: 4 }}>
                                    {step.problems.map((p: string, pi: number) => (
                                      <Text key={pi} style={{ fontSize: 12, color: colors.textMain }}>{pi + 1}. {p}</Text>
                                    ))}
                                  </View>
                                )}
                              </View>
                            ))}
                          </View>
                        ) : (
                          /* Plain text / structured questions with images */
                          <View style={{ gap: 10 }}>
                            {allQs.map((q: any, i: number) => {
                              const qText = typeof q === 'string' ? q : (q.question || q.label || '');
                              const expectedAns = typeof q === 'object' && q.expectedAnswer ? q.expectedAnswer : null;
                              const qImage = typeof q === 'object' && q.croppedImage ? q.croppedImage : null;
                              const qComment = typeof q === 'object' && q.comment ? q.comment : null;
                              return (
                                <View key={i} style={{ backgroundColor: colors.cardDark, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.borderColor, gap: 8 }}>
                                  <View style={{ flexDirection: 'row', gap: 8 }}>
                                    <Text style={{ fontSize: 12, color: sc, fontWeight: '800', minWidth: 24 }}>Q{i + 1}.</Text>
                                    <Text style={{ fontSize: 13, color: colors.textMain, flex: 1, lineHeight: 18, fontWeight: '600' }}>{qText}</Text>
                                  </View>
                                  {qImage ? (
                                    <TouchableOpacity activeOpacity={0.8} onPress={() => setFullscreenImage(qImage)} style={{ marginLeft: 32 }}>
                                      <View style={{ borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.accentCyan + '40' }}>
                                        <Image source={{ uri: qImage }} style={{ width: '100%', height: 160, backgroundColor: '#fff' }} resizeMode="contain" />
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center', paddingVertical: 3, backgroundColor: colors.bgDark }}>
                                          <Feather name="image" size={9} color={colors.accentCyan} />
                                          <Text style={{ fontSize: 9, color: colors.accentCyan }}>Reference Image — tap to enlarge</Text>
                                        </View>
                                      </View>
                                    </TouchableOpacity>
                                  ) : null}
                                  {expectedAns ? (
                                    <View style={{ flexDirection: 'row', gap: 6, marginLeft: 32, alignItems: 'center' }}>
                                      <Feather name="check-circle" size={12} color={colors.accentGreen} />
                                      <Text style={{ fontSize: 12, color: colors.accentGreen, flex: 1 }}>Expected: {expectedAns}</Text>
                                    </View>
                                  ) : null}
                                  {qComment ? (
                                    <View style={{ flexDirection: 'row', gap: 6, marginLeft: 32, alignItems: 'center' }}>
                                      <Feather name="message-circle" size={12} color={colors.accentYellow} />
                                      <Text style={{ fontSize: 12, color: colors.accentYellow, fontStyle: 'italic', flex: 1 }}>{qComment}</Text>
                                    </View>
                                  ) : null}
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </>
                    )}

                  </ScrollView>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>
          );
        })()}

        {/* Fullscreen Image Viewer */}
        {fullscreenImage && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setFullscreenImage(null)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => setFullscreenImage(null)}
                style={{ position: 'absolute', top: 40, right: 20, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
              >
                <Feather name="x" size={22} color="#fff" />
              </TouchableOpacity>
              <Image
                source={{ uri: fullscreenImage }}
                style={{ width: '92%', height: '80%' }}
                resizeMode="contain"
              />
            </View>
          </Modal>
        )}

        {/* AI Report Modal */}
        {reportAssignment && (
          <AIReportModal
            assignment={reportAssignment}
            colors={colors}
            onClose={() => setReportAssignment(null)}
          />
        )}

        {/* Create Assignment Modal */}
        <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => { setShowModal(false); resetForm(); }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={[styles.modalOverlay, createMode === 'choose' && { justifyContent: 'center' }]}>
              <View style={[styles.modalSheet, createMode === 'choose' && { maxHeight: undefined, borderRadius: 20 }]}>
                <View style={styles.modalHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    {createMode !== 'choose' && (
                      <TouchableOpacity onPress={() => setCreateMode('choose')} activeOpacity={0.75}>
                        <Feather name="arrow-left" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                    <Text style={styles.modalTitle}>
                      {createMode === 'choose' ? 'Create Assignment' : createMode === 'ai' ? 'AI Assignment' : 'Upload Worksheet'}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => { setShowModal(false); resetForm(); }} activeOpacity={0.75}>
                    <Feather name="x" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.modalContent, createMode === 'choose' && { flex: 1, justifyContent: 'center' }]}>

                  {/* ── MODE SELECTOR ── */}
                  {createMode === 'choose' && (
                    <View style={{ gap: 16 }}>
                      <Text style={{ fontSize: 13, color: colors.textDim, lineHeight: 18 }}>
                        Choose how you want to create this assignment:
                      </Text>

                      {/* Option 1: AI Assignment */}
                      <TouchableOpacity
                        style={{ padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: '#7AADA840', backgroundColor: '#7AADA808', gap: 8 }}
                        onPress={() => { setCreateMode('ai'); setType('assignment'); }}
                        activeOpacity={0.8}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#7AADA820', alignItems: 'center', justifyContent: 'center' }}>
                            <Feather name="cpu" size={20} color="#7AADA8" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 15, fontWeight: '800', color: '#7AADA8' }}>
                              {isIBPYP ? 'Generate IB PYP Assignment' : 'Generate AI Assignment'}
                            </Text>
                            <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                              AI creates Purpose, Learning Outcomes, Task Steps, Word Bank, and Stamps
                            </Text>
                          </View>
                          <Feather name="chevron-right" size={18} color="#7AADA8" />
                        </View>
                      </TouchableOpacity>

                      {/* Option 2: Upload Worksheet */}
                      <TouchableOpacity
                        style={{ padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary + '40', backgroundColor: colors.primaryGlow, gap: 8 }}
                        onPress={() => { setCreateMode('upload'); }}
                        activeOpacity={0.8}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + '20', alignItems: 'center', justifyContent: 'center' }}>
                            <Feather name="upload" size={20} color={colors.primary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 15, fontWeight: '800', color: colors.primary }}>Upload Worksheet (PDF / Image)</Text>
                            <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                              Extract questions from worksheet, use as-is or convert to interactive quiz
                            </Text>
                          </View>
                          <Feather name="chevron-right" size={18} color={colors.primary} />
                        </View>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* ── UPLOAD WORKSHEET (shown FIRST in upload mode) ── */}
                  {createMode === 'upload' && (<>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.fieldLabel}>Upload Worksheet</Text>
                    {docFiles.length > 0 && <Text style={{ fontSize: 11, color: colors.textDim }}>{docFiles.length} file{docFiles.length > 1 ? 's' : ''}</Text>}
                  </View>

                  {/* Uploaded page thumbnails */}
                  {docFiles.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        {docFiles.map((f, idx) => (
                          <View key={idx} style={{ width: 140, borderRadius: 10, overflow: 'hidden', position: 'relative', borderWidth: 1.5, borderColor: colors.primary + '60' }}>
                            {f.mime.startsWith('image/') ? (
                              <Image source={{ uri: `data:${f.mime};base64,${f.base64}` }} style={{ width: 140, height: 190 }} resizeMode="contain" />
                            ) : (
                              <View style={{ width: 140, height: 190, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryGlow }}>
                                <Feather name="file-text" size={28} color={colors.primary} />
                              </View>
                            )}
                            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.55)' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#fff', textAlign: 'center' }}>Page {idx + 1}</Text>
                            </View>
                            <TouchableOpacity
                              style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
                              onPress={() => { setDocFiles(prev => prev.filter((_, i) => i !== idx)); if (idx === 0) setQuestions(['']); }}
                              activeOpacity={0.8}
                            >
                              <Feather name="x" size={12} color="#fff" />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  )}

                  {/* Add / upload button */}
                  <TouchableOpacity
                    style={[styles.uploadDocBtn, { borderColor: colors.borderColor }]}
                    onPress={pickDoc}
                    activeOpacity={0.8}
                    disabled={uploadingDoc || extractingQuestions}
                  >
                    {uploadingDoc ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : extractingQuestions ? (
                      <ActivityIndicator size="small" color={colors.accentYellow} />
                    ) : (
                      <Feather name="plus-circle" size={18} color={colors.primary} />
                    )}
                    <Text style={[styles.uploadDocText, { color: colors.primary }]}>
                      {uploadingDoc ? 'Uploading...' : extractingQuestions ? 'Extracting questions...' : docFiles.length === 0 ? 'Upload worksheet (image or PDF)' : 'Add another page'}
                    </Text>
                  </TouchableOpacity>

                  {/* Auto-filled indicator */}
                  {docFiles.length > 0 && !extractingQuestions && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.accentGreen + '10', borderWidth: 1, borderColor: colors.accentGreen + '30' }}>
                      <Feather name="cpu" size={12} color={colors.accentGreen} />
                      <Text style={{ fontSize: 11, color: colors.accentGreen, fontWeight: '600' }}>Details auto-filled from worksheet — review and edit below</Text>
                    </View>
                  )}
                  </>)}

                  {/* ── COMMON FIELDS (shown in both modes) ── */}
                  {createMode !== 'choose' && (<>
                  <Text style={styles.fieldLabel}>Title *{createMode === 'upload' && docFiles.length > 0 && title.trim() ? <Text style={{ fontSize: 10, color: colors.accentGreen, fontWeight: '600' }}> · auto-filled</Text> : null}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Chapter 5 Worksheet"
                    placeholderTextColor={colors.textDim}
                    value={title}
                    onChangeText={setTitle}
                  />

                  <Text style={styles.fieldLabel}>Subject{createMode === 'upload' && docFiles.length > 0 ? <Text style={{ fontSize: 10, color: colors.accentGreen, fontWeight: '600' }}> · auto-filled</Text> : null}</Text>
                  <View style={styles.chipRow}>
                    {SUBJECTS.map((s) => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.chip, subject === s && { backgroundColor: colors.primaryGlow, borderColor: colors.primary }]}
                        onPress={() => setSubject(s)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.chipText, subject === s && { color: colors.primary }]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Language picker (only for Language Acquisition) */}
                  {subject === 'Language Acquisition' && (
                    <>
                      <Text style={styles.fieldLabel}>Language</Text>
                      <View style={styles.chipRow}>
                        {LANGUAGES.map((lang) => (
                          <TouchableOpacity
                            key={lang}
                            style={[styles.chip, selectedLanguage === lang && { backgroundColor: '#7AADA820', borderColor: '#7AADA8' }]}
                            onPress={() => setSelectedLanguage(lang)}
                            activeOpacity={0.75}
                          >
                            <Text style={[styles.chipText, selectedLanguage === lang && { color: '#7AADA8' }]}>{lang}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}

                  <Text style={styles.fieldLabel}>Grade {isIBPYP && <Text style={{ color: '#7AADA8', fontSize: 10, fontWeight: '600' }}> · IB PYP (3–5)</Text>}</Text>
                  <View style={styles.chipRow}>
                    {gradeOptions.map((g) => (
                      <TouchableOpacity
                        key={g}
                        style={[styles.chip, grade === g && { backgroundColor: colors.primaryGlow, borderColor: colors.primary }]}
                        onPress={() => setGrade(g)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.chipText, grade === g && { color: colors.primary }]}>{g}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>Curriculum</Text>
                  <View style={styles.chipRow}>
                    <View style={[styles.chip, { backgroundColor: colors.primaryGlow, borderColor: colors.primary }]}>
                      <Text style={[styles.chipText, { color: colors.primary }]}>{teacherCurriculum || curriculum}</Text>
                    </View>
                  </View>

                  <Text style={styles.fieldLabel}>Chapter / Topic{createMode === 'upload' && docFiles.length > 0 && chapter.trim() ? <Text style={{ fontSize: 10, color: colors.accentGreen, fontWeight: '600' }}> · auto-filled</Text> : null}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Fractions and Decimals"
                    placeholderTextColor={colors.textDim}
                    value={chapter}
                    onChangeText={setChapter}
                  />

                  <Text style={styles.fieldLabel}>Due Date *</Text>
                  {Platform.OS === 'web' ? (
                    <View style={[styles.input, { justifyContent: 'center' }]}>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(e: any) => setDueDate(e.target.value)}
                        onClick={(e: any) => { try { e.target.showPicker?.(); } catch (_) {} }}
                        style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%', fontSize: 14, color: colors.textMain, fontFamily: 'inherit', cursor: 'pointer' }}
                      />
                    </View>
                  ) : (
                    <TextInput
                      style={styles.input}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textDim}
                      value={dueDate}
                      onChangeText={setDueDate}
                      keyboardType="numeric"
                    />
                  )}

                  {/* Output Format + Quiz Generator moved to after extracted questions */}

                  {/* ── AI Assignment Generator (only in AI mode) ── */}
                  {createMode === 'ai' && <View style={{ padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#7AADA840', backgroundColor: '#7AADA808', gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Feather name="cpu" size={16} color="#7AADA8" />
                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#7AADA8' }}>
                        {isIBPYP ? 'Generate IB PYP Assignment' : `Generate ${curriculum || 'AI'} Assignment`}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.textDim, lineHeight: 17 }}>
                      AI will generate a {isIBPYP ? 'complete IB PYP-style' : `${curriculum || 'curriculum'}-aligned`} assignment with Purpose, Learning Outcomes, Task Steps, Success Criteria, Word Bank, and Stamps — tailored to <Text style={{ fontWeight: '700' }}>{grade} · {subject}</Text>.
                    </Text>

                    <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>
                      {isIBPYP ? 'Unit of Inquiry (optional)' : 'Theme / Unit (optional)'}
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder={isIBPYP ? 'e.g. How We Organise Ourselves / Sharing the Planet' : 'e.g. Chapter 3: Fractions / Unit: Living World'}
                      placeholderTextColor={colors.textDim}
                      value={unitOfInquiry}
                      onChangeText={setUnitOfInquiry}
                    />

                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                        padding: 14, borderRadius: 12, backgroundColor: generatingIB ? colors.borderColor : '#7AADA8' }}
                      onPress={generateIBAssignment}
                      activeOpacity={0.85}
                      disabled={generatingIB}
                    >
                      {generatingIB
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Feather name="cpu" size={16} color="#fff" />}
                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#fff' }}>
                        {generatingIB
                          ? 'Generating Assignment...'
                          : isIBPYP ? 'Generate Full IB PYP Assignment' : `Generate ${curriculum || 'AI'} Assignment`}
                      </Text>
                    </TouchableOpacity>

                    {/* Generated IB fields preview */}
                    {!!ibPurpose && (
                      <View style={{ gap: 8, marginTop: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Feather name="check-circle" size={14} color="#7AADA8" />
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#7AADA8' }}>
                            {isIBPYP ? 'IB PYP Assignment Generated' : `${curriculum || 'AI'} Assignment Generated`}
                          </Text>
                        </View>

                        <View style={{ backgroundColor: colors.bgDark, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#7AADA830' }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#7AADA8', marginBottom: 4 }}>PURPOSE / CENTRAL IDEA</Text>
                          <TextInput
                            style={{ fontSize: 12, color: colors.textMain, lineHeight: 18 }}
                            value={ibCentralIdea || ibPurpose}
                            onChangeText={v => { setIbCentralIdea(v); setIbPurpose(v); }}
                            multiline
                          />
                        </View>

                        {ibLinesOfInquiry.length > 0 && (
                          <View style={{ backgroundColor: colors.bgDark, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#C3DCD830' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#3D7A74', marginBottom: 6 }}>LINES OF INQUIRY</Text>
                            {ibLinesOfInquiry.map((loi, i) => (
                              <View key={i} style={{ flexDirection: 'row', gap: 6, marginBottom: 4 }}>
                                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#3D7A74', marginTop: 7, flexShrink: 0 }} />
                                <Text style={{ flex: 1, fontSize: 12, color: colors.textMain, lineHeight: 18 }}>{loi}</Text>
                              </View>
                            ))}
                          </View>
                        )}

                        {(ibLearnerProfile || ibAtlSkill || ibKeyConcept) && (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            {ibLearnerProfile ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#EFD1D418', borderWidth: 1, borderColor: '#EFD1D450' }}>
                                <Text style={{ fontSize: 10, fontWeight: '800', color: '#8C5A49' }}>Learner Profile</Text>
                                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMain }}>{ibLearnerProfile}</Text>
                              </View>
                            ) : null}
                            {ibAtlSkill ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#C5BD9618', borderWidth: 1, borderColor: '#C5BD9650' }}>
                                <Text style={{ fontSize: 10, fontWeight: '800', color: '#8A7E4A' }}>ATL Skill</Text>
                                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMain }}>{ibAtlSkill}</Text>
                              </View>
                            ) : null}
                            {ibKeyConcept ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#93B0AC18', borderWidth: 1, borderColor: '#93B0AC50' }}>
                                <Text style={{ fontSize: 10, fontWeight: '800', color: '#3D6B66' }}>Key Concept</Text>
                                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMain }}>{ibKeyConcept}</Text>
                              </View>
                            ) : null}
                          </View>
                        )}

                        {ibLearningOutcomes.filter(l => l.trim()).length > 0 && (
                          <View style={{ backgroundColor: colors.bgDark, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#7AADA830' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#7AADA8', marginBottom: 6 }}>LEARNING OUTCOMES</Text>
                            {ibLearningOutcomes.map((lo, i) => (
                              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#7AADA8', marginTop: 7, flexShrink: 0 }} />
                                <TextInput
                                  style={{ flex: 1, fontSize: 12, color: colors.textMain, lineHeight: 18 }}
                                  value={lo}
                                  onChangeText={t => setIbLearningOutcomes(prev => prev.map((x, j) => j === i ? t : x))}
                                  multiline
                                />
                                <TouchableOpacity onPress={() => setIbLearningOutcomes(prev => prev.filter((_, j) => j !== i))} activeOpacity={0.7}>
                                  <Feather name="x" size={12} color={colors.textDim} />
                                </TouchableOpacity>
                              </View>
                            ))}
                            <TouchableOpacity onPress={() => setIbLearningOutcomes(prev => [...prev, ''])} activeOpacity={0.75}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                              <Feather name="plus-circle" size={12} color="#7AADA8" />
                              <Text style={{ fontSize: 11, color: '#7AADA8', fontWeight: '600' }}>Add outcome</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {ibWordBank.length > 0 && (
                          <View style={{ backgroundColor: colors.bgDark, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#7AADA830' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#7AADA8', marginBottom: 6 }}>WORD BANK</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                              {ibWordBank.map((w, i) => (
                                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: '#7AADA818', borderWidth: 1, borderColor: '#7AADA840' }}>
                                  <Text style={{ fontSize: 12, color: '#7AADA8', fontWeight: '600' }}>{w}</Text>
                                  <TouchableOpacity onPress={() => setIbWordBank(prev => prev.filter((_, j) => j !== i))} activeOpacity={0.7}>
                                    <Feather name="x" size={10} color="#7AADA8" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                              <TextInput
                                style={{ fontSize: 12, color: colors.textMain, minWidth: 80, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark }}
                                placeholder="Add word..."
                                placeholderTextColor={colors.textDim}
                                returnKeyType="done"
                                onSubmitEditing={(e) => {
                                  const w = e.nativeEvent.text.trim();
                                  if (w) setIbWordBank(prev => [...prev, w]);
                                }}
                              />
                            </View>
                          </View>
                        )}

                        {ibStamps.length > 0 && (
                          <View style={{ backgroundColor: colors.bgDark, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#7AADA830' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#7AADA8', marginBottom: 6 }}>STAMPS / BADGES</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                              {ibStamps.map((s, i) => (
                                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: '#8A835818', borderWidth: 1, borderColor: '#8A835840' }}>
                                  <Feather name="award" size={11} color="#8A8358" />
                                  <Text style={{ fontSize: 12, color: '#8A8358', fontWeight: '600' }}>{s}</Text>
                                  <TouchableOpacity onPress={() => setIbStamps(prev => prev.filter((_, j) => j !== i))} activeOpacity={0.7}>
                                    <Feather name="x" size={10} color="#8A8358" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </View>
                          </View>
                        )}
                      </View>
                    )}
                  </View>}

                  {/* ── Task Steps (AI mode only) ── */}
                  {createMode === 'ai' && <View style={{ marginTop: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fieldLabel}>Task Steps</Text>
                        <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>Build a scaffolded assignment: Brainstorm → Draw → Write</Text>
                      </View>
                      <TouchableOpacity
                        onPress={generateSteps}
                        disabled={generatingSteps}
                        activeOpacity={0.8}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10,
                          borderRadius: 20, backgroundColor: generatingSteps ? colors.borderColor : '#93B0AC',
                          opacity: generatingSteps ? 0.7 : 1 }}
                      >
                        {generatingSteps
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Feather name="cpu" size={13} color="#fff" />}
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                          {generatingSteps ? 'Generating...' : 'Generate with AI'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {!!stepsError && (
                      <View style={{ marginTop: 6, padding: 10, borderRadius: 8, backgroundColor: '#ef444418', borderWidth: 1, borderColor: '#ef444440' }}>
                        <Text style={{ fontSize: 12, color: '#ef4444' }}>{stepsError}</Text>
                      </View>
                    )}
                  </View>}

                  {/* Step type picker — subject-appropriate options per IB PYP pedagogy */}
                  {createMode === 'ai' && (() => {
                    const SUBJECT_STEP_PICKER: Record<string, StepType[]> = {
                      'Mathematics':          ['tuning_in', 'problem_solving', 'math_reflection'],
                      'Science':              ['prior_knowledge', 'drawing', 'structured_writing'],
                      'English':              ['text_connection', 'reading_comprehension', 'writing_reflection'],
                      'Language Acquisition': ['language_culture', 'language_practice', 'communication'],
                      'Social Studies':       ['social_inquiry', 'research_notes', 'social_synthesis'],
                      'Visual Arts':          ['artistic_exploration', 'art_creation', 'artistic_reflection'],
                      'ICT':                  ['digital_awareness', 'tech_skill_practice', 'digital_citizenship'],
                      'Physical Education':   ['movement_exploration', 'skill_practice', 'physical_reflection'],
                    };
                    const pickerTypes: StepType[] = SUBJECT_STEP_PICKER[subject] || ['brainstorm', 'drawing', 'structured_writing'];
                    const typeLabels: Record<StepType, string> = {
                      brainstorm: 'Brainstorm', drawing: 'Drawing', structured_writing: 'Writing',
                      problem_solving: 'Problems', tuning_in: 'Tuning In',
                      math_reflection: 'Reflection', prior_knowledge: 'Prior Knowledge',
                      text_connection: 'Text Connection', reading_comprehension: 'Reading',
                      writing_reflection: 'Writing Reflection', language_culture: 'Lang & Culture',
                      language_practice: 'Language Practice', communication: 'Communication',
                      social_inquiry: 'Social Inquiry', research_notes: 'Research Notes',
                      social_synthesis: 'Social Synthesis', artistic_exploration: 'Art Explore',
                      art_creation: 'Art Creation', artistic_reflection: 'Artist Statement',
                      digital_awareness: 'Digital Awareness', tech_skill_practice: 'Tech Practice',
                      digital_citizenship: 'Digital Citizenship', movement_exploration: 'Movement',
                      skill_practice: 'Skill Practice', physical_reflection: 'PE Reflection',
                    };
                    return (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {pickerTypes.map(type => (
                      <TouchableOpacity
                        key={type}
                        onPress={() => addTaskStep(type)}
                        activeOpacity={0.75}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: STEP_COLORS[type] + '60', backgroundColor: STEP_COLORS[type] + '12' }}
                      >
                        <Feather name={STEP_ICONS[type] as any} size={13} color={STEP_COLORS[type]} />
                        <Text style={{ fontSize: 12, color: STEP_COLORS[type], fontWeight: '600' }}>
                          + {typeLabels[type]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                    );
                  })()}

                  {/* Existing steps */}
                  {createMode === 'ai' && taskSteps.map((step, idx) => (
                    <View key={step.id} style={{ borderWidth: 1, borderColor: STEP_COLORS[step.type] + '40', borderRadius: 12, padding: 12, gap: 8, backgroundColor: STEP_COLORS[step.type] + '06' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: STEP_COLORS[step.type], alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 12, fontWeight: '800', color: '#fff' }}>{idx + 1}</Text>
                        </View>
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Feather name={STEP_ICONS[step.type] as any} size={13} color={STEP_COLORS[step.type]} />
                          <Text style={{ fontSize: 12, fontWeight: '700', color: STEP_COLORS[step.type], textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {({
                              brainstorm: 'Brainstorm', drawing: 'Drawing', structured_writing: 'Structured Writing',
                              problem_solving: 'Practice Problems', tuning_in: 'Tuning In',
                              math_reflection: 'Math Reflection', prior_knowledge: 'Prior Knowledge',
                              text_connection: 'Text Connection', reading_comprehension: 'Reading Comprehension',
                              writing_reflection: 'Writing Reflection', language_culture: 'Language & Culture',
                              language_practice: 'Language Practice', communication: 'Communication',
                              social_inquiry: 'Social Inquiry', research_notes: 'Research Notes',
                              social_synthesis: 'Social Synthesis', artistic_exploration: 'Art Exploration',
                              art_creation: 'Art Creation', artistic_reflection: 'Artist Statement',
                              digital_awareness: 'Digital Awareness', tech_skill_practice: 'Tech Practice',
                              digital_citizenship: 'Digital Citizenship', movement_exploration: 'Movement',
                              skill_practice: 'Skill Practice', physical_reflection: 'PE Reflection',
                            } as Record<StepType, string>)[step.type] || step.type}
                          </Text>
                        </View>
                        <TouchableOpacity onPress={() => removeTaskStep(step.id)} activeOpacity={0.7}>
                          <Feather name="x" size={16} color={colors.accentRed} />
                        </TouchableOpacity>
                      </View>

                      <TextInput
                        style={[styles.input, { borderColor: STEP_COLORS[step.type] + '40' }]}
                        placeholder="Step label..."
                        placeholderTextColor={colors.textDim}
                        value={step.label}
                        onChangeText={t => updateTaskStep(step.id, { label: t })}
                      />
                      <TextInput
                        style={[styles.input, styles.inputMulti, { borderColor: STEP_COLORS[step.type] + '40' }]}
                        placeholder="Instructions for student..."
                        placeholderTextColor={colors.textDim}
                        value={step.instructions}
                        onChangeText={t => updateTaskStep(step.id, { instructions: t })}
                        multiline
                        numberOfLines={2}
                      />

                      {step.type === 'structured_writing' && (
                        <>
                          <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '600' }}>Sections</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            {step.sections.map((sec, si) => (
                              <View key={si} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: STEP_COLORS[step.type] + '18', borderWidth: 1, borderColor: STEP_COLORS[step.type] + '40' }}>
                                <Text style={{ fontSize: 12, color: STEP_COLORS[step.type], fontWeight: '600' }}>{sec}</Text>
                                <TouchableOpacity onPress={() => updateTaskStep(step.id, { sections: step.sections.filter((_, j) => j !== si) })} activeOpacity={0.7}>
                                  <Feather name="x" size={10} color={STEP_COLORS[step.type]} />
                                </TouchableOpacity>
                              </View>
                            ))}
                            <TouchableOpacity
                              onPress={() => {
                                const name = `Section ${step.sections.length + 1}`;
                                updateTaskStep(step.id, { sections: [...step.sections, name] });
                              }}
                              activeOpacity={0.75}
                              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1, borderColor: STEP_COLORS[step.type] + '40', borderStyle: 'dashed' }}
                            >
                              <Text style={{ fontSize: 11, color: STEP_COLORS[step.type] }}>+ Section</Text>
                            </TouchableOpacity>
                          </View>

                          <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '600', marginTop: 4 }}>Word Bank</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            {step.wordBank.map((w, wi) => (
                              <View key={wi} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: colors.borderColor }}>
                                <Text style={{ fontSize: 12, color: colors.textMain, fontWeight: '600' }}>{w}</Text>
                                <TouchableOpacity onPress={() => updateTaskStep(step.id, { wordBank: step.wordBank.filter((_, j) => j !== wi) })} activeOpacity={0.7}>
                                  <Feather name="x" size={10} color={colors.textDim} />
                                </TouchableOpacity>
                              </View>
                            ))}
                            <TextInput
                              style={{ fontSize: 12, color: colors.textMain, minWidth: 80, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark }}
                              placeholder="Add word..."
                              placeholderTextColor={colors.textDim}
                              returnKeyType="done"
                              onSubmitEditing={(e) => {
                                const w = e.nativeEvent.text.trim();
                                if (w) updateTaskStep(step.id, { wordBank: [...step.wordBank, w] });
                              }}
                            />
                          </View>
                        </>
                      )}
                    </View>
                  ))}

                  {/* Questions for Students — only in AI mode */}
                  {createMode === 'ai' && (<>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.fieldLabel}>Questions for Students</Text>
                    {questions.length < 10 && (
                      <TouchableOpacity
                        onPress={() => setQuestions(prev => [...prev, ''])}
                        activeOpacity={0.75}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Feather name="plus-circle" size={14} color={colors.primary} />
                        <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '600' }}>Add</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {questions.map((q, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder={`Question ${i + 1}...`}
                        placeholderTextColor={colors.textDim}
                        value={q}
                        onChangeText={(t) => setQuestions(prev => prev.map((x, j) => j === i ? t : x))}
                      />
                      {questions.length > 1 && (
                        <TouchableOpacity onPress={() => setQuestions(prev => prev.filter((_, j) => j !== i))} activeOpacity={0.75}>
                          <Feather name="trash-2" size={16} color={colors.accentRed} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}

                  </>)}

                  {createMode === 'upload' && (<>
                  {/* ── Extracted Content Summary ── */}
                  {(teacherNotes.trim() || note.trim() || ibWordBank.length > 0 || ibStamps.length > 0 || successCriteria.some(c => c.trim())) && docFiles.length > 0 && (
                    <View style={{ padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '08', gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Feather name="check-circle" size={16} color={colors.accentGreen} />
                        <Text style={{ fontSize: 14, fontWeight: '800', color: colors.accentGreen }}>Content Extracted</Text>
                      </View>
                      {note.trim() ? (
                        <View style={{ gap: 2 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted }}>PURPOSE / LEARNING OUTCOMES</Text>
                          <Text style={{ fontSize: 12, color: colors.textMain, lineHeight: 18 }}>{note}</Text>
                        </View>
                      ) : null}
                      {teacherNotes.trim() ? (
                        <View style={{ gap: 2 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted }}>TASK DESCRIPTION</Text>
                          <Text style={{ fontSize: 12, color: colors.textMain, lineHeight: 18 }}>{teacherNotes}</Text>
                        </View>
                      ) : null}
                      {ibWordBank.length > 0 ? (
                        <View style={{ gap: 4 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#7AADA8' }}>WORD BANK</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            {ibWordBank.map((w, i) => (
                              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: '#7AADA818', borderWidth: 1, borderColor: '#7AADA840' }}>
                                <Text style={{ fontSize: 12, color: '#7AADA8', fontWeight: '600' }}>{w}</Text>
                                <TouchableOpacity onPress={() => setIbWordBank(prev => prev.filter((_, j) => j !== i))} activeOpacity={0.7}>
                                  <Feather name="x" size={10} color="#7AADA8" />
                                </TouchableOpacity>
                              </View>
                            ))}
                            <TextInput
                              style={{ fontSize: 12, color: colors.textMain, minWidth: 80, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark }}
                              placeholder="Add word..."
                              placeholderTextColor={colors.textDim}
                              returnKeyType="done"
                              onSubmitEditing={(e) => {
                                const w = e.nativeEvent.text.trim();
                                if (w) setIbWordBank(prev => [...prev, w]);
                              }}
                            />
                          </View>
                        </View>
                      ) : null}
                      {ibStamps.length > 0 ? (
                        <View style={{ gap: 4 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#8A8358' }}>STAMPS / BADGES</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            {ibStamps.map((s, i) => (
                              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: '#8A835818', borderWidth: 1, borderColor: '#8A835840' }}>
                                <Text style={{ fontSize: 12, color: '#8A8358', fontWeight: '600' }}>{s}</Text>
                                <TouchableOpacity onPress={() => setIbStamps(prev => prev.filter((_, j) => j !== i))} activeOpacity={0.7}>
                                  <Feather name="x" size={10} color="#8A8358" />
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        </View>
                      ) : null}
                      <Text style={{ fontSize: 10, color: colors.textDim, fontStyle: 'italic' }}>
                        Auto-extracted from worksheet. You can edit or remove items.
                      </Text>
                    </View>
                  )}

                  {/* ── Extracted Questions from PDF/Image ── */}
                  {extractedQuestions.length > 0 && (
                    <View style={{ padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.accentCyan + '40', backgroundColor: colors.accentCyan + '08', gap: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Feather name="file-text" size={16} color={colors.accentCyan} />
                        <Text style={{ fontSize: 14, fontWeight: '800', color: colors.accentCyan }}>
                          {extractedQuestions.length} Question{extractedQuestions.length > 1 ? 's' : ''} Extracted
                        </Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.textDim, lineHeight: 16 }}>
                        Edit questions below, set expected answers for AI validation, and add comments for students.
                      </Text>

                      {extractedQuestions.map((eq, idx) => (
                        <View key={idx} style={{ gap: 6, padding: 10, borderRadius: 10, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accentCyan, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff' }}>Q{idx + 1}</Text>
                            </View>
                            <Text style={{ flex: 1, fontSize: 11, fontWeight: '700', color: colors.textDim }}>Question {idx + 1}</Text>
                            <TouchableOpacity onPress={() => setExtractedQuestions(prev => prev.filter((_, i) => i !== idx))}>
                              <Feather name="trash-2" size={14} color={colors.accentRed} />
                            </TouchableOpacity>
                          </View>
                          <TextInput
                            style={[styles.input, { fontSize: 12 }]}
                            value={eq.question}
                            onChangeText={(t) => setExtractedQuestions(prev => prev.map((q, i) => i === idx ? { ...q, question: t } : q))}
                            multiline
                            placeholder="Question text..."
                            placeholderTextColor={colors.textDim}
                          />
                          {/* Reference image: show if already selected, otherwise show Add button */}
                          {eq.croppedImage ? (
                            <View style={{ borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.accentCyan + '40' }}>
                              <Image
                                source={{ uri: eq.croppedImage }}
                                style={{ width: '100%', height: 180, backgroundColor: '#fff' }}
                                resizeMode="contain"
                              />
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.bgDark }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                  <Feather name="image" size={9} color={colors.accentCyan} />
                                  <Text style={{ fontSize: 9, color: colors.accentCyan }}>Reference Image</Text>
                                </View>
                                <View style={{ flexDirection: 'row', gap: 8 }}>
                                  <TouchableOpacity onPress={() => { setCropModalIdx(idx); setCropPageIdx((eq as any).pageIndex || 0); setCropSelection(null); }}>
                                    <Text style={{ fontSize: 9, color: colors.accentYellow }}>Replace</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity onPress={() => setExtractedQuestions(prev => prev.map((q, i) => i === idx ? { ...q, croppedImage: '' } : q))}>
                                    <Text style={{ fontSize: 9, color: colors.error }}>Remove</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            </View>
                          ) : docFiles.length > 0 ? (
                            <TouchableOpacity
                              onPress={() => { setCropModalIdx(idx); setCropPageIdx((eq as any).pageIndex || 0); setCropSelection(null); }}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accentCyan + '60', backgroundColor: colors.accentCyan + '08' }}
                            >
                              <Feather name="crop" size={14} color={colors.accentCyan} />
                              <View>
                                <Text style={{ fontSize: 12, color: colors.accentCyan, fontWeight: '600' }}>Add Reference Image</Text>
                                <Text style={{ fontSize: 9, color: colors.textDim, marginTop: 1 }}>Select the relevant diagram from your worksheet</Text>
                              </View>
                            </TouchableOpacity>
                          ) : null}
                          <TextInput
                            style={[styles.input, { fontSize: 12, borderColor: colors.accentGreen + '50' }]}
                            value={eq.answer}
                            onChangeText={(t) => setExtractedQuestions(prev => prev.map((q, i) => i === idx ? { ...q, answer: t } : q))}
                            placeholder="Expected answer (for AI validation)..."
                            placeholderTextColor={colors.textDim}
                          />
                          <TextInput
                            style={[styles.input, { fontSize: 11, borderColor: colors.accentYellow + '40' }]}
                            value={eq.comment}
                            onChangeText={(t) => setExtractedQuestions(prev => prev.map((q, i) => i === idx ? { ...q, comment: t } : q))}
                            placeholder="Teacher comment for students (optional)..."
                            placeholderTextColor={colors.textDim}
                          />
                        </View>
                      ))}

                    </View>
                  )}

                  {/* ── Output Format — Worksheet or Quiz ── */}
                  <View style={{ gap: 10 }}>
                    <Text style={styles.fieldLabel}>Output Format</Text>
                    <Text style={{ fontSize: 11, color: colors.textDim, lineHeight: 16, marginTop: -4 }}>
                      Choose how students will interact with this content
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      {/* Worksheet option */}
                      <TouchableOpacity
                        style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1.5,
                          borderColor: type === 'assignment' ? colors.accentCyan : colors.borderColor,
                          backgroundColor: type === 'assignment' ? colors.accentCyan + '10' : 'transparent', gap: 6 }}
                        onPress={() => {
                          setType('assignment');
                          if (extractedQuestions.length > 0) {
                            setQuestions(extractedQuestions.map(q => q.question).filter(Boolean));
                            setNote(prev => {
                              const comments = extractedQuestions.filter(q => q.comment.trim()).map((q, i) => `Q${i+1}: ${q.comment}`).join('\n');
                              return comments ? (prev ? prev + '\n\n' + comments : comments) : prev;
                            });
                          }
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: type === 'assignment' ? colors.accentCyan + '20' : colors.borderColor + '60', alignItems: 'center', justifyContent: 'center' }}>
                            <Feather name="file-text" size={16} color={type === 'assignment' ? colors.accentCyan : colors.textDim} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontWeight: '800', color: type === 'assignment' ? colors.accentCyan : colors.textMuted }}>Worksheet</Text>
                            <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>Open-ended with AI grading</Text>
                          </View>
                          {type === 'assignment' && <Feather name="check-circle" size={16} color={colors.accentCyan} />}
                        </View>
                      </TouchableOpacity>

                      {/* Quiz option */}
                      <TouchableOpacity
                        style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1.5,
                          borderColor: type === 'quiz' ? colors.primary : colors.borderColor,
                          backgroundColor: type === 'quiz' ? colors.primaryGlow : 'transparent', gap: 6 }}
                        onPress={() => setType('quiz')}
                        activeOpacity={0.8}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: type === 'quiz' ? colors.primary + '20' : colors.borderColor + '60', alignItems: 'center', justifyContent: 'center' }}>
                            <Feather name="help-circle" size={16} color={type === 'quiz' ? colors.primary : colors.textDim} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontWeight: '800', color: type === 'quiz' ? colors.primary : colors.textMuted }}>Interactive Quiz</Text>
                            <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>MCQ with auto-scoring</Text>
                          </View>
                          {type === 'quiz' && <Feather name="check-circle" size={16} color={colors.primary} />}
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* ── Quiz Generator (shown when quiz format selected) ── */}
                  {type === 'quiz' && (
                    <View style={{ gap: 10, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary + '40', backgroundColor: colors.primaryGlow }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Feather name="zap" size={16} color={colors.primary} />
                        <Text style={{ fontSize: 14, fontWeight: '800', color: colors.primary }}>Generate Quiz with AI</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.textDim, lineHeight: 16 }}>
                        {extractedQuestions.length > 0
                          ? 'Convert extracted questions to interactive MCQ format, or generate new ones from textbook content.'
                          : 'Generate MCQ questions from textbook content for this topic.'}
                      </Text>

                      {/* Difficulty */}
                      <View>
                        <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>Difficulty</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {(['easy','medium','hard'] as const).map(d => (
                            <TouchableOpacity key={d} onPress={() => setQuizDifficulty(d)} activeOpacity={0.75}
                              style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1.5,
                                borderColor: quizDifficulty === d ? colors.primary : colors.borderColor,
                                backgroundColor: quizDifficulty === d ? colors.primaryGlow : 'transparent' }}>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: quizDifficulty === d ? colors.primary : colors.textMuted, textTransform: 'capitalize' }}>{d}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {/* Question count */}
                      <View>
                        <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>Number of Questions</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {[3, 5, 8, 10].map(n => (
                            <TouchableOpacity key={n} onPress={() => setQuizCount(n)} activeOpacity={0.75}
                              style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1.5,
                                borderColor: quizCount === n ? colors.primary : colors.borderColor,
                                backgroundColor: quizCount === n ? colors.primaryGlow : 'transparent' }}>
                              <Text style={{ fontSize: 13, fontWeight: '700', color: quizCount === n ? colors.primary : colors.textMuted }}>{n}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {/* Teacher notes */}
                      <Text style={styles.fieldLabel}>Additional Instructions for AI (optional)</Text>
                      <TextInput
                        style={[styles.input, styles.inputMulti]}
                        placeholder="e.g. Focus on word problems, include a question about fractions, avoid division..."
                        placeholderTextColor={colors.textDim}
                        value={teacherNotes}
                        onChangeText={setTeacherNotes}
                        multiline numberOfLines={2}
                      />

                      {/* Generate buttons */}
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {extractedQuestions.length > 0 && (
                          <TouchableOpacity
                            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                              padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary,
                              backgroundColor: generatingFromExtracted ? colors.borderColor : 'transparent' }}
                            onPress={generateQuizFromExtracted}
                            activeOpacity={0.85}
                            disabled={generatingFromExtracted}
                          >
                            {generatingFromExtracted
                              ? <ActivityIndicator size="small" color={colors.primary} />
                              : <Feather name="repeat" size={14} color={colors.primary} />}
                            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>
                              {generatingFromExtracted ? 'Converting...' : 'From Extracted'}
                            </Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                            padding: 12, borderRadius: 10,
                            backgroundColor: generatingQuiz ? colors.borderColor : colors.primary }}
                          onPress={generateQuiz}
                          activeOpacity={0.85}
                          disabled={generatingQuiz}
                        >
                          {generatingQuiz
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Feather name="zap" size={14} color="#fff" />}
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                            {generatingQuiz ? 'Generating...' : 'From Textbook'}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* ── Editable Quiz Questions Preview ── */}
                      {quizQuestions.length > 0 && (
                        <View style={{ gap: 8, marginTop: 4 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Feather name="check-circle" size={14} color={colors.accentGreen} />
                              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.accentGreen }}>{quizQuestions.length} questions — edit below</Text>
                            </View>
                            <TouchableOpacity onPress={generateQuiz} activeOpacity={0.75}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Feather name="refresh-cw" size={11} color={colors.textDim} />
                              <Text style={{ fontSize: 11, color: colors.textDim }}>Regenerate</Text>
                            </TouchableOpacity>
                          </View>
                          {quizQuestions.map((q, i) => (
                            <View key={q.id || i} style={{ padding: 10, borderRadius: 10, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, gap: 6 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
                                  <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>{i + 1}</Text>
                                </View>
                                <TextInput
                                  style={[styles.input, { flex: 1, fontSize: 12, marginBottom: 0 }]}
                                  value={q.question}
                                  onChangeText={(t) => setQuizQuestions(prev => prev.map((qq, j) => j === i ? { ...qq, question: t } : qq))}
                                  multiline
                                  placeholder="Question text..."
                                  placeholderTextColor={colors.textDim}
                                />
                                <TouchableOpacity onPress={() => setQuizQuestions(prev => prev.filter((_, j) => j !== i))} activeOpacity={0.7} style={{ marginTop: 8 }}>
                                  <Feather name="trash-2" size={14} color={colors.accentRed} />
                                </TouchableOpacity>
                              </View>
                              {/* Editable options with correct answer toggle */}
                              {q.options?.map((opt: string, oi: number) => (
                                <View key={oi} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 32 }}>
                                  <TouchableOpacity
                                    onPress={() => setQuizQuestions(prev => prev.map((qq, j) => j === i ? { ...qq, correct: opt } : qq))}
                                    style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
                                      borderColor: opt === q.correct ? colors.accentGreen : colors.borderColor,
                                      backgroundColor: opt === q.correct ? colors.accentGreen + '20' : 'transparent',
                                      alignItems: 'center', justifyContent: 'center' }}
                                  >
                                    <Text style={{ fontSize: 10, fontWeight: '700', color: opt === q.correct ? colors.accentGreen : colors.textDim }}>
                                      {String.fromCharCode(65 + oi)}
                                    </Text>
                                  </TouchableOpacity>
                                  <TextInput
                                    style={[styles.input, { flex: 1, fontSize: 11, paddingVertical: 5, marginBottom: 0 }]}
                                    value={opt}
                                    onChangeText={(t) => setQuizQuestions(prev => prev.map((qq, j) => {
                                      if (j !== i) return qq;
                                      const newOpts = [...(qq.options || [])];
                                      const wasCorrect = newOpts[oi] === qq.correct;
                                      newOpts[oi] = t;
                                      return { ...qq, options: newOpts, correct: wasCorrect ? t : qq.correct };
                                    }))}
                                    placeholder={`Option ${String.fromCharCode(65 + oi)}...`}
                                    placeholderTextColor={colors.textDim}
                                  />
                                  {opt === q.correct && <Feather name="check-circle" size={14} color={colors.accentGreen} />}
                                </View>
                              ))}
                              {/* Editable hint */}
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 32 }}>
                                <Feather name="info" size={11} color={colors.accentYellow} />
                                <TextInput
                                  style={[styles.input, { flex: 1, fontSize: 10, paddingVertical: 4, marginBottom: 0, borderColor: colors.accentYellow + '30' }]}
                                  value={q.hint || ''}
                                  onChangeText={(t) => setQuizQuestions(prev => prev.map((qq, j) => j === i ? { ...qq, hint: t } : qq))}
                                  placeholder="Hint for students (optional)..."
                                  placeholderTextColor={colors.textDim}
                                />
                              </View>
                            </View>
                          ))}
                          <Text style={{ fontSize: 10, color: colors.textDim, textAlign: 'center', lineHeight: 15 }}>
                            Tap A/B/C/D to set correct answer. Edit question text, options, and hints inline.
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  </>)}

                  {/* ── Success Criteria (both modes, at bottom) ── */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Success Criteria</Text>
                      <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                        {createMode === 'upload' ? 'Auto-extracted from worksheet. Edit or add more.' : 'If visible in the worksheet, AI will auto-detect. Add here if not on worksheet.'}
                      </Text>
                    </View>
                    {successCriteria.length < 10 && (
                      <TouchableOpacity
                        onPress={() => setSuccessCriteria(prev => [...prev, ''])}
                        activeOpacity={0.75}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 }}
                      >
                        <Feather name="plus-circle" size={14} color={colors.primary} />
                        <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '600' }}>Add</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {successCriteria.map((c, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.primary + '60', alignItems: 'center', justifyContent: 'center' }}>
                        <Feather name="check" size={11} color={colors.primary} />
                      </View>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder={`e.g. Wrote a clear paragraph with beginning, middle, end`}
                        placeholderTextColor={colors.textDim}
                        value={c}
                        onChangeText={(t) => setSuccessCriteria(prev => prev.map((x, j) => j === i ? t : x))}
                      />
                      {successCriteria.length > 1 && (
                        <TouchableOpacity onPress={() => setSuccessCriteria(prev => prev.filter((_, j) => j !== i))} activeOpacity={0.75}>
                          <Feather name="trash-2" size={16} color={colors.accentRed} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}

                  <Text style={styles.fieldLabel}>Note (optional)</Text>
                  <TextInput
                    style={[styles.input, styles.inputMulti]}
                    placeholder="Additional instructions for students..."
                    placeholderTextColor={colors.textDim}
                    value={note}
                    onChangeText={setNote}
                    multiline
                    numberOfLines={3}
                  />

                  {/* Assign to */}
                  <Text style={styles.fieldLabel}>Assign to</Text>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      style={[styles.chip, assignTo === 'all' && { backgroundColor: colors.primaryGlow, borderColor: colors.primary }]}
                      onPress={() => { setAssignTo('all'); setSelectedStudent(null); }}
                      activeOpacity={0.75}
                    >
                      <Feather name="users" size={13} color={assignTo === 'all' ? colors.primary : colors.textMuted} />
                      <Text style={[styles.chipText, assignTo === 'all' && { color: colors.primary }]}>All students</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.chip, assignTo === 'specific' && { backgroundColor: colors.primaryGlow, borderColor: colors.primary }]}
                      onPress={() => setAssignTo('specific')}
                      activeOpacity={0.75}
                    >
                      <Feather name="user" size={13} color={assignTo === 'specific' ? colors.primary : colors.textMuted} />
                      <Text style={[styles.chipText, assignTo === 'specific' && { color: colors.primary }]}>Specific student</Text>
                    </TouchableOpacity>
                  </View>

                  {assignTo === 'specific' && (
                    <View style={styles.studentPickerBox}>
                      {selectedStudent ? (
                        <TouchableOpacity style={styles.selectedStudentChip} onPress={() => setSelectedStudent(null)} activeOpacity={0.7}>
                          <Feather name="user" size={13} color={colors.primary} />
                          <Text style={styles.selectedStudentName}>{selectedStudent.name}</Text>
                          <Text style={styles.selectedStudentGrade}>{selectedStudent.grade}</Text>
                          <Feather name="x" size={13} color={colors.textDim} />
                        </TouchableOpacity>
                      ) : (
                        <>
                          <TextInput
                            style={styles.studentSearch}
                            placeholder="Search student by name..."
                            placeholderTextColor={colors.textDim}
                            value={studentSearch}
                            onChangeText={setStudentSearch}
                          />
                          <ScrollView style={styles.studentList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                            {students
                              .filter(s => {
                                const matchSearch = s.name?.toLowerCase().includes(studentSearch.toLowerCase());
                                const matchCurriculum = !teacherCurriculum || !s.curriculum || s.curriculum === teacherCurriculum;
                                // Only show students in the selected grade
                                const matchGrade = !grade || s.grade === grade;
                                return matchSearch && matchCurriculum && matchGrade;
                              })
                              .map(s => (
                                <TouchableOpacity
                                  key={s.id}
                                  style={styles.studentRow}
                                  onPress={() => { setSelectedStudent(s); setStudentSearch(''); }}
                                  activeOpacity={0.7}
                                >
                                  <View style={styles.studentAvatar}>
                                    <Text style={styles.studentAvatarText}>{s.name?.[0] ?? '?'}</Text>
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.studentRowName}>{s.name}</Text>
                                    <Text style={styles.studentRowGrade}>{s.grade}</Text>
                                  </View>
                                  <Feather name="chevron-right" size={14} color={colors.textDim} />
                                </TouchableOpacity>
                              ))}
                          </ScrollView>
                        </>
                      )}
                    </View>
                  )}

                  {assignTo === 'all' && (
                    <View style={styles.broadcastNote}>
                      <Feather name="info" size={13} color={colors.primary} />
                      <Text style={styles.broadcastNoteText}>This assignment will be sent to all your students.</Text>
                    </View>
                  )}

                  {/* ── Student Experience Preview ── */}
                  {type === 'assignment' && (() => {
                    const hasSteps = taskSteps.length > 0;
                    const hasDocs  = docFiles.length > 0;
                    const mode = hasSteps ? 'scaffolded' : hasDocs ? 'worksheet' : 'paper';
                    const modeColor = hasSteps ? '#5A8A70' : hasDocs ? '#5F8A86' : '#8A8358';
                    const modeIcon  = hasSteps ? 'layers' : hasDocs ? 'file-text' : 'camera';
                    const modeLabel = hasSteps
                      ? 'Interactive Online Assignment'
                      : hasDocs
                      ? 'Worksheet + Photo Submission'
                      : 'Paper + Photo Submission';
                    const modeDesc = hasSteps
                      ? `Student will complete ${taskSteps.length} interactive step${taskSteps.length > 1 ? 's' : ''} online: ${taskSteps.map(s => s.label || s.type).join(' → ')}. AI grades each step automatically.`
                      : hasDocs
                      ? `Student will see ${docFiles.length} worksheet page${docFiles.length > 1 ? 's' : ''}, complete on paper, then upload a photo. AI grades the photo.`
                      : 'Student will read the instructions, complete on paper, then upload a photo. AI grades the photo.';
                    return (
                      <View style={{ padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: modeColor + '50', backgroundColor: modeColor + '10', gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Feather name={modeIcon as any} size={16} color={modeColor} />
                          <Text style={{ fontSize: 12, fontWeight: '800', color: modeColor }}>Student will see: {modeLabel}</Text>
                        </View>
                        <Text style={{ fontSize: 11, color: colors.textMuted, lineHeight: 17 }}>{modeDesc}</Text>
                        {mode === 'paper' && (
                          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                            <Feather name="alert-circle" size={12} color={colors.accentYellow} style={{ marginTop: 1 }} />
                            <Text style={{ flex: 1, fontSize: 11, color: colors.accentYellow, lineHeight: 16 }}>
                              To make this interactive (brainstorm + draw + write online), use "Generate AI Assignment" above to create task steps.
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })()}

                  {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

                  {/* Preview button */}
                  <TouchableOpacity
                    style={[styles.submitBtn, { backgroundColor: colors.accentCyan }]}
                    onPress={() => {
                      if (!title.trim()) { setFormError('Title is required'); return; }
                      if (!dueDate.trim()) { setFormError('Due date is required'); return; }
                      if (type === 'quiz' && quizQuestions.length === 0) { setFormError('Generate quiz questions first.'); return; }
                      setFormError('');
                      setShowPreview(true);
                    }}
                    activeOpacity={0.85}
                  >
                    <Feather name="eye" size={15} color="#fff" />
                    <Text style={styles.submitBtnText}>Preview Before Publishing</Text>
                  </TouchableOpacity>
                  {/* Close common fields wrapper */}
                  </>)}
                </ScrollView>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── CROP MODAL: Teacher selects area from worksheet page ── */}
        <Modal visible={cropModalIdx !== null} animationType="fade" transparent onRequestClose={() => setCropModalIdx(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: colors.cardDark, borderRadius: 16, width: '95%', maxWidth: 700, maxHeight: '92%', borderWidth: 1, borderColor: colors.borderColor, overflow: 'hidden' }}>
              {/* Header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderColor }}>
                <View>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Select Reference Image</Text>
                  <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 2 }}>Drag on the worksheet to select the area for this question</Text>
                </View>
                <TouchableOpacity onPress={() => setCropModalIdx(null)}>
                  <Feather name="x" size={20} color={colors.textDim} />
                </TouchableOpacity>
              </View>

              {/* Page selector */}
              {docFiles.length > 1 && (
                <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 6, gap: 6 }}>
                  {docFiles.map((_, pi) => (
                    <TouchableOpacity
                      key={pi}
                      onPress={() => { setCropPageIdx(pi); setCropSelection(null); }}
                      style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6, backgroundColor: cropPageIdx === pi ? colors.primary : colors.bgDark, borderWidth: 1, borderColor: cropPageIdx === pi ? colors.primary : colors.borderColor }}
                    >
                      <Text style={{ fontSize: 11, color: cropPageIdx === pi ? '#fff' : colors.textDim }}>Page {pi + 1}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Worksheet page image with drag-to-select */}
              <ScrollView style={{ flex: 1, padding: 10 }}>
                {docFiles[cropPageIdx] && Platform.OS === 'web' ? (
                  <View
                    style={{ position: 'relative', alignSelf: 'center', cursor: 'crosshair' } as any}
                    {...(Platform.OS === 'web' ? {
                      onMouseDown: (e: any) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        setCropSelection({ startX: x, startY: y, endX: x, endY: y });
                        setIsDragging(true);
                      },
                      onMouseMove: (e: any) => {
                        if (!isDragging || !cropSelection) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                        const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
                        setCropSelection(prev => prev ? { ...prev, endX: x, endY: y } : null);
                      },
                      onMouseUp: () => setIsDragging(false),
                      onMouseLeave: () => setIsDragging(false),
                    } : {})}
                  >
                    <Image
                      source={{ uri: `data:${docFiles[cropPageIdx].mime};base64,${docFiles[cropPageIdx].base64}` }}
                      style={{ width: 600, height: 850, resizeMode: 'contain', backgroundColor: '#fff', borderRadius: 4 } as any}
                    />
                    {/* Selection overlay */}
                    {cropSelection && (
                      <View
                        style={{
                          position: 'absolute',
                          left: Math.min(cropSelection.startX, cropSelection.endX),
                          top: Math.min(cropSelection.startY, cropSelection.endY),
                          width: Math.abs(cropSelection.endX - cropSelection.startX),
                          height: Math.abs(cropSelection.endY - cropSelection.startY),
                          borderWidth: 2,
                          borderColor: '#00bcd4',
                          borderStyle: 'dashed',
                          backgroundColor: 'rgba(0,188,212,0.15)',
                        }}
                      />
                    )}
                  </View>
                ) : (
                  <Text style={{ color: colors.textDim, textAlign: 'center', padding: 40 }}>No worksheet pages available</Text>
                )}
              </ScrollView>

              {/* Action buttons */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderTopWidth: 1, borderTopColor: colors.borderColor }}>
                <TouchableOpacity onPress={() => setCropModalIdx(null)} style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: colors.bgDark }}>
                  <Text style={{ fontSize: 12, color: colors.textDim }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    if (cropModalIdx === null || !cropSelection || !docFiles[cropPageIdx]) return;
                    const sel = cropSelection;
                    const minX = Math.min(sel.startX, sel.endX);
                    const minY = Math.min(sel.startY, sel.endY);
                    const selW = Math.abs(sel.endX - sel.startX);
                    const selH = Math.abs(sel.endY - sel.startY);
                    if (selW < 10 || selH < 10) return; // too small

                    // Crop using canvas
                    if (Platform.OS === 'web') {
                      const img = new window.Image();
                      img.src = `data:${docFiles[cropPageIdx].mime};base64,${docFiles[cropPageIdx].base64}`;
                      img.onload = () => {
                        // Scale selection coordinates to actual image dimensions
                        // The displayed image is 600x850 (contain), find actual scale
                        const dispW = 600, dispH = 850;
                        const scaleX = img.width / Math.min(dispW, img.width * (dispH / img.height));
                        const scaleY = img.height / Math.min(dispH, img.height * (dispW / img.width));
                        const imgAspect = img.width / img.height;
                        const dispAspect = dispW / dispH;
                        let actualW: number, actualH: number, offsetX = 0, offsetY = 0;
                        if (imgAspect > dispAspect) {
                          actualW = dispW;
                          actualH = dispW / imgAspect;
                          offsetY = (dispH - actualH) / 2;
                        } else {
                          actualH = dispH;
                          actualW = dispH * imgAspect;
                          offsetX = (dispW - actualW) / 2;
                        }
                        const sx = ((minX - offsetX) / actualW) * img.width;
                        const sy = ((minY - offsetY) / actualH) * img.height;
                        const sw = (selW / actualW) * img.width;
                        const sh = (selH / actualH) * img.height;

                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(sw));
                        canvas.height = Math.max(1, Math.round(sh));
                        const ctx = canvas.getContext('2d')!;
                        ctx.drawImage(img, Math.max(0, sx), Math.max(0, sy), sw, sh, 0, 0, canvas.width, canvas.height);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

                        setExtractedQuestions(prev => prev.map((q, i) =>
                          i === cropModalIdx ? { ...q, croppedImage: dataUrl } : q
                        ));
                        setCropModalIdx(null);
                        setCropSelection(null);
                      };
                    }
                  }}
                  disabled={!cropSelection || Math.abs((cropSelection?.endX || 0) - (cropSelection?.startX || 0)) < 10}
                  style={{ paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, backgroundColor: cropSelection && Math.abs(cropSelection.endX - cropSelection.startX) >= 10 ? colors.primary : colors.bgDark }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}>Crop & Attach</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── PREVIEW MODAL (separate screen) ── */}
        <Modal visible={showPreview} animationType="slide" transparent onRequestClose={() => setShowPreview(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: colors.cardDark, borderRadius: 20, width: '100%', maxWidth: 640, maxHeight: '92%', borderWidth: 1, borderColor: colors.borderColor, overflow: 'hidden' }}>
              {/* Preview Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: colors.borderColor }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Feather name="eye" size={18} color={colors.accentGreen} />
                  <Text style={{ fontSize: 18, fontWeight: '800', color: colors.accentGreen }}>Preview</Text>
                </View>
                <TouchableOpacity onPress={() => setShowPreview(false)} activeOpacity={0.75}>
                  <Feather name="x" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 30 }}>
                {/* Basic info card */}
                <View style={{ padding: 14, borderRadius: 14, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, gap: 8 }}>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: colors.textMain }}>{title}</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>
                    {subject} · {grade} · {curriculum} · Due: {dueDate}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: type === 'quiz' ? colors.primary + '20' : colors.accentYellow + '20' }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: type === 'quiz' ? colors.primary : colors.accentYellow }}>
                        {type === 'quiz' ? 'QUIZ' : 'ASSIGNMENT'}
                      </Text>
                    </View>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.borderColor }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textMuted }}>
                        {assignTo === 'all' ? 'All Students' : selectedStudent?.name || 'Specific Student'}
                      </Text>
                    </View>
                  </View>
                  {chapter.trim() ? (
                    <Text style={{ fontSize: 12, color: colors.textDim }}>Chapter: {chapter}</Text>
                  ) : null}
                </View>

                {note.trim() ? (
                  <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor }}>
                    <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '600', marginBottom: 4 }}>Note for students:</Text>
                    <Text style={{ fontSize: 13, color: colors.textMain, lineHeight: 20 }}>{note}</Text>
                  </View>
                ) : null}

                {/* Quiz questions preview — editable */}
                {type === 'quiz' && quizQuestions.length > 0 && (
                  <View style={{ gap: 10 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: colors.accentGreen }}>
                      Quiz Questions ({quizQuestions.length})
                    </Text>
                    {quizQuestions.map((q, i) => (
                      <View key={q.id || i} style={{ padding: 12, borderRadius: 12, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>{i + 1}</Text>
                          </View>
                          <TextInput
                            style={[styles.input, { flex: 1, fontSize: 13, marginBottom: 0 }]}
                            value={q.question}
                            onChangeText={(t) => setQuizQuestions(prev => prev.map((qq, j) => j === i ? { ...qq, question: t } : qq))}
                            multiline
                          />
                          <TouchableOpacity onPress={() => setQuizQuestions(prev => prev.filter((_, j) => j !== i))}>
                            <Feather name="trash-2" size={14} color={colors.accentRed} />
                          </TouchableOpacity>
                        </View>
                        {q.options?.map((opt: string, oi: number) => (
                          <View key={oi} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 32 }}>
                            <TouchableOpacity
                              onPress={() => setQuizQuestions(prev => prev.map((qq, j) => j === i ? { ...qq, correct: opt } : qq))}
                              style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5,
                                borderColor: opt === q.correct ? colors.accentGreen : colors.borderColor,
                                backgroundColor: opt === q.correct ? colors.accentGreen + '20' : 'transparent',
                                alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Text style={{ fontSize: 10, fontWeight: '700', color: opt === q.correct ? colors.accentGreen : colors.textDim }}>
                                {String.fromCharCode(65 + oi)}
                              </Text>
                            </TouchableOpacity>
                            <TextInput
                              style={[styles.input, { flex: 1, fontSize: 12, paddingVertical: 5, marginBottom: 0 }]}
                              value={opt}
                              onChangeText={(t) => setQuizQuestions(prev => prev.map((qq, j) => {
                                if (j !== i) return qq;
                                const newOpts = [...(qq.options || [])];
                                const wasCorrect = newOpts[oi] === qq.correct;
                                newOpts[oi] = t;
                                return { ...qq, options: newOpts, correct: wasCorrect ? t : qq.correct };
                              }))}
                            />
                            {opt === q.correct && <Feather name="check-circle" size={14} color={colors.accentGreen} />}
                          </View>
                        ))}
                        {q.hint && (
                          <View style={{ flexDirection: 'row', gap: 4, paddingLeft: 32 }}>
                            <Feather name="info" size={10} color={colors.accentYellow} style={{ marginTop: 2 }} />
                            <Text style={{ fontSize: 10, color: colors.accentYellow, flex: 1 }}>Hint: {q.hint}</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {/* Task steps preview (AI assignment) */}
                {type === 'assignment' && taskSteps.length > 0 && (
                  <View style={{ gap: 10 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#7AADA8' }}>
                      Task Steps ({taskSteps.length})
                    </Text>
                    {taskSteps.map((step, idx) => (
                      <View key={step.id} style={{ padding: 12, borderRadius: 12, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: STEP_COLORS[step.type] + '40', gap: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: STEP_COLORS[step.type] + '30', alignItems: 'center', justifyContent: 'center' }}>
                            <Feather name={STEP_ICONS[step.type] as any} size={12} color={STEP_COLORS[step.type]} />
                          </View>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMain }}>{step.label}</Text>
                        </View>
                        <Text style={{ fontSize: 11, color: colors.textDim, paddingLeft: 32 }}>{step.instructions}</Text>
                        {step.sections.length > 0 && (
                          <View style={{ paddingLeft: 32, gap: 2, marginTop: 2 }}>
                            {step.sections.map((s, si) => (
                              <Text key={si} style={{ fontSize: 10, color: colors.textMuted }}>- {s}</Text>
                            ))}
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {/* Worksheet questions preview */}
                {type === 'assignment' && taskSteps.length === 0 && questions.filter(q => q.trim()).length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: colors.textMuted }}>
                      Questions ({questions.filter(q => q.trim()).length})
                    </Text>
                    {questions.filter(q => q.trim()).map((q, i) => (
                      <View key={i} style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textDim }}>{i + 1}.</Text>
                        <Text style={{ fontSize: 13, color: colors.textMain, flex: 1, lineHeight: 20 }}>{q}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Extracted questions with answers */}
                {extractedQuestions.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: colors.accentCyan }}>
                      Extracted Questions ({extractedQuestions.length})
                    </Text>
                    {extractedQuestions.map((eq, idx) => (
                      <View key={idx} style={{ padding: 10, borderRadius: 10, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, gap: 6 }}>
                        <Text style={{ fontSize: 13, color: colors.textMain, fontWeight: '600' }}>Q{idx + 1}. {eq.question}</Text>
                        {eq.croppedImage ? (
                          <View style={{ borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.accentCyan + '40' }}>
                            <Image
                              source={{ uri: eq.croppedImage }}
                              style={{ width: '100%', height: 160, backgroundColor: '#fff' }}
                              resizeMode="contain"
                            />
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center', paddingVertical: 3, backgroundColor: colors.bgDark }}>
                              <Feather name="image" size={9} color={colors.accentCyan} />
                              <Text style={{ fontSize: 9, color: colors.accentCyan }}>Reference Image</Text>
                            </View>
                          </View>
                        ) : null}
                        {eq.answer.trim() ? (
                          <Text style={{ fontSize: 11, color: colors.accentGreen }}>Answer: {eq.answer}</Text>
                        ) : null}
                        {eq.comment.trim() ? (
                          <Text style={{ fontSize: 11, color: colors.accentYellow, fontStyle: 'italic' }}>Comment: {eq.comment}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}

                {docFiles.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Feather name="image" size={14} color={colors.primary} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>
                        Worksheet Pages ({docFiles.length})
                      </Text>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 4 }}>
                        {docFiles.map((f, idx) => (
                          <View key={idx} style={{ width: 160, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderColor }}>
                            {f.mime.startsWith('image/') ? (
                              <Image source={{ uri: `data:${f.mime};base64,${f.base64}` }} style={{ width: 160, height: 220 }} resizeMode="contain" />
                            ) : (
                              <View style={{ width: 160, height: 220, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgDark }}>
                                <Feather name="file-text" size={32} color={colors.primary} />
                              </View>
                            )}
                            <View style={{ padding: 6, backgroundColor: colors.bgDark }}>
                              <Text style={{ fontSize: 10, color: colors.textDim, textAlign: 'center' }}>Page {idx + 1}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}
              </ScrollView>

              {/* Bottom action bar */}
              <View style={{ gap: 8, padding: 18, borderTopWidth: 1, borderTopColor: colors.borderColor }}>
                {formError ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 8, backgroundColor: colors.accentRed + '15', borderWidth: 1, borderColor: colors.accentRed + '30' }}>
                    <Feather name="alert-circle" size={14} color={colors.accentRed} />
                    <Text style={{ flex: 1, fontSize: 12, color: colors.accentRed, fontWeight: '600' }}>{formError}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.borderColor }}
                  onPress={() => setShowPreview(false)}
                  activeOpacity={0.75}
                >
                  <Feather name="edit-2" size={14} color={colors.textMuted} />
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMuted }}>Back to Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, { flex: 2 }]}
                  onPress={createAssignment}
                  activeOpacity={0.85}
                  disabled={creating}
                >
                  {creating ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="send" size={15} color="#fff" />
                      <Text style={styles.submitBtnText}>Publish Assignment</Text>
                    </>
                  )}
                </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', gap: 2,
  },
  statValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  statLabel: { fontSize: 10, color: c.textDim, textAlign: 'center', fontWeight: '500' },

  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tabs: { gap: spacing.sm },
  tab: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  tabActive: { backgroundColor: c.primaryGlow, borderColor: c.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  tabTextActive: { color: c.primary },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.primary, paddingHorizontal: spacing.md, paddingVertical: 9,
    borderRadius: radius.md,
  },
  createBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  empty: { alignItems: 'center', gap: 8, paddingTop: 40, paddingBottom: 20 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: c.textMain },
  emptyText: { fontSize: 13, color: c.textDim },

  card: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, overflow: 'hidden', flexDirection: 'row',
  },
  cardAccent: { width: 4 },
  cardBody: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  typePill: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1,
  },
  typeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  subjectLabel: { fontSize: 11, color: c.textDim, fontWeight: '600' },
  broadcastPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: c.primaryGlow, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  broadcastText: { fontSize: 9, color: c.primary, fontWeight: '700' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: c.textMain },
  cardChapter: { fontSize: 12, color: c.textMuted, marginTop: 2 },

  completedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.accentGreen + '18', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  pendingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.accentYellow + '18', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  overdueBadge: { backgroundColor: c.accentRed + '18' },
  statusText: { fontSize: 10, fontWeight: '700' },

  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dueDateText: { fontSize: 12, color: c.textDim },
  cardActions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    height: 28, paddingHorizontal: 8, borderRadius: 8,
    backgroundColor: c.borderColor, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 4, borderWidth: 1, borderColor: c.borderColor,
  },
  actionBtnLabel: { fontSize: 11, fontWeight: '700' },
  noteText: { fontSize: 12, color: c.textDim, fontStyle: 'italic', lineHeight: 18 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalBox: {
    backgroundColor: c.cardDark, borderRadius: radius.lg,
    marginHorizontal: spacing.lg, marginBottom: spacing.lg,
    borderWidth: 1, borderColor: c.borderColor, overflow: 'hidden',
    width: '100%', maxWidth: 600,
  },
  modalSaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: radius.md,
    backgroundColor: c.primary,
  },
  modalSaveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  modalCancelBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
  },
  modalCancelBtnText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  modalSheet: {
    backgroundColor: c.cardDark, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%', borderWidth: 1, borderColor: c.borderColor,
    width: '100%', maxWidth: 640,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: c.textMain },
  modalContent: { padding: spacing.xl, gap: spacing.md, paddingBottom: 40 },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
    color: c.textMain, fontSize: 14,
  },
  inputMulti: { height: 80, textAlignVertical: 'top', paddingTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  uploadDocBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.borderColor,
    borderRadius: radius.md, padding: spacing.md,
    backgroundColor: c.bgDark,
  },
  uploadDocText: { fontSize: 13, fontWeight: '500', color: c.textMuted, flex: 1 },
  broadcastNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.primaryGlow, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: c.primary + '30',
  },
  broadcastNoteText: { fontSize: 12, color: c.primary, flex: 1 },
  errorText: { fontSize: 13, color: c.accentRed, fontWeight: '600' },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.primary, padding: 16, borderRadius: radius.md, marginTop: spacing.sm,
  },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  // Student picker
  studentPickerBox: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, overflow: 'hidden' },
  studentSearch: {
    backgroundColor: c.bgDark, borderBottomWidth: 1, borderBottomColor: c.borderColor,
    padding: spacing.md, color: c.textMain, fontSize: 13,
  },
  studentList:          { maxHeight: 160 },
  studentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: c.borderColor + '60',
  },
  studentAvatar: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: c.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  studentAvatarText:    { fontSize: 13, fontWeight: '700', color: c.primary },
  studentRowName:       { fontSize: 13, fontWeight: '600', color: c.textMain },
  studentRowGrade:      { fontSize: 11, color: c.textDim },
  selectedStudentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: spacing.md, backgroundColor: c.primary + '14',
  },
  selectedStudentName:  { fontSize: 13, fontWeight: '600', color: c.textMain, flex: 1 },
  selectedStudentGrade: { fontSize: 11, color: c.textDim },
});

// ── AI Report Modal (teacher view) ────────────────────────────────────────────

const SUBJECT_COLORS_MAP: Record<string, string> = {
  Mathematics: '#818CF8', Science: '#34D399', English: '#FBBF24', 'Social Studies': '#22D3EE',
};

function AIReportModal({ assignment, colors, onClose }: { assignment: Assignment; colors: AppColors; onClose: () => void }) {
  const color = SUBJECT_COLORS_MAP[assignment.subject] || colors.primary;

  let feedbackText = '';
  let stamp = '';
  let wellDone = '';
  let improve = '';
  let perQuestion: any[] = [];
  try {
    const parsed = JSON.parse(assignment.aiFeedback || '{}');
    feedbackText  = parsed.text        || '';
    stamp         = parsed.stamp       || '';
    wellDone      = parsed.wellDone    || '';
    improve       = parsed.improve     || '';
    perQuestion   = Array.isArray(parsed.perQuestion) ? parsed.perQuestion : [];
  } catch {
    feedbackText = assignment.aiFeedback || '';
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.cardDark, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', borderWidth: 1, borderBottomWidth: 0, borderColor: colors.borderColor }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.borderColor, gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: color + '20', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="bar-chart-2" size={18} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.textMain }} numberOfLines={1}>{assignment.title}</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>AI Assessment Report</Text>
            </View>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}>
            {/* Score + Stamp */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1, alignItems: 'center', padding: 20, borderRadius: 14, backgroundColor: color + '12', borderWidth: 1, borderColor: color + '30' }}>
                <Text style={{ fontSize: 42, fontWeight: '900', color, letterSpacing: -1 }}>
                  {assignment.score != null ? `${assignment.score}%` : '--'}
                </Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color, marginTop: 4 }}>Overall Score</Text>
              </View>
              {stamp ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 14, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor }}>
                  <Feather name="award" size={24} color={color} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color, textAlign: 'center', marginTop: 8 }}>{stamp}</Text>
                </View>
              ) : null}
            </View>

            {/* Overall feedback */}
            {feedbackText ? (
              <View style={{ backgroundColor: colors.bgDark, borderRadius: 12, padding: 16, gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.8 }}>Overall Feedback</Text>
                <Text style={{ fontSize: 14, color: colors.textMain, lineHeight: 22 }}>{feedbackText}</Text>
              </View>
            ) : null}

            {/* Well done + Improve */}
            {wellDone ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '08' }}>
                <Feather name="check-circle" size={16} color={colors.accentGreen} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accentGreen, textTransform: 'uppercase' }}>Strength</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{wellDone}</Text>
                </View>
              </View>
            ) : null}
            {improve ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '08' }}>
                <Feather name="target" size={16} color={colors.accentYellow} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accentYellow, textTransform: 'uppercase' }}>Needs Improvement</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{improve}</Text>
                </View>
              </View>
            ) : null}

            {/* Per-question breakdown */}
            {perQuestion.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.8 }}>Question Analysis</Text>
                {perQuestion.map((q: any, idx: number) => {
                  const qColor = !q.answered ? colors.textDim
                    : q.correct ? colors.accentGreen
                    : q.score >= 50 ? colors.accentYellow
                    : colors.accentRed;
                  const qIcon = !q.answered ? 'minus-circle' : q.correct ? 'check-circle' : q.score >= 50 ? 'alert-circle' : 'x-circle';
                  return (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: qColor + '40', backgroundColor: qColor + '08' }}>
                      <Feather name={qIcon as any} size={16} color={qColor} style={{ marginTop: 1 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: qColor }}>Q{q.number ?? idx + 1}</Text>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMain, lineHeight: 18, marginBottom: 3 }} numberOfLines={2}>{q.question}</Text>
                        <Text style={{ fontSize: 12, color: q.answered ? colors.textMuted : qColor, lineHeight: 17 }}>{q.comment}</Text>
                        {q.studentAnswer ? (
                          <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 3, fontStyle: 'italic' }}>Student wrote: {q.studentAnswer}</Text>
                        ) : null}
                      </View>
                      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: qColor + '20' }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: qColor }}>{q.answered ? `${q.score}%` : '--'}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: 12, backgroundColor: color }}
              onPress={onClose} activeOpacity={0.85}
            >
              <Feather name="check" size={16} color="#fff" />
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Close Report</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
