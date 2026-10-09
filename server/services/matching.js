const { haversine } = require('./geo');
const routing = require('./routing');

const WEIGHTS = {
  Stable: { S: 20, F: 10, E: 20, D: 40, T: 10 },
  Urgent: { S: 30, F: 20, E: 25, D: 15, T: 10 },
  Critical: { S: 25, F: 25, E: 35, D: 10, T: 5 },
};

const RELEVANT_FACILITY = {
  cardiology: 'cath_lab', neurology: 'stroke_unit', trauma: 'trauma', orthopedics: 'trauma', burns: 'burns_unit',
};

const FACILITY_LABEL = { cath_lab: 'cath lab', stroke_unit: 'stroke unit', trauma: 'trauma care', burns_unit: 'burns unit' };

const parse = (v) => (Array.isArray(v) ? v : JSON.parse(v || '[]'));

function terms(h, ctx, etaMin, trafficLevel) {
  const specialties = parse(h.specialties);
  // Staff can mark the ICU full; then it no longer counts.
  const facilities = parse(h.emergency_facilities).filter((f) => f !== 'icu' || h.icu_available !== 0);
  const need = ctx.needed_specialty || 'general';
  const S = specialties.includes(need) ? 1 : specialties.includes('general') ? 0.5 : 0;
  const rel = RELEVANT_FACILITY[need];
  const F = (facilities.includes('emergency_unit') ? 0.5 : 0) + (facilities.includes('icu') ? 0.3 : 0) +
    (rel ? (facilities.includes(rel) ? 0.2 : 0) : 0.2);
  const E = 1 - Math.min(etaMin, 60) / 60;
  const D = 1 - Math.min(h.distance_km, 30) / 30;
  const T = 1 - (trafficLevel === 'high' ? 0.6 : 0.2);
  return { S, F, E, D, T, specialties, facilities };
}

function score(urgency, t) {
  const w = WEIGHTS[urgency] || WEIGHTS.Stable;
  const total = w.S * t.S + w.F * t.F + w.E * t.E + w.D * t.D + w.T * t.T;
  return Math.max(0, Math.min(100, Math.round(total)));
}

function reasonsFor(h, t, ctx, etaMin) {
  const need = ctx.needed_specialty || 'general';
  const rel = RELEVANT_FACILITY[need];
  const out = [];
  if (t.S === 1) {
    out.push(rel && t.facilities.includes(rel) ? `Has ${need} and ${FACILITY_LABEL[rel]}` : `Has ${need} specialists`);
  } else if (t.S === 0.5) {
    out.push(`General care (no dedicated ${need})`);
  }
  out.push(`${Math.round(etaMin)} min away`);
  if (t.facilities.includes('emergency_unit') && t.facilities.includes('icu')) out.push('Emergency unit and ICU');
  else if (t.facilities.includes('emergency_unit')) out.push('Emergency unit');
  return out.slice(0, 3);
}

/**
 * ctx: {hospitals, lat, lng, urgency_level, needed_specialty, now?}
 * Returns the top 3 hospitals with ETAs refined by the routing service.
 */
async function matchHospitals(ctx) {
  const now = ctx.now || new Date();
  const urgency = ctx.urgency_level || 'Stable';
  const traffic = routing.trafficFor(now);
  const needsEmergency = urgency === 'Critical' || urgency === 'Urgent';

  const candidates = ctx.hospitals
    .filter((h) => !needsEmergency || parse(h.emergency_facilities).includes('emergency_unit'))
    .map((h) => {
      const distance_km = haversine(ctx.lat, ctx.lng, h.lat, h.lng);
      const rough = routing.estimate({ lat: ctx.lat, lng: ctx.lng }, h, now);
      const t = terms({ ...h, distance_km }, ctx, rough.eta_min, traffic.level);
      return { h, distance_km, eta_min: rough.eta_min, score: score(urgency, t) };
    })
    .sort((a, b) => b.score - a.score || a.eta_min - b.eta_min)
    .slice(0, 3);

  // Refine the finalists with real routing (OSRM or estimate), then rescore.
  const refined = await Promise.all(candidates.map(async (c) => {
    const route = await routing.getRoute({ lat: ctx.lat, lng: ctx.lng }, c.h, now);
    const distance_km = route.distance_km;
    const t = terms({ ...c.h, distance_km }, ctx, route.eta_min, traffic.level);
    const w = WEIGHTS[urgency] || WEIGHTS.Stable;
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
      id: c.h.id, name: c.h.name, lat: c.h.lat, lng: c.h.lng,
      score: score(urgency, t),
      distance_km, eta_min: route.eta_min, traffic: 'simulated',
      reasons: reasonsFor(c.h, t, ctx, route.eta_min),
      breakdown: { S: r2(t.S), F: r2(t.F), E: r2(t.E), D: r2(t.D), T: r2(t.T) },
      weights: w,
    };
  }));
  return refined.sort((a, b) => b.score - a.score || a.eta_min - b.eta_min);
}

module.exports = { matchHospitals, WEIGHTS };
