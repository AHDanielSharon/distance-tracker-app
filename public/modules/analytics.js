export class MovementAnalytics {
  constructor() {
    this.historyByUser = new Map();
    this.totalDistanceByUser = new Map();
    this.speedByUser = new Map();
    this.accelerationByUser = new Map();
  }

  static haversine(a, b) {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  ingestUser(user) {
    if (typeof user.lat !== 'number' || typeof user.lng !== 'number') return;
    const now = user.updatedAt || Date.now();
    const point = { lat: user.lat, lng: user.lng, ts: now };

    if (!this.historyByUser.has(user.id)) this.historyByUser.set(user.id, []);
    const hist = this.historyByUser.get(user.id);
    const last = hist[hist.length - 1];

    if (!last || last.lat !== point.lat || last.lng !== point.lng) hist.push(point);

    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    while (hist.length && hist[0].ts < tenMinAgo) hist.shift();

    if (hist.length >= 2) {
      const a = hist[hist.length - 2];
      const b = hist[hist.length - 1];
      const meters = MovementAnalytics.haversine(a, b);
      const dt = Math.max(1, (b.ts - a.ts) / 1000);
      const speed = meters / dt;
      const prevSpeed = this.speedByUser.get(user.id) || 0;
      this.speedByUser.set(user.id, speed);
      this.accelerationByUser.set(user.id, (speed - prevSpeed) / dt);
      this.totalDistanceByUser.set(user.id, (this.totalDistanceByUser.get(user.id) || 0) + meters);
    }
  }

  ingestUsers(users) { users.forEach((u) => this.ingestUser(u)); }
  speedKmh(userId) { return (this.speedByUser.get(userId) || 0) * 3.6; }
  acceleration(userId) { return this.accelerationByUser.get(userId) || 0; }
  totalDistance(userId) { return this.totalDistanceByUser.get(userId) || 0; }

  movementSeries(userId) {
    const hist = this.historyByUser.get(userId) || [];
    const cutoff = Date.now() - 5 * 60 * 1000;
    const recent = hist.filter((p) => p.ts >= cutoff);
    const out = [];
    for (let i = 1; i < recent.length; i += 1) {
      const a = recent[i - 1];
      const b = recent[i];
      const d = MovementAnalytics.haversine(a, b);
      const dt = Math.max(1, (b.ts - a.ts) / 1000);
      out.push({ ts: b.ts, speedKmh: (d / dt) * 3.6 });
    }
    return out;
  }

  groupStats(activeUsers) {
    const ids = activeUsers.map((u) => u.id);
    const totalCombined = ids.reduce((acc, id) => acc + this.totalDistance(id), 0);
    const avgSpeed = ids.length === 0 ? 0 : ids.reduce((acc, id) => acc + this.speedKmh(id), 0) / ids.length;
    return { avgSpeed, totalCombined, activeUsers: ids.length };
  }

  leaderboard(users, distances) {
    const fastest = [...users].map((u) => ({ name: u.name, value: this.speedKmh(u.id) })).sort((a, b) => b.value - a.value)[0];
    const farthest = [...users].map((u) => ({ name: u.name, value: this.totalDistance(u.id) })).sort((a, b) => b.value - a.value)[0];
    const closestPair = [...(distances || [])].sort((a, b) => a.meters - b.meters)[0];
    return { fastest, farthest, closestPair };
  }

  history(userId) { return this.historyByUser.get(userId) || []; }
}
