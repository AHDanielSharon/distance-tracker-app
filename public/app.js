const joinForm = document.getElementById('join-form');
const statusLabel = document.getElementById('status');
const trackerSection = document.getElementById('tracker-section');
const roomTitle = document.getElementById('room-title');
const peopleList = document.getElementById('people-list');
const distanceList = document.getElementById('distance-list');

let roomId = '';
let userId = '';
let map;
let myWatchId;
let events;
let mapReady = false;
const markers = new Map();

const formatDistance = (meters) => {
  if (meters >= 1000) return `${(meters / 1000).toFixed(3)} km`;
  return `${Math.round(meters)} m`;
};

const formatAccuracy = (meters) => {
  if (typeof meters !== 'number' || Number.isNaN(meters)) return 'N/A';
  if (meters >= 1000) return `±${(meters / 1000).toFixed(2)} km`;
  return `±${Math.round(meters)} m`;
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

  map = L.map('map', { zoomControl: false }).setView([20, 0], 2);
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
  marker.bindPopup(`${user.name}${user.id === userId ? ' (You)' : ''}`);
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

const renderRoom = ({ users, distances }) => {
  peopleList.innerHTML = '';
  distanceList.innerHTML = '';

  users.forEach((user) => {
    const item = document.createElement('li');
    const hasLocation = typeof user.lat === 'number' && typeof user.lng === 'number';
    const accuracyText = hasLocation ? ` (${formatAccuracy(user.accuracy)})` : '';
    item.textContent = `${user.name}${user.id === userId ? ' (You)' : ''} — ${
      hasLocation ? `${user.lat.toFixed(6)}, ${user.lng.toFixed(6)}${accuracyText}` : 'waiting for GPS...'
    }`;
    peopleList.appendChild(item);
    upsertMarker(user);
  });

  removeMissingMarkers(users);

  if (distances.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Need at least two active locations to compute distance.';
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

  if (!mapReady) return;
  const usersWithCoords = users.filter((u) => typeof u.lat === 'number' && typeof u.lng === 'number');
  if (usersWithCoords.length > 0) {
    const bounds = L.latLngBounds(usersWithCoords.map((u) => [u.lat, u.lng]));
    map.fitBounds(bounds.pad(0.25), { animate: true, duration: 0.6 });
  }
};

const apiPost = async (path, payload) => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || 'API error');
  }

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

  events.onmessage = (event) => {
    renderRoom(JSON.parse(event.data));
  };

  events.onerror = () => {
    updateStatus('Live stream disconnected. Trying to reconnect...', true);
  };
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
    const joined = await apiPost('/api/join', { roomId, name });
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

window.addEventListener('beforeunload', () => {
  if (roomId && userId && navigator.sendBeacon) {
    navigator.sendBeacon('/api/leave', JSON.stringify({ roomId, userId }));
  }
});

updateStatus('Ready. Enter a room ID and click Enter Room.');
