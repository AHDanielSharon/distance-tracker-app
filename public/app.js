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
  if (meters >= 1000) return `${(meters / 1000).toFixed(3)} km`;
  return `${Math.round(meters)} m`;
};

const formatAccuracy = (meters) => {
  if (typeof meters !== 'number' || Number.isNaN(meters)) return 'N/A';
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

const formatLastSeen = (timestamp) => {
  if (!timestamp) return 'unknown';
  const diff = Math.max(0, Date.now() - timestamp);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
};

const updateStatus = (text, isError = false) => {
  statusLabel.textContent = text;
  statusLabel.style.color = isError ? '#ff7ca5' : '#72ffe4';
};

const ensureMap = () => {
  if (mapReady) return true;
  if (typeof L === 'undefined') {
    updateStatus('Map failed to load. Check internet/CDN access and reload.', true);
    return false;
  }

  map = L.map('map', { zoomControl: false, worldCopyJump: true, minZoom: 2 }).setView([20, 0], 2);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors',
  });

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 20,
      attribution: 'Tiles &copy; Esri',
    },
  );

  street.addTo(map);
  L.control
    .layers(
      {
        'Street View': street,
        'Satellite View': satellite,
      },
      {},
      { collapsed: false, position: 'topright' },
    )
    .addTo(map);

  mapReady = true;
  return true;
};

const upsertMarker = (user) => {
  if (!mapReady || typeof user.lat !== 'number' || typeof user.lng !== 'number') return;

  if (!markers.has(user.id)) {
    markers.set(user.id, L.marker([user.lat, user.lng]).addTo(map));
  }

  const marker = markers.get(user.id);
  marker.setLatLng([user.lat, user.lng]);
  const state = user.active ? 'online' : `last seen ${formatLastSeen(user.lastSeenAt)}`;
  marker.bindPopup(`${user.name}${user.id === userId ? ' (You)' : ''} • ${state}`);
};

const removeMissingMarkers = (users) => {
  if (!mapReady) return;
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
  const bounds = L.latLngBounds(withCoords.map((u) => [u.lat, u.lng]));
  map.fitBounds(bounds.pad(0.2));
};

const syncRouteTargets = (users) => {
  const previousValue = targetUser.value;
  targetUser.innerHTML = '';

  const options = users.filter((u) => u.id !== userId && typeof u.lat === 'number' && typeof u.lng === 'number');
  if (options.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No reachable users yet';
    targetUser.appendChild(opt);
    return;
  }

  for (const user of options) {
    const opt = document.createElement('option');
    opt.value = user.id;
    opt.textContent = `${user.name}${user.active ? '' : ` (last seen ${formatLastSeen(user.lastSeenAt)})`}`;
    targetUser.appendChild(opt);
  }

  const keep = options.some((u) => u.id === previousValue);
  targetUser.value = keep ? previousValue : options[0].id;
};

const renderRoom = ({ users, distances }) => {
  usersSnapshot = users;
  peopleList.innerHTML = '';
  distanceList.innerHTML = '';

  users.forEach((user) => {
    const item = document.createElement('li');
    const hasLocation = typeof user.lat === 'number' && typeof user.lng === 'number';
    const accuracyText = hasLocation ? ` (${formatAccuracy(user.accuracy)})` : '';
    const mode = user.active ? '🟢 online' : `🟠 last seen ${formatLastSeen(user.lastSeenAt)}`;

    item.textContent = `${user.name}${user.id === userId ? ' (You)' : ''} — ${mode} — ${
      hasLocation ? `${user.lat.toFixed(6)}, ${user.lng.toFixed(6)}${accuracyText}` : 'waiting for GPS...'
    }`;
    peopleList.appendChild(item);
    upsertMarker(user);
  });

  removeMissingMarkers(users);
  syncRouteTargets(users);

  if (distances.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Need at least two active coordinates to compute distance.';
    distanceList.appendChild(li);
  } else {
    distances
      .sort((a, b) => a.meters - b.meters)
      .forEach((distance) => {
        const li = document.createElement('li');
        const uncertainty =
          typeof distance.errorMeters === 'number' ? ` (uncertainty ${formatAccuracy(distance.errorMeters)})` : '';
        li.textContent = `${distance.names[0]} ↔ ${distance.names[1]}: ${formatDistance(distance.meters)}${uncertainty}`;
        distanceList.appendChild(li);
      });
  }
};

const apiPost = async (path, payload) => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'API error');
  return body;
};

const beginLocationTracking = () => {
  if (!navigator.geolocation) {
    updateStatus('Geolocation is not supported in this browser.', true);
    return;
  }

  myWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      try {
        await apiPost('/api/location', {
          roomId,
          userId,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
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
  events.onmessage = () => {
    // onmessage overwritten below with parser
  };
  events.onmessage = (event) => {
    renderRoom(JSON.parse(event.data));
    if (targetUser.value) drawRoute(true);
  };
  events.onerror = () => updateStatus('Live stream disconnected. Trying to reconnect...', true);
};

const drawRoute = async (quiet = false) => {
  const targetId = targetUser.value;
  if (!targetId) return;

  const me = usersSnapshot.find((u) => u.id === userId);
  const other = usersSnapshot.find((u) => u.id === targetId);

  if (!me || !other || typeof me.lat !== 'number' || typeof other.lat !== 'number') {
    routeInfo.textContent = 'Need both locations available to route.';
    return;
  }

  const mode = travelMode.value;
  const url = `https://router.project-osrm.org/route/v1/${mode}/${me.lng},${me.lat};${other.lng},${other.lat}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);
    const body = await response.json();
    const route = body?.routes?.[0];
    if (!route) throw new Error('No route found');

    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.geoJSON(route.geometry, {
      style: { color: '#38f3ff', weight: 5, opacity: 0.9 },
    }).addTo(map);

    const text = `${mode.toUpperCase()} • Distance: ${formatDistance(route.distance)} • ETA: ${formatDuration(route.duration)}`;
    routeInfo.textContent = text;
    if (!quiet) {
      map.fitBounds(routeLayer.getBounds().pad(0.15));
    }
  } catch (error) {
    routeInfo.textContent = `Route service unavailable: ${error.message}`;
  }
};

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('name-input').value.trim();
  roomId = document.getElementById('room-input').value.trim();

  if (!name || !roomId) {
    updateStatus('Name and room ID are required.', true);
    return;
  }

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
routeBtn.addEventListener('click', () => {
  if (mapReady) drawRoute();
});
travelMode.addEventListener('change', () => {
  if (mapReady && targetUser.value) drawRoute(true);
});

window.addEventListener('beforeunload', () => {
  if (roomId && userId && navigator.sendBeacon) {
    navigator.sendBeacon('/api/leave', JSON.stringify({ roomId, userId }));
  }
});

updateStatus('Ready. Enter a room ID and click Enter Room.');
