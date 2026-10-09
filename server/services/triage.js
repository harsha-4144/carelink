const llm = require('./llm');

const CRITICAL = ['unconscious', 'unresponsive', 'not breathing', 'no pulse', 'cardiac arrest', 'severe bleeding',
  'heavy bleeding', 'chest pain', 'collapsed', 'seizure', 'stroke', 'face drooping', 'slurred speech', 'choking',
  'overdose', 'head injury'];
const URGENT = ['fracture', 'broken bone', 'burn', 'high fever', 'confusion', 'vomiting blood', 'difficulty breathing',
  'shortness of breath', 'deep cut', 'moderate bleeding', 'severe pain', 'allergic reaction'];

// First match wins.
const SPECIALTY = [
  [['chest pain', 'cardiac', 'heart'], 'cardiology'],
  [['stroke', 'face drooping', 'slurred', 'seizure', 'head injury'], 'neurology'],
  [['burn'], 'burns'],
  [['fracture', 'broken', 'accident', 'crash'], 'trauma'],
  [['difficulty breathing', 'shortness of breath', 'asthma'], 'pulmonology'],
  [['bleeding'], 'trauma'],
];

function ruleTriage({ symptoms = '', conscious, breathing } = {}) {
  const text = String(symptoms).toLowerCase();
  const critical = CRITICAL.filter((k) => text.includes(k));
  const urgent = URGENT.filter((k) => text.includes(k));
  const matched = [...critical, ...urgent];
  if (conscious === false) matched.unshift('patient not conscious');
  if (breathing === false) matched.unshift('patient not breathing');

  let level = 'Stable';
  if (conscious === false || breathing === false || critical.length) level = 'Critical';
  else if (urgent.length) level = 'Urgent';

  const hit = SPECIALTY.find(([words]) => words.some((w) => text.includes(w)));
  return {
    urgency_level: level,
    urgency_reason: matched.length ? `Matched: ${matched.join(', ')}` : 'No red-flag symptoms reported',
    needed_specialty: hit ? hit[1] : 'general',
    source: 'rules',
  };
}

async function triage(input) {
  const result = ruleTriage(input);
  const refined = await llm.refine(String(input.symptoms || ''), result);
  if (!refined) return result;
  // The LLM may raise urgency but never lower a Critical rule result.
  if (result.urgency_level === 'Critical' && refined.urgency_level !== 'Critical') return result;
  return {
    ...result,
    urgency_level: refined.urgency_level,
    urgency_reason: refined.reason ? `${result.urgency_reason}. AI: ${refined.reason}` : result.urgency_reason,
    source: 'rules+llm',
  };
}

module.exports = { ruleTriage, triage };
