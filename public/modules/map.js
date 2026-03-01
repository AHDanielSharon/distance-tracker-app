export class MapManager {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markers = new Map();
    this.trails = new Map();
    this.predicted = new Map();
    this.heatLayer = null;
    this.heatMode = false;
    this.compassMarker = null;
  }

  init(onTileError) {
    this.map = L.map(this.containerId, { zoomControl: false, worldCopyJump: true, minZoom: 2 }).setView([20, 0], 2);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap contributors' });
    const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap &copy; CARTO' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, attribution: 'Tiles &copy; Esri' });
    street.on('tileerror', onTileError);
    sat.on('tileerror', onTileError);
    street.addTo(this.map);
    L.control.layers({ Street: street, Light: light, Satellite: sat }, {}, { collapsed: false, position: 'topright' }).addTo(this.map);
  }

  upsertUser(user, isMe = false, isSOS = false) {
    if (typeof user.lat !== 'number' || typeof user.lng !== 'number') return;
    if (!this.markers.has(user.id)) {
      const icon = L.divIcon({ className: 'glow-marker', html: '<span></span>', iconSize: [20, 20] });
      this.markers.set(user.id, L.marker([user.lat, user.lng], { icon }).addTo(this.map));
    }
    const m = this.markers.get(user.id);
    m.setLatLng([user.lat, user.lng]);
    m.bindPopup(`${user.name}${isMe ? ' (You)' : ''}${isSOS ? ' 🚨 SOS' : ''}`);
  }

  drawTrail(userId, history) {
    if (!history || history.length < 2) return;
    const points = history.map((p) => [p.lat, p.lng]);
    if (!this.trails.has(userId)) this.trails.set(userId, L.polyline(points, { color: '#6cf', weight: 2, opacity: 0.7 }).addTo(this.map));
    else this.trails.get(userId).setLatLngs(points);
  }

  drawPrediction(userId, points) {
    if (!points || points.length === 0) return;
    const latlngs = points.map((p) => [p.lat, p.lng]);
    if (!this.predicted.has(userId)) this.predicted.set(userId, L.polyline(latlngs, { color: '#ff7ad9', weight: 2, dashArray: '6,6' }).addTo(this.map));
    else this.predicted.get(userId).setLatLngs(latlngs);
  }

  setHeatMode(enabled, users) {
    this.heatMode = enabled;
    if (this.heatLayer) {
      this.map.removeLayer(this.heatLayer);
      this.heatLayer = null;
    }
    if (!enabled) return;
    const circles = users.filter((u) => typeof u.lat === 'number').map((u) => L.circle([u.lat, u.lng], { radius: 120, color: '#ff3ed8', fillColor: '#38f3ff', fillOpacity: 0.22, weight: 1 }));
    this.heatLayer = L.layerGroup(circles).addTo(this.map);
  }

  drawCompass(me, target, bearing) {
    if (!me || !target || typeof me.lat !== 'number' || typeof target.lat !== 'number') return;
    const icon = L.divIcon({ className: 'compass-arrow', html: `<div style="transform:rotate(${bearing}deg)">➤</div>`, iconSize: [34, 34] });
    if (!this.compassMarker) this.compassMarker = L.marker([me.lat, me.lng], { icon }).addTo(this.map);
    this.compassMarker.setLatLng([me.lat, me.lng]);
    this.compassMarker.setIcon(icon);
  }

  fitUsers(users) {
    const pts = users.filter((u) => typeof u.lat === 'number').map((u) => [u.lat, u.lng]);
    if (!pts.length) return;
    this.map.fitBounds(L.latLngBounds(pts).pad(0.2));
  }
}
