function toRad(d) { return (d * Math.PI) / 180; }

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Offset a point by km north / east.
function offset(lat, lng, northKm, eastKm) {
  return {
    lat: lat + northKm / 111,
    lng: lng + eastKm / (111 * Math.cos(toRad(lat))),
  };
}

module.exports = { haversine, offset };
