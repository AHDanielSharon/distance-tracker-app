const joinForm = document.getElementById('join-form');
const statusLabel = document.getElementById('status');
const trackerSection = document.getElementById('tracker-section');
const roomTitle = document.getElementById('room-title');
const peopleList = document.getElementById('people-list');
const distanceList = document.getElementById('distance-list');
const recenterBtn = document.getElementById('recenter-btn');
const targetUser = document.getElementById('target-user');
const travelMode = document.getElementById('travel-mode');
const routeBtn = document.getElementById('route-btn');
const routeInfo = document.getElementById('route-info');

let roomId = '';
let userId = '';
let map;
let myWatchId;
let events;
let mapReady = false;
let routeLayer = null;
let usersSnapshot = [];
const markers = new Map();
const deviceIdKey = 'distance-tracker-device-id';

const getDeviceId = () => {
  let id = localStorage.getItem(deviceIdKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(deviceIdKey, id);
  }
  return id;
};

const formatDistance = (meters) => {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
};

const formatAccuracy = (meters) => {
  if (!meters) return 'N/A';
  if (meters >= 1000) return `±${(meters / 1000).toFixed(2)} km`;
  return `±${Math.round(meters)} m`;
};

const formatDuration = (seconds) => {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m`;
};

const updateStatus = (text, isError = false) => {
  statusLabel.textContent = text;
  statusLabel.style.color = isError ? '#ff7ca5' : '#72ffe4';
};

const ensureMap = () => {
  if (mapReady) return true;
  if (typeof L === 'undefined') {
    updateStatus('Map failed to load.', true);
    return false;
  }

  map = L.map('map', { zoomControl: false }).setView([20, 0], 2);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const street = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 20 }
  );

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 20 }
  );

  street.addTo(map);
  L.control.layers(
    { Street: street, Satellite: satellite },
    {},
    { collapsed: false }
  ).addTo(map);

  mapReady = true;
  return true;
};

const upsertMarker = (user) => {
  if (!mapReady || typeof user.lat !== 'number') return;

  if (!markers.has(user.id)) {
    markers.set(user.id, L.marker([user.lat, user.lng]).addTo(map));
  }

  const marker = markers.get(user.id);
  marker.setLatLng([user.lat, user.lng]);
  marker.bindPopup(`${user.name}${user.id === userId ? ' (You)' : ''}`);
};

const removeMissingMarkers = (users) => {
  const ids = new Set(users.map(u => u.id));
  for (const [id, marker] of markers.entries()) {
    if (!ids.has(id)) {
      map.removeLayer(marker);
      markers.delete(id);
    }
  }
};

const renderRoom = ({ users, distances }) => {
  usersSnapshot = users;
  peopleList.innerHTML = '';
  distanceList.innerHTML = '';

  users.forEach(user => {
    const li = document.createElement('li');
    const hasLoc = typeof user.lat === 'number';
    li.textContent = hasLoc
      ? `${user.name}${user.id === userId ? ' (You)' : ''} — ${user.lat.toFixed(6)}, ${user.lng.toFixed(6)} (${formatAccuracy(user.accuracy)})`
      : `${user.name} — waiting for GPS...`;

    peopleList.appendChild(li);
    upsertMarker(user);
  });

  removeMissingMarkers(users);

  if (!mapReady) return;

  const valid = users.filter(u => typeof u.lat === 'number');
  if (valid.length > 0) {
    const bounds = L.latLngBounds(valid.map(u => [u.lat, u.lng]));
    map.fitBounds(bounds.pad(0.25));
  }

  if (distances.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Need at least two active locations.';
    distanceList.appendChild(li);
  } else {
    distances.forEach(d => {
      const li = document.createElement('li');
      li.textContent =
        `${d.names[0]} ↔ ${d.names[1]}: ${formatDistance(d.meters)}`;
      distanceList.appendChild(li);
    });
  }
};

const apiPost = async (path, payload) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'API error');
  return body;
};

const beginLocationTracking = () => {
  if (!navigator.geolocation) {
    updateStatus('Geolocation not supported', true);
    return;
  }

  myWatchId = navigator.geolocation.watchPosition(
    async pos => {
      try {
        await apiPost('/api/location', {
          roomId,
          userId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        });
      } catch (e) {
        updateStatus(e.message, true);
      }
    },
    err => updateStatus(err.message, true),
    { enableHighAccuracy: true }
  );
};

const subscribeRoomStream = () => {
  if (events) events.close();
  events = new EventSource(`/api/events?roomId=${roomId}`);
  events.onmessage = e => renderRoom(JSON.parse(e.data));
};

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('name-input').value.trim();
  roomId = document.getElementById('room-input').value.trim();

  if (!name || !roomId) {
    updateStatus('Name and room ID required', true);
    return;
  }

  try {
    const joined = await apiPost('/api/join', {
      roomId,
      name,
      deviceId: getDeviceId()
    });

    roomId = joined.roomId;
    userId = joined.userId;

    trackerSection.classList.remove('hidden');
    roomTitle.textContent = `Room: ${roomId}`;

    ensureMap();
    subscribeRoomStream();
    beginLocationTracking();

    updateStatus(`Joined ${roomId}`);
  } catch (err) {
    updateStatus(err.message, true);
  }
});

window.addEventListener('beforeunload', () => {
  if (roomId && userId && navigator.sendBeacon) {
    navigator.sendBeacon('/api/leave',
      JSON.stringify({ roomId, userId })
    );
  }
});

updateStatus('Ready. Enter a room ID.');