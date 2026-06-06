/**
 * Content Safety — pre-flight input check for AI Coach.
 * Runs BEFORE the LLM call. If a question contains sensitive content,
 * return a safe canned response instead of calling the LLM.
 *
 * Designed for children aged 8–11 (IB PYP Grade 3–5).
 */

// ── Sensitive topic categories ────────────────────────────────────────────────

const SELF_HARM_RE = /\b(self.?harm|cut.?myself|hurt.?myself|kill.?myself|suicide|suicidal|want.?to.?die|end.?my.?life|not.?want.?to.?live|overdose|hang.?myself|jump.?off)\b/i;

const ABUSE_RE = /\b(someone.?hit|hitting.?me|hurts.?me|abusing|being.?abused|touched.?me|uncle.?touched|touching.?private|molest|stranger.?danger|ran.?away.?from.?home)\b/i;

const VIOLENCE_RE = /\b(how.?to.?kill|how.?to.?hurt|how.?to.?make.?a.?bomb|how.?to.?make.?weapon|how.?to.?fight|stab|shoot.?someone|beat.?someone.?up|make.?poison|how.?to.?make.?gun)\b/i;

const ADULT_RE = /\b(porn|pornography|naked|nude|sex.?video|sex.?scene|sexual|prostitut|escort|adult.?content|18\+|xxx)\b/i;

const DRUG_RE = /\b(how.?to.?take.?drugs|get.?high|weed|cocaine|heroin|meth|mdma|lsd|marijuana|getting.?drunk|how.?to.?drink.?alcohol|buy.?drugs)\b/i;

const PERSONAL_CRISIS_RE = /\b(nobody.?likes.?me|everyone.?hates.?me|i.?have.?no.?friends|i.?want.?to.?run.?away|i.?hate.?my.?life|i.?hate.?myself|i.?feel.?worthless|i.?feel.?hopeless|feeling.?depressed|feeling.?suicidal)\b/i;

// ── Safe responses by category ────────────────────────────────────────────────

const SAFE_RESPONSES = {
  self_harm: `I can hear that things feel really tough right now. You are important and cared about. Please talk to a trusted adult — a parent, teacher, or school counsellor — right away. They are there to help you. 💙`,

  abuse: `What you're describing sounds really serious. Please tell a trusted adult immediately — a parent, teacher, or school counsellor. You are safe to ask for help, and it is always the right thing to do.`,

  violence: `I can only help with school topics like Maths, Science, and English. I'm not able to help with that. If something is worrying you, please talk to a trusted adult.`,

  adult: `I'm your school AI Coach and I only help with your curriculum subjects. I'm not able to help with that topic. Ask me anything about Maths, Science, English, or your other subjects!`,

  drug: `I only help with school subjects. I'm not able to help with that. If you have questions or worries, please talk to a parent or trusted adult.`,

  personal_crisis: `It sounds like you're having a really hard time, and I want you to know your feelings matter. Please talk to a trusted adult — a parent, teacher, or school counsellor. They care about you and can really help. 💙 When you're ready, I'm here to help you learn!`,
};

/**
 * Check if a question is safe to send to the LLM.
 * Returns { safe: true } or { safe: false, category, response }
 */
function checkInputSafety(question) {
  const q = String(question || '');

  if (SELF_HARM_RE.test(q))     return { safe: false, category: 'self_harm',      response: SAFE_RESPONSES.self_harm };
  if (ABUSE_RE.test(q))         return { safe: false, category: 'abuse',           response: SAFE_RESPONSES.abuse };
  if (VIOLENCE_RE.test(q))      return { safe: false, category: 'violence',        response: SAFE_RESPONSES.violence };
  if (ADULT_RE.test(q))         return { safe: false, category: 'adult',           response: SAFE_RESPONSES.adult };
  if (DRUG_RE.test(q))          return { safe: false, category: 'drug',            response: SAFE_RESPONSES.drug };
  if (PERSONAL_CRISIS_RE.test(q)) return { safe: false, category: 'personal_crisis', response: SAFE_RESPONSES.personal_crisis };

  return { safe: true };
}

module.exports = { checkInputSafety };
