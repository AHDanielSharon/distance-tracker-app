const joinForm = document.getElementById('join-form');
const statusLabel = document.getElementById('status');
const trackerSection = document.getElementById('tracker-section');
const roomTitle = document.getElementById('room-title');
const peopleList = document.getElementById('people-list');
const distanceList = document.getElementById('distance-list');
const recenterBtn = document.getElementById('recenter-btn');
const vehicleMode = document.getElementById('vehicle-mode');
const routeBtn = document.getElementById('route-btn');
const startNavBtn = document.getElementById('start-nav-btn');
const routeInfo = document.getElementById('route-info');
const navSteps = document.getElementById('nav-steps');
const targetUsers = document.getElementById('target-users');

let roomId = '';
let userId = '';
let map;
let myWatchId;
let events;
let mapReady = false;
let routeLayer = null;
let usersSnapshot = [];
let lastRouteData = null;
const markers = new Map();
const deviceIdKey = 'distance-tracker-device-id';

const PROFILE_MAP = {
  driving: { profile: 'driving', factor: 1, label: 'Car' },
  motorcycle: { profile: 'driving', factor: 0.9, label: 'Motorcycle' },
  truck: { profile: 'driving', factor: 1.25, label: 'Truck' },
  bus: { profile: 'driving', factor: 1.15, label: 'Bus' },
  cycling: { profile: 'cycling', factor: 1, label: 'Bicycle' },
  scooter: { profile: 'cycling', factor: 0.8, label: 'Scooter' },
  walking: { profile: 'walking', factor: 1, label: 'Walking' },
};

const getDeviceId = () => {
  let id = localStorage.getItem(deviceIdKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(deviceIdKey, id);
  }
  return id;
};

const formatDistance = (meters) => (meters >= 1000 ? `${(meters / 1000).toFixed(3)} km` : `${Math.round(meters)} m`);
const formatAccuracy = (meters) => (typeof meters === 'number' ? (meters >= 1000 ? `±${(meters / 1000).toFixed(2)} km` : `±${Math.round(meters)} m`) : 'N/A');
const formatDuration = (seconds) => {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
};
const formatLastSeen = (timestamp) => {
  if (!timestamp) return 'unknown';
  const sec = Math.floor(Math.max(0, Date.now() - timestamp) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
};

const updateStatus = (text, isError = false) => {
  statusLabel.textContent = text;
  statusLabel.style.color = isError ? '#ff7ca5' : '#72ffe4';
};

const chooseVehicle = (meters) => {
  if (meters < 700) return 'walking';
  if (meters < 4000) return 'scooter';
  if (meters < 12000) return 'motorcycle';
  return 'driving';
};

const ensureMap = () => {
  if (mapReady) return true;
  if (typeof L === 'undefined') {
    updateStatus('Map library failed to load. Check internet and reload.', true);
    return false;
  }

  map = L.map('map', { zoomControl: false, worldCopyJump: true, minZoom: 2 }).setView([20, 0], 2);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap contributors' });
  const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap &copy; CARTO' });
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, attribution: 'Tiles &copy; Esri' });

  street.on('tileerror', () => updateStatus('Primary map tiles unavailable. Use alternate layer from top-right.', true));
  satellite.on('tileerror', () => updateStatus('Satellite tiles temporarily unavailable. Try street/CARTO layer.', true));

  street.addTo(map);
  L.control.layers({ 'Street View': street, 'Clear City Map': carto, 'Satellite View': satellite }, {}, { collapsed: false, position: 'topright' }).addTo(map);

  mapReady = true;
  return true;
};

const upsertMarker = (user) => {
  if (!mapReady || typeof user.lat !== 'number' || typeof user.lng !== 'number') return;
  if (!markers.has(user.id)) markers.set(user.id, L.marker([user.lat, user.lng]).addTo(map));
  const marker = markers.get(user.id);
  marker.setLatLng([user.lat, user.lng]);
  marker.bindPopup(`${user.name}${user.id === userId ? ' (You)' : ''} • ${user.active ? 'online' : `last seen ${formatLastSeen(user.lastSeenAt)}`}`);
};

const removeMissingMarkers = (users) => {
  const ids = new Set(users.map((u) => u.id));
  for (const [id, marker] of markers.entries()) {
    if (!ids.has(id)) {
      map.removeLayer(marker);
      markers.delete(id);
    }
  }
};

const fitAllUsers = (users) => {
  if (!mapReady) return;
  const withCoords = users.filter((u) => typeof u.lat === 'number' && typeof u.lng === 'number');
  if (withCoords.length === 0) return;
  map.fitBounds(L.latLngBounds(withCoords.map((u) => [u.lat, u.lng])).pad(0.2));
};

const renderTargetUsers = (users) => {
  const selected = new Set([...targetUsers.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value));
  targetUsers.innerHTML = '';
  const candidates = users.filter((u) => u.id !== userId && typeof u.lat === 'number' && typeof u.lng === 'number');
  if (candidates.length === 0) {
    targetUsers.textContent = 'No route targets available yet.';
    return;
  }

  candidates.forEach((user) => {
    const label = document.createElement('label');
    label.className = 'target-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = user.id;
    if (selected.has(user.id)) input.checked = true;
    label.append(input, document.createTextNode(` ${user.name}${user.active ? '' : ` (last seen ${formatLastSeen(user.lastSeenAt)})`}`));
    targetUsers.appendChild(label);
  });
};

const renderRoom = ({ users, distances }) => {
  usersSnapshot = users;
  peopleList.innerHTML = '';
  distanceList.innerHTML = '';

  users.forEach((user) => {
    const li = document.createElement('li');
    const has = typeof user.lat === 'number' && typeof user.lng === 'number';
    li.textContent = `${user.name}${user.id === userId ? ' (You)' : ''} — ${user.active ? '🟢 online' : `🟠 last seen ${formatLastSeen(user.lastSeenAt)}`} — ${has ? `${user.lat.toFixed(6)}, ${user.lng.toFixed(6)} (${formatAccuracy(user.accuracy)})` : 'waiting for GPS...'}`;
    peopleList.appendChild(li);
    upsertMarker(user);
  });

  removeMissingMarkers(users);
  renderTargetUsers(users);

  if (distances.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Need at least two coordinates to compute distance.';
    distanceList.appendChild(li);
  } else {
    distances.sort((a, b) => a.meters - b.meters).forEach((d) => {
      const li = document.createElement('li');
      li.textContent = `${d.names[0]} ↔ ${d.names[1]}: ${formatDistance(d.meters)} (uncertainty ${formatAccuracy(d.errorMeters)})`;
      distanceList.appendChild(li);
    });
  }

  if (lastRouteData) drawRoute(true);
};

const apiPost = async (path, payload) => {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'API error');
  return body;
};

const beginLocationTracking = () => {
  if (!navigator.geolocation) return updateStatus('Geolocation not supported.', true);
  myWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      try {
        await apiPost('/api/location', { roomId, userId, lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
        updateStatus(`Streaming live location (${formatAccuracy(position.coords.accuracy)}).`);
      } catch (error) {
        updateStatus(`Failed to push location: ${error.message}`, true);
      }
    },
    (error) => updateStatus(`Location error: ${error.message}`, true),
    { enableHighAccuracy: true, maximumAge: 500, timeout: 10000 },
  );
};

const subscribeRoomStream = () => {
  if (events) events.close();
  events = new EventSource(`/api/events?roomId=${encodeURIComponent(roomId)}`);
  events.onmessage = (event) => renderRoom(JSON.parse(event.data));
  events.onerror = () => updateStatus('Live stream disconnected. Trying to reconnect...', true);
};

const selectedTargetIds = () => [...targetUsers.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);

const drawRoute = async (quiet = false) => {
  const me = usersSnapshot.find((u) => u.id === userId);
  const targets = selectedTargetIds().map((id) => usersSnapshot.find((u) => u.id === id)).filter(Boolean);
  if (!me || typeof me.lat !== 'number' || targets.length === 0) {
    routeInfo.textContent = 'Select one or more people with location for routing.';
    return;
  }

  const coords = [[me.lng, me.lat], ...targets.map((u) => [u.lng, u.lat])];
  const straightMeters = targets.reduce((acc, u) => acc + Math.hypot((u.lat - me.lat) * 111000, (u.lng - me.lng) * 111000), 0) / Math.max(1, targets.length);
  const chosenMode = vehicleMode.value === 'auto' ? chooseVehicle(straightMeters) : vehicleMode.value;
  const cfg = PROFILE_MAP[chosenMode] || PROFILE_MAP.driving;

  const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/${cfg.profile}/${coordStr}?overview=full&geometries=geojson&steps=true`;

  try {
    const response = await fetch(url);
    const body = await response.json();
    const route = body?.routes?.[0];
    if (!route) throw new Error('No route found');

    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.geoJSON(route.geometry, { style: { color: '#38f3ff', weight: 5, opacity: 0.9 } }).addTo(map);

    const adjustedDuration = route.duration * cfg.factor;
    routeInfo.textContent = `${cfg.label}${vehicleMode.value === 'auto' ? ' (auto-picked)' : ''} • Distance: ${formatDistance(route.distance)} • ETA: ${formatDuration(adjustedDuration)} • Stops: ${targets.length}`;

    lastRouteData = { chosenMode, targetIds: targets.map((t) => t.id) };

    const steps = route.legs.flatMap((leg) => leg.steps || []).slice(0, 12);
    navSteps.innerHTML = '';
    steps.forEach((step, i) => {
      const li = document.createElement('li');
      li.textContent = `${i + 1}. ${step.maneuver.instruction} (${formatDistance(step.distance)})`;
      navSteps.appendChild(li);
    });

    if (!quiet) map.fitBounds(routeLayer.getBounds().pad(0.15));
  } catch (error) {
    routeInfo.textContent = `Route service unavailable: ${error.message}`;
  }
};

const startNavigation = () => {
  if (!lastRouteData) {
    routeInfo.textContent = 'Build a route first, then start navigation.';
    return;
  }
  routeInfo.textContent = `${routeInfo.textContent} • Navigation started`; 
  navSteps.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('name-input').value.trim();
  roomId = document.getElementById('room-input').value.trim();
  if (!name || !roomId) return updateStatus('Name and room ID are required.', true);

  try {
    const joined = await apiPost('/api/join', { roomId, name, deviceId: getDeviceId() });
    roomId = joined.roomId;
    userId = joined.userId;
    trackerSection.classList.remove('hidden');
    roomTitle.textContent = `Room: ${roomId}`;

    if (!ensureMap()) return;
    setTimeout(() => map.invalidateSize(), 50);

    if (typeof myWatchId === 'number') navigator.geolocation.clearWatch(myWatchId);
    subscribeRoomStream();
    beginLocationTracking();
    updateStatus(`Joined room ${roomId} as ${joined.name}`);
  } catch (error) {
    updateStatus(error.message, true);
  }
});

recenterBtn.addEventListener('click', () => fitAllUsers(usersSnapshot));
routeBtn.addEventListener('click', () => mapReady && drawRoute());
vehicleMode.addEventListener('change', () => mapReady && selectedTargetIds().length > 0 && drawRoute(true));
startNavBtn.addEventListener('click', startNavigation);

window.addEventListener('beforeunload', () => {
  if (roomId && userId && navigator.sendBeacon) navigator.sendBeacon('/api/leave', JSON.stringify({ roomId, userId }));
});

updateStatus('Ready. Enter a room ID and click Enter Room.');
