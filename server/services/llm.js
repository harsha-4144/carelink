// Optional LLM refinement through the Anthropic Messages API. Always safe to call:
// returns null when disabled or on any failure, so callers fall back to the rule result.
const LEVELS = ['Critical', 'Urgent', 'Stable'];

function enabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.MOCK_MODE !== 'true';
}

async function refine(symptoms, ruleResult) {
  if (!enabled()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const prompt = `You assist emergency triage. Symptoms reported by a bystander: "${symptoms}".\n` +
      `A rule engine rated it ${ruleResult.urgency_level} (${ruleResult.urgency_reason}).\n` +
      'Reply with strict JSON only: {"urgency_level":"Critical|Urgent|Stable","reason":"one short sentence"}';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) throw new Error('LLM status ' + r.status);
    const data = await r.json();
    const text = (data.content || []).map((c) => c.text || '').join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!LEVELS.includes(json.urgency_level)) throw new Error('bad level');
    return { urgency_level: json.urgency_level, reason: String(json.reason || '').slice(0, 300) };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { refine, enabled };
