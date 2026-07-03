// Aivorah professional-development courses for teachers: how to use everyday AI
// tools (ChatGPT, Claude, Gemini, Perplexity) in day-to-day teaching.
// All content + video is Aivorah's own — no external links. Videos are hosted on
// Aivorah's Cloudinary and set per lesson via `videoUrl` (empty until recorded).

export interface TeacherLesson {
  title: string;
  minutes: number;
  body: string[];        // paragraphs
  bullets?: string[];    // "how to do it" steps
  prompts?: string[];    // copy-paste example prompts
  tip?: string;          // pro tip
  videoUrl?: string;     // Aivorah-hosted (Cloudinary) MP4 — added later
}

export interface TeacherCourse {
  id: string;
  icon: string;          // Feather icon
  title: string;
  desc: string;
  lessons: TeacherLesson[];
}

export const TEACHER_COURSES: TeacherCourse[] = [
  {
    id: 'meet-ai',
    icon: 'cpu',
    title: 'Meet Your AI Assistants',
    desc: 'What ChatGPT, Claude, Gemini and Perplexity each do best',
    lessons: [
      {
        title: 'The four AI tools every teacher should know',
        minutes: 4,
        body: [
          'You do not need every AI tool — you need the right one for the job. Four cover almost everything a teacher needs.',
          'Most are free to start, and you can use them right from your phone or browser. Pick one, get comfortable, then add the others.',
        ],
        bullets: [
          'ChatGPT — the all-rounder: lesson ideas, worksheets, rewriting, emails.',
          'Claude — best for long documents and careful, thoughtful writing/feedback.',
          'Gemini — best inside Google (Docs, Slides, Classroom, Gmail) and for research.',
          'Perplexity — best for research that gives you real sources and citations.',
        ],
        tip: 'Start with one tool this week. Mastery of one beats dabbling in four.',
      },
      {
        title: 'Free vs paid — what you actually need',
        minutes: 3,
        body: [
          'The free versions of all four are enough for most teaching tasks. Paid plans mainly add speed, longer documents, and image features.',
          'Begin free. Only upgrade if you hit limits during real daily use.',
        ],
      },
    ],
  },
  {
    id: 'chatgpt',
    icon: 'message-circle',
    title: 'ChatGPT for Teachers',
    desc: 'The all-rounder for lesson ideas, worksheets and writing',
    lessons: [
      {
        title: 'Create worksheets and quizzes in minutes',
        minutes: 5,
        body: [
          'Describe the topic, grade, and number of questions — ChatGPT drafts them instantly. You review, tweak, and use.',
        ],
        prompts: [
          'Create 10 Grade 4 maths word problems on multiplication, with an answer key.',
          'Make a 5-question reading comprehension quiz for this paragraph: [paste text].',
          'Give me 3 difficulty levels (easy/medium/hard) of questions on the water cycle.',
        ],
        tip: 'Always ask for the answer key in the same prompt — it saves a second step.',
      },
      {
        title: 'Plan lessons and activities',
        minutes: 4,
        body: [
          'ChatGPT can outline a full lesson — objectives, a hook, activities, and an exit check — that you adapt to your class.',
        ],
        prompts: [
          'Plan a 40-minute Grade 3 lesson on fractions with a hands-on activity and an exit ticket.',
          'Give me 5 quick warm-up activities for a Grade 5 science class.',
        ],
      },
      {
        title: 'Rewrite and simplify anything',
        minutes: 3,
        body: [
          'Turn complex text into something your students can read, or shorten a long passage. Great for making any resource grade-appropriate.',
        ],
        prompts: [
          'Rewrite this paragraph for a Grade 2 reading level: [paste].',
          'Summarise this chapter into 5 bullet points students can revise from.',
        ],
      },
    ],
  },
  {
    id: 'claude',
    icon: 'feather',
    title: 'Claude for Teachers',
    desc: 'Best for long documents and careful, thoughtful writing',
    lessons: [
      {
        title: 'Work with long documents',
        minutes: 4,
        body: [
          'Claude handles large amounts of text well. Paste a long chapter, policy, or several pages and ask it to summarise, extract, or make questions from the whole thing.',
        ],
        prompts: [
          'Summarise this 10-page chapter into a one-page student revision sheet: [paste].',
          'Read this unit and list every key term with a simple definition.',
        ],
        tip: 'Claude is great when the input is long — it keeps track of detail across pages.',
      },
      {
        title: 'Write thoughtful feedback and reports',
        minutes: 4,
        body: [
          'Give Claude a few honest notes about a student and it drafts warm, constructive feedback or report-card comments. You keep it accurate and personal.',
        ],
        prompts: [
          'Write a kind, constructive report comment for a student who is strong in maths but rushes and makes careless errors.',
          'Turn these notes into 3 sentences of encouraging feedback: [notes].',
        ],
      },
    ],
  },
  {
    id: 'gemini',
    icon: 'globe',
    title: 'Gemini for Teachers',
    desc: 'Research + your Google Docs, Slides and Classroom workflow',
    lessons: [
      {
        title: 'Use Gemini inside Google tools',
        minutes: 4,
        body: [
          'If your school uses Google Workspace, Gemini lives right inside Docs, Slides, Gmail and Classroom. It can draft a slide deck, a worksheet, or a parent email without leaving the app you already use.',
        ],
        bullets: [
          'In Slides: "Create a 6-slide deck introducing photosynthesis for Grade 5."',
          'In Gmail: "Draft a polite reminder to parents about the field-trip form."',
          'In Docs: "Turn these notes into a structured lesson plan."',
        ],
      },
      {
        title: 'Quick, up-to-date research',
        minutes: 3,
        body: [
          'Gemini is good at pulling current information and explaining it simply. Use it to brush up on a topic before you teach it, or to find fresh real-world examples.',
        ],
        prompts: [
          'Explain the causes of monsoons simply, with one real-world example for Grade 6.',
          'Give me 3 recent real-world examples of recycling I can use in class.',
        ],
      },
    ],
  },
  {
    id: 'perplexity',
    icon: 'search',
    title: 'Perplexity for Teachers',
    desc: 'Research that gives you real sources and citations',
    lessons: [
      {
        title: 'Research you can trust',
        minutes: 4,
        body: [
          'Unlike most chatbots, Perplexity shows you the sources behind its answers. That makes it ideal when accuracy matters — facts, dates, statistics, science.',
          'Always click through to check a source before using a fact with students.',
        ],
        prompts: [
          'What is the population of India in 2024? Include sources.',
          'Give me 3 credible facts about the solar system suitable for Grade 5, with links.',
        ],
        tip: 'Use Perplexity for anything factual; use ChatGPT/Claude for creative or writing tasks.',
      },
      {
        title: 'Build fact-checked teaching material',
        minutes: 3,
        body: [
          'Because it cites sources, Perplexity is great for making accurate worksheets, current-affairs questions, and project briefs that hold up to scrutiny.',
        ],
      },
    ],
  },
  {
    id: 'workflow-safety',
    icon: 'shield',
    title: 'Your Daily AI Workflow + Safety',
    desc: 'Combine the tools, protect privacy, and check accuracy',
    lessons: [
      {
        title: 'A simple daily workflow',
        minutes: 3,
        body: [
          'You do not switch tools randomly — match the tool to the task. A simple routine: research with Perplexity, draft with ChatGPT or Claude, polish inside Gemini/Google.',
        ],
        bullets: [
          'Need facts/sources → Perplexity.',
          'Need a draft/worksheet/email → ChatGPT or Claude.',
          'Need it in Slides/Docs/Classroom → Gemini.',
        ],
      },
      {
        title: 'Protect student privacy',
        minutes: 3,
        body: [
          'Never paste a child’s full name, photo, or sensitive personal details into a public AI tool. Describe the situation generally instead — "a Grade 3 student who struggles with reading".',
        ],
        tip: 'For anything with real student data, use a school-approved tool like Aivorah.',
      },
      {
        title: 'Always check before you trust',
        minutes: 2,
        body: [
          'AI can sound confident and still be wrong, especially with facts and maths. Read everything it produces and verify facts before sharing with students. AI gives you a draft — your judgement makes it right.',
        ],
      },
    ],
  },
];
