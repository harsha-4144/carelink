// Leaflet map for the route step. Falls back to a text message if Leaflet did not load.
const CareMap = (() => {
  let map = null;
  let timer = null;

  function show(elementId, patient, hospital, geometry) {
    if (typeof L === 'undefined') return false;
    if (timer) clearInterval(timer);
    if (map) { map.remove(); map = null; }
    map = L.map(elementId);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    L.marker([patient.lat, patient.lng]).addTo(map).bindPopup('Patient');
    L.marker([hospital.lat, hospital.lng]).addTo(map).bindPopup(hospital.name);
    const line = L.polyline(geometry, { color: '#c62828', weight: 5 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [30, 30] });
    animateAmbulance(geometry);
    setTimeout(() => map && map.invalidateSize(), 100);
    return true;
  }

  // Before a hospital is chosen: the patient and the candidate hospitals.
  function showCandidates(elementId, patient, hospitals) {
    if (typeof L === 'undefined') return false;
    if (timer) clearInterval(timer);
    if (map) { map.remove(); map = null; }
    map = L.map(elementId);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const pts = [[patient.lat, patient.lng]];
    L.marker(pts[0]).addTo(map).bindPopup('Patient');
    hospitals.forEach((h, i) => { L.circleMarker([h.lat, h.lng], { radius: 9, color: '#2563eb', fillColor: '#2563eb', fillOpacity: .85 }).addTo(map).bindTooltip(`${i + 1}. ${h.name}`); pts.push([h.lat, h.lng]); });
    map.fitBounds(pts, { padding: [30, 30] });
    setTimeout(() => map && map.invalidateSize(), 100);
    return true;
  }

  // A small ambulance drives the route on a loop so the ETA feels alive (purely visual).
  function animateAmbulance(geometry) {
    if (!geometry || geometry.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const icon = L.divIcon({ className: '', html: '<div class="ambulance"></div>', iconSize: [26, 26], iconAnchor: [13, 13] });
    const m = L.marker(geometry[0], { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
    const total = 160; // frames per loop
    let f = 0;
    timer = setInterval(() => {
      f = (f + 1) % (total + 1);
      const pos = (f / total) * (geometry.length - 1);
      const i = Math.min(Math.floor(pos), geometry.length - 2);
      const t = pos - i;
      m.setLatLng([geometry[i][0] + (geometry[i + 1][0] - geometry[i][0]) * t, geometry[i][1] + (geometry[i + 1][1] - geometry[i][1]) * t]);
    }, 60);
  }

  return { show, showCandidates };
})();
