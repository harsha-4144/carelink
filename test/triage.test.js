process.env.MOCK_MODE = 'true';
const test = require('node:test');
const assert = require('node:assert');
const { ruleTriage, triage } = require('../server/services/triage');

test('collapsed and unresponsive is Critical', () => {
  assert.strictEqual(ruleTriage({ symptoms: 'man collapsed, unresponsive' }).urgency_level, 'Critical');
});

test('chest pain is Critical with cardiology', () => {
  const r = ruleTriage({ symptoms: 'chest pain and sweating' });
  assert.strictEqual(r.urgency_level, 'Critical');
  assert.strictEqual(r.needed_specialty, 'cardiology');
  assert.match(r.urgency_reason, /^Matched: .*chest pain/);
});

test('fracture is Urgent with trauma', () => {
  const r = ruleTriage({ symptoms: 'suspected fracture in leg after fall' });
  assert.strictEqual(r.urgency_level, 'Urgent');
  assert.strictEqual(r.needed_specialty, 'trauma');
});

test('minor cut is Stable', () => {
  const r = ruleTriage({ symptoms: 'minor cut on finger, conscious and talking' });
  assert.strictEqual(r.urgency_level, 'Stable');
  assert.strictEqual(r.urgency_reason, 'No red-flag symptoms reported');
  assert.strictEqual(r.needed_specialty, 'general');
});

test('breathing:false is always Critical', async () => {
  assert.strictEqual(ruleTriage({ symptoms: 'minor cut on finger', breathing: false }).urgency_level, 'Critical');
  const r = await triage({ symptoms: 'nothing serious', breathing: false });
  assert.strictEqual(r.urgency_level, 'Critical');
  assert.strictEqual(r.source, 'rules');
});

test('conscious:false is Critical', () => {
  assert.strictEqual(ruleTriage({ symptoms: '', conscious: false }).urgency_level, 'Critical');
});
