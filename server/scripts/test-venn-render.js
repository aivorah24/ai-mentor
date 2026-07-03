// Dev test: render a Venn worksheet quiz to HTML to verify the interactive Venn.
const fs = require('fs');
const path = require('path');
const quizRoute = require('../routes/quiz');

// OLD flattened shape (what the LLM used to produce) — should be auto-upgraded to a real Venn.
const flattened = {
  title: 'Healthy Eating Worksheet',
  subject: 'Science', grade: 'PYP 4',
  tasks: [{
    tier: 'MUST DO',
    title: 'Task 2 · Imagine you are planning a healthy meal and need to choose between adding almonds or spinach to your plate.',
    sharedImage: true,
    sharedImageDescription: "A blank Venn Diagram with two overlapping circles labeled 'Almond' and 'Spinach'.",
    layout: { type: 'single-column', columns: 1 },
    questions: [{
      id: '1', type: 'text',
      question: 'Using the information, complete the following Venn diagram to compare the nutrients in Almonds and Spinach. List the nutrients for Almonds only, Spinach only, and the common nutrients.',
      answer: 'Almond',
      solution: 'Unique to Almonds: Protein, Healthy Fats, Vitamin E, Magnesium. Common nutrients (found in both): Fibre. Unique to Spinach: Iron, Vitamin K, Vitamin A, Calcium.',
    }],
  }],
};

// NEW structured shape (what the updated prompt now asks Gemini for).
const structured = {
  title: 'Healthy Eating Worksheet (structured)',
  subject: 'Science', grade: 'PYP 4',
  tasks: [{
    tier: 'MUST DO', title: 'Task 2 · Almonds vs Spinach',
    layout: { type: 'single-column', columns: 1 },
    questions: [{
      id: '1', type: 'venn',
      question: 'Complete the Venn diagram to compare the nutrients in Almonds and Spinach.',
      leftLabel: 'Almond', rightLabel: 'Spinach',
      answers: {
        left: ['Protein', 'Healthy Fats', 'Vitamin E', 'Magnesium'],
        center: ['Fibre'],
        right: ['Iron', 'Vitamin K', 'Vitamin A', 'Calcium'],
      },
      hint: 'Shared items go in the overlapping middle.',
      solution: 'Almond only: Protein, Healthy Fats, Vitamin E, Magnesium. Both: Fibre. Spinach only: Iron, Vitamin K, Vitamin A, Calcium.',
    }],
  }],
};

for (const [name, quiz] of [['flattened', flattened], ['structured', structured]]) {
  const html = quizRoute.renderQuizHTML(JSON.parse(JSON.stringify(quiz)));
  const out = path.join(__dirname, `../data/venn-test-${name}.html`);
  fs.writeFileSync(out, html);
  // Log the normalized region answers to confirm parsing
  const norm = JSON.parse(JSON.stringify(quiz));
  quizRoute.normalizeVennQuestions(norm);
  console.log(`\n[${name}] -> ${out}`);
  console.log('  regions:', JSON.stringify(norm.tasks[0].questions[0].answers));
  console.log('  labels :', norm.tasks[0].questions[0].leftLabel, '/', norm.tasks[0].questions[0].rightLabel);
}
