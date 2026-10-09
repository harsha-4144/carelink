// Leaflet map for the route step. Falls back to a text message if Leaflet did not load.
const CareMap = (() => {
  let map = null;

  function show(elementId, patient, hospital, geometry) {
    if (typeof L === 'undefined') return false;
    if (map) { map.remove(); map = null; }
    map = L.map(elementId);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    L.marker([patient.lat, patient.lng]).addTo(map).bindPopup('Patient');
    L.marker([hospital.lat, hospital.lng]).addTo(map).bindPopup(hospital.name);
    const line = L.polyline(geometry, { color: '#c62828', weight: 5 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [30, 30] });
    setTimeout(() => map && map.invalidateSize(), 100);
    return true;
  }

  return { show };
})();
