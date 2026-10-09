// Network-backed services tested with a stubbed global fetch (no real network).
const test = require('node:test');
const assert = require('node:assert');

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

function freshTriage() {
  for (const k of Object.keys(require.cache)) if (/services[\\/](triage|llm)\.js$/.test(k)) delete require.cache[k];
  return require('../server/services/triage');
}
const llmReply = (obj) => async () => ({ ok: true, json: async () => ({ content: [{ text: JSON.stringify(obj) }] }) });

test('LLM can raise urgency (rules+llm)', async () => {
  process.env.MOCK_MODE = 'false'; process.env.ANTHROPIC_API_KEY = 'k';
  global.fetch = llmReply({ urgency_level: 'Urgent', reason: 'looks worse than reported' });
  const r = await freshTriage().triage({ symptoms: 'minor cut' });
  assert.strictEqual(r.urgency_level, 'Urgent');
  assert.strictEqual(r.source, 'rules+llm');
});

test('LLM can never lower a Critical rule result', async () => {
  process.env.MOCK_MODE = 'false'; process.env.ANTHROPIC_API_KEY = 'k';
  global.fetch = llmReply({ urgency_level: 'Stable', reason: 'fine' });
  const r = await freshTriage().triage({ symptoms: 'chest pain' });
  assert.strictEqual(r.urgency_level, 'Critical');
  assert.strictEqual(r.source, 'rules');
});

test('LLM failure, bad level, or MOCK_MODE falls back to rules', async () => {
  process.env.MOCK_MODE = 'false'; process.env.ANTHROPIC_API_KEY = 'k';
  global.fetch = async () => { throw new Error('network down'); };
  assert.strictEqual((await freshTriage().triage({ symptoms: 'fracture' })).source, 'rules');
  global.fetch = llmReply({ urgency_level: 'Catastrophic' });
  assert.strictEqual((await freshTriage().triage({ symptoms: 'fracture' })).source, 'rules');
  process.env.MOCK_MODE = 'true';
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not be called'); };
  assert.strictEqual((await freshTriage().triage({ symptoms: 'fracture' })).source, 'rules');
  assert.strictEqual(called, false);
});

test('no API key means no network call', async () => {
  process.env.MOCK_MODE = 'false'; process.env.ANTHROPIC_API_KEY = '';
  let called = false;
  global.fetch = async () => { called = true; };
  const r = await freshTriage().triage({ symptoms: 'burn' });
  assert.strictEqual(r.source, 'rules');
  assert.strictEqual(called, false);
});

test('OSRM response is converted to [lat,lng] with traffic multiplier; failure falls back', async () => {
  process.env.MOCK_MODE = 'false';
  const routing = require('../server/services/routing');
  const noon = new Date(2026, 0, 1, 12); // moderate: 1.2
  global.fetch = async (url) => {
    assert.match(url, /router\.project-osrm\.org\/route\/v1\/driving\/83\.3,17\.7;83\.4,17\.8\?overview=full&geometries=geojson/);
    return { ok: true, json: async () => ({ routes: [{ duration: 600, distance: 5000, geometry: { coordinates: [[83.3, 17.7], [83.4, 17.8]] } }] }) };
  };
  const r = await routing.getRoute({ lat: 17.7, lng: 83.3 }, { lat: 17.8, lng: 83.4 }, noon);
  assert.strictEqual(r.source, 'osrm');
  assert.strictEqual(r.eta_min, 12);
  assert.deepStrictEqual(r.geometry[0], [17.7, 83.3]);
  assert.strictEqual(r.traffic_level, 'moderate');
  global.fetch = async () => { throw new Error('down'); };
  const f = await routing.getRoute({ lat: 17.7, lng: 83.3 }, { lat: 17.8, lng: 83.4 }, noon);
  assert.strictEqual(f.source, 'estimate');
  assert.strictEqual(f.geometry.length, 2);
});

test('traffic multiplier by hour', () => {
  const { trafficFor } = require('../server/services/routing');
  const at = (h) => trafficFor(new Date(2026, 0, 1, h));
  assert.deepStrictEqual([at(9).multiplier, at(18).multiplier], [1.4, 1.4]);
  assert.deepStrictEqual([at(7).multiplier, at(13).multiplier, at(21).multiplier], [1.2, 1.2, 1.2]);
  assert.deepStrictEqual([at(2).multiplier, at(23).multiplier], [1.05, 1.05]);
});
