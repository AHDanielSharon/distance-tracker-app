export const predictNextPositions = (history, points = 5, stepMs = 60_000) => {
  if (!history || history.length < 2) return [];
  const a = history[history.length - 2];
  const b = history[history.length - 1];
  const dt = Math.max(1, b.ts - a.ts);
  const vLat = (b.lat - a.lat) / dt;
  const vLng = (b.lng - a.lng) / dt;
  const out = [];
  for (let i = 1; i <= points; i += 1) {
    const t = stepMs * i;
    out.push({ lat: b.lat + vLat * t, lng: b.lng + vLng * t, ts: b.ts + t });
  }
  return out;
};

export const estimateArrivalSeconds = (meters, speedMps) => {
  if (!speedMps || speedMps <= 0.2) return null;
  return meters / speedMps;
};

export const bearingDegrees = (from, to) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const toDeg = (v) => (v * 180) / Math.PI;
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};
