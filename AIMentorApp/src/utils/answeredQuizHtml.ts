// Shared "submitted view" renderer for interactive-quiz worksheets.
// Takes the original interactive_quiz_html + a submission (with perQuestion) and
// returns HTML with the student's answers filled in, disabled, colour-marked
// (green = correct, red = wrong), and the real score shown. Used identically by
// the teacher, parent, and student completed views so all three see the same
// submitted worksheet.
export function getAnsweredQuizHtml(originalHtml: string, submission: any): string {
  if (!originalHtml) return '';
  // Interactive-quiz completions store answers under submission_text as
  // { perQuestion: [{qId, answer, correct, ...}] } — there is no separate
  // top-level "answers" map, so build the qId→answer lookup from perQuestion.
  const pq = Array.isArray(submission?.perQuestion) ? submission.perQuestion : [];
  const answersMap: Record<string, any> = {};
  for (const q of pq) {
    if (q && q.qId != null) answersMap[q.qId] = q.answer;
  }
  const answersJson = JSON.stringify(answersMap);
  const perQuestionJson = JSON.stringify(pq);
  const scriptToInject = `
    <script>
      window.addEventListener('load', function() {
        const answers = ${answersJson};
        const pq = ${perQuestionJson};
        for (const [qId, ans] of Object.entries(answers)) {
          const inputEl = document.getElementById(qId + '-input') || document.getElementById(qId);
          if (inputEl) {
            inputEl.value = ans;
            inputEl.disabled = true;
            const qInfo = pq.find(x => x.qId === qId);
            if (qInfo) {
              const correct = qInfo.correct ?? (qInfo.score >= 70);
              inputEl.style.borderColor = correct ? '#8bc34a' : '#e57373';
              inputEl.style.backgroundColor = correct ? 'rgba(139,195,74,0.1)' : 'rgba(229,115,115,0.1)';
            }
            continue;
          }
          const radios = document.getElementsByName(qId);
          if (radios.length > 0) {
            for (const radio of radios) {
              if (radio.value === ans) radio.checked = true;
              radio.disabled = true;
            }
            continue;
          }
          // Venn diagrams: 3 textareas (qId-left/-center/-right); the stored answer
          // is one combined string ("left: a, b | center: c | right: d").
          const leftEl = document.getElementById(qId + '-left');
          if (leftEl && typeof ans === 'string') {
            const parts = ans.split('|').map(function(s) { return s.trim(); });
            parts.forEach(function(part) {
              const m = part.match(/^(left|center|right):\\s*(.*)$/i);
              if (!m) return;
              const el = document.getElementById(qId + '-' + m[1].toLowerCase());
              if (el) { el.value = m[2]; el.disabled = true; }
            });
          }
        }
        document.querySelectorAll('button').forEach(function(btn) { btn.disabled = true; });

        // Set the score badge/progress directly from the completed submission
        // (the in-page up() function never runs in review mode).
        const totalQ = pq.length;
        const correctQ = pq.filter(function(x) { return x.correct === true; }).length;
        const scoreEl = document.getElementById('score-num');
        if (scoreEl && totalQ > 0) scoreEl.textContent = correctQ + '/' + totalQ;
        const pf = document.getElementById('pf');
        if (pf) pf.style.width = '100%';
        const pp = document.getElementById('pp');
        if (pp) pp.textContent = '100% complete';
      });
    </script>
  `;
  return originalHtml.replace('</body>', scriptToInject + '</body>');
}
