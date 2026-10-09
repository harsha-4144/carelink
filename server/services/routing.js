const { haversine } = require('./geo');

// Simulated traffic: multiplier by local hour. There is no free live-traffic API.
function trafficFor(date = new Date()) {
  const h = date.getHours();
  if ((h >= 8 && h <= 10) || (h >= 17 && h <= 20)) return { multiplier: 1.4, level: 'high' };
  if (h === 7 || (h >= 11 && h <= 16) || h === 21) return { multiplier: 1.2, level: 'moderate' };
  return { multiplier: 1.05, level: 'low' };
}

const round1 = (n) => Math.round(n * 10) / 10;

function estimate(from, to, now) {
  const t = trafficFor(now);
  const distance = haversine(from.lat, from.lng, to.lat, to.lng) * 1.4;
  return {
    eta_min: round1((distance / 30) * 60 * t.multiplier),
    distance_km: round1(distance),
    traffic_level: t.level,
    geometry: [[from.lat, from.lng], [to.lat, to.lng]],
    source: 'estimate',
  };
}

async function osrm(from, to, now) {
  const t = trafficFor(now);
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('OSRM status ' + r.status);
    const data = await r.json();
    const route = data.routes && data.routes[0];
    if (!route) throw new Error('OSRM returned no route');
    return {
      eta_min: round1((route.duration / 60) * t.multiplier),
      distance_km: round1(route.distance / 1000),
      traffic_level: t.level,
      geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      source: 'osrm',
    };
  } finally {
    clearTimeout(timer);
  }
}

// Never throws: any OSRM problem (or MOCK_MODE) yields the straight-line estimate.
async function getRoute(from, to, now = new Date()) {
  if (process.env.MOCK_MODE === 'true') return estimate(from, to, now);
  try {
    return await osrm(from, to, now);
  } catch (e) {
    return estimate(from, to, now);
  }
}

module.exports = { trafficFor, estimate, getRoute };
