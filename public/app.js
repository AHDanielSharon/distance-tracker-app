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
const stopNavBtn = document.getElementById('stop-nav-btn');
const routeInfo = document.getElementById('route-info');
const navSteps = document.getElementById('nav-steps');
const targetUsers = document.getElementById('target-users');
const installBtn = document.getElementById('install-btn');
const shareLinkBox = document.getElementById('share-link-box');
const shareLinkInput = document.getElementById('share-link');
const copyLinkBtn = document.getElementById('copy-link-btn');
const whatsappShareBtn = document.getElementById('whatsapp-share-btn');
const nameInput = document.getElementById('name-input');
const roomInput = document.getElementById('room-input');
const selectAllBtn = document.getElementById('select-all-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const targetCount = document.getElementById('target-count');

let roomId = '';
let userId = '';
let inviteToken = '';
let map;
let myWatchId;
let events;
let mapReady = false;
let routeLayer = null;
let usersSnapshot = [];
let latestRoute = null;
let navigating = false;
let activeStepIndex = 0;
let lastVoiceText = '';
let deferredInstallPrompt = null;
let autoJoinAttempted = false;

const markers = new Map();
const deviceIdKey = 'distance-tracker-device-id';
const preferredNameKey = 'distance-tracker-preferred-name';
const sessionKey = 'distance-tracker-last-session';

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

const updateStatus = (text, isError = false) => {
  statusLabel.textContent = text;
  statusLabel.style.color = isError ? '#ff7ca5' : '#72ffe4';
};

const formatLastSeen = (timestamp) => {
  if (!timestamp) return 'unknown';
  const sec = Math.floor(Math.max(0, Date.now() - timestamp) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
};

const urlParams = new URLSearchParams(window.location.search);
let linkedRoomId = urlParams.get('room') || '';
let linkedToken = urlParams.get('token') || '';

// Handle malformed shared links where full URL is embedded inside room param.
if (linkedRoomId && /^https?:\/\//i.test(linkedRoomId)) {
  try {
    const nested = new URL(linkedRoomId);
    linkedRoomId = nested.searchParams.get('room') || linkedRoomId;
    linkedToken = linkedToken || nested.searchParams.get('token') || '';
  } catch {
    // keep original value
  }
}

if (linkedRoomId) {
  roomInput.value = linkedRoomId;
  roomInput.readOnly = true;
  roomInput.title = 'Room locked by invite link';
}
if (linkedToken) inviteToken = linkedToken;

const storedName = localStorage.getItem(preferredNameKey) || '';
if (storedName) {
  nameInput.value = storedName;
}

let rememberedSession = null;
try {
  rememberedSession = JSON.parse(localStorage.getItem(sessionKey) || 'null');
} catch {
  rememberedSession = null;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    } catch {
      updateStatus('Offline install support unavailable in this browser.', true);
    }
  });
}

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  window.location.reload();
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installBtn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  installBtn.classList.add('hidden');
  updateStatus('App installed successfully.');
});

const chooseVehicle = (meters) => {
  if (meters < 700) return 'walking';
  if (meters < 3500) return 'scooter';
  if (meters < 15000) return 'motorcycle';
  return 'driving';
};

const instructionFromStep = (step) => {
  const man = step.maneuver || {};
  const modifier = man.modifier ? man.modifier.replace('_', ' ') : '';
  const road = step.name ? ` onto ${step.name}` : '';

  if (step.instruction) {
    return `${step.instruction}, continue for ${formatDistance(step.distance)}`;
  }

  switch (man.type) {
    case 'depart':
      return `Start and go ${modifier || 'ahead'}${road}. Continue for ${formatDistance(step.distance)}`;
    case 'arrive':
      return `You have arrived at your stop.`;
    case 'turn':
      return `Turn ${modifier || 'ahead'}${road}. Continue for ${formatDistance(step.distance)}`;
    case 'new name':
      return `Continue${road}. Keep going for ${formatDistance(step.distance)}`;
    case 'roundabout':
      return `Enter roundabout${road}. Continue for ${formatDistance(step.distance)}`;
    case 'merge':
      return `Merge ${modifier || ''}${road}. Continue for ${formatDistance(step.distance)}`;
    default:
      return `Go ${modifier || 'ahead'}${road}. Continue for ${formatDistance(step.distance)}`;
  }
};

const speak = (text) => {
  if (!('speechSynthesis' in window) || !text) return;
  if (text === lastVoiceText) return;
  lastVoiceText = text;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  window.speechSynthesis.speak(utter);
};

const haversine = (a, b) => {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const findClosestStepIndex = (lat, lng) => {
  if (!latestRoute?.steps?.length) return 0;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;

  latestRoute.steps.forEach((step, i) => {
    const loc = step.maneuver?.location;
    if (!Array.isArray(loc) || loc.length < 2) return;
    const d = haversine({ lat, lng }, { lat: loc[1], lng: loc[0] });
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });

  return best;
};

const updateNavigationFromPosition = (lat, lng) => {
  if (!navigating || !latestRoute?.steps?.length) return;
  activeStepIndex = findClosestStepIndex(lat, lng);
  const step = latestRoute.steps[activeStepIndex];
  const instruction = instructionFromStep(step);
  routeInfo.textContent = `Navigation • Step ${activeStepIndex + 1}/${latestRoute.steps.length}: ${instruction}`;
  speak(instruction);
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

  street.on('tileerror', () => updateStatus('Primary map tiles unavailable. Use top-right layer control.', true));
  satellite.on('tileerror', () => updateStatus('Satellite tiles unavailable now. Switch to street/clear map.', true));

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
  const prevSelected = new Set(selectedTargetIds());
  targetUsers.innerHTML = '';
  const candidates = users.filter((u) => u.id !== userId && typeof u.lat === 'number' && typeof u.lng === 'number');

  if (candidates.length === 0) {
    targetUsers.textContent = 'No route targets available yet.';
    updateTargetCount();
    return;
  }

  const shouldAutoSelectAll = prevSelected.size === 0;

  candidates.forEach((user) => {
    const label = document.createElement('label');
    label.className = 'target-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = user.id;
    input.checked = shouldAutoSelectAll || prevSelected.has(user.id);
    input.addEventListener('change', updateTargetCount);
    label.append(input, document.createTextNode(` ${user.name}${user.active ? '' : ` (last seen ${formatLastSeen(user.lastSeenAt)})`}`));
    targetUsers.appendChild(label);
  });

  updateTargetCount();
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
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      try {
        await apiPost('/api/location', { roomId, userId, lat, lng, accuracy: position.coords.accuracy });
        updateStatus(`Streaming live location (${formatAccuracy(position.coords.accuracy)}).`);
      } catch (error) {
        updateStatus(`Failed to push location: ${error.message}`, true);
      }

      updateNavigationFromPosition(lat, lng);
    },
    (error) => updateStatus(`Location error: ${error.message}`, true),
    { enableHighAccuracy: true, maximumAge: 500, timeout: 10000 },
  );
};


const fetchSnapshot = async () => {
  if (!roomId || !inviteToken) return;
  try {
    const response = await fetch(`/api/room?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(inviteToken)}`);
    if (!response.ok) return;
    const snapshot = await response.json();
    renderRoom(snapshot);
  } catch {
    // ignore transient fetch errors
  }
};

const subscribeRoomStream = () => {
  if (!inviteToken) {
    updateStatus('Missing room token. Open a valid invite link.', true);
    return;
  }

  if (events) events.close();
  events = new EventSource(`/api/events?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(inviteToken)}`);
  events.onmessage = (event) => {
    renderRoom(JSON.parse(event.data));
  };
  events.onerror = () => {
    updateStatus('Live stream disconnected. Trying to reconnect...', true);
    fetchSnapshot();
  };

  fetchSnapshot();
};


const selectedTargetIds = () => [...targetUsers.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);

const updateTargetCount = () => {
  const checked = selectedTargetIds().length;
  targetCount.textContent = `${checked} selected`;
};

const setAllTargetCheckboxes = (checked) => {
  [...targetUsers.querySelectorAll('input[type="checkbox"]')].forEach((el) => {
    el.checked = checked;
  });
  updateTargetCount();
};

const routeUrlForTargets = (cfg, coords) => {
  if (coords.length <= 2) {
    return `https://router.project-osrm.org/route/v1/${cfg.profile}/${coords.map((c) => `${c[0]},${c[1]}`).join(';')}?overview=full&geometries=geojson&steps=true`;
  }

  return `https://router.project-osrm.org/trip/v1/${cfg.profile}/${coords.map((c) => `${c[0]},${c[1]}`).join(';')}?overview=full&geometries=geojson&steps=true&source=first&roundtrip=false`;
};

const drawRoute = async (quiet = false) => {
  const me = usersSnapshot.find((u) => u.id === userId);
  const targets = selectedTargetIds().map((id) => usersSnapshot.find((u) => u.id === id)).filter(Boolean);

  if (!me || typeof me.lat !== 'number') {
    routeInfo.textContent = 'Your live location is not available yet. Please enable GPS.';
    return;
  }

  if (targets.length === 0) {
    routeInfo.textContent = 'Select at least one person from the list above to build route.';
    return;
  }

  const coords = [[me.lng, me.lat], ...targets.map((u) => [u.lng, u.lat])];

  const averageMeters =
    targets.reduce((acc, u) => acc + haversine({ lat: me.lat, lng: me.lng }, { lat: u.lat, lng: u.lng }), 0) /
    Math.max(1, targets.length);

  const selectedMode = vehicleMode.value === 'auto' ? chooseVehicle(averageMeters) : vehicleMode.value;
  const cfg = PROFILE_MAP[selectedMode] || PROFILE_MAP.driving;

  try {
    const response = await fetch(routeUrlForTargets(cfg, coords));
    const body = await response.json();
    const route = body?.routes?.[0] || body?.trips?.[0];
    if (!route) throw new Error('No route found');

    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.geoJSON(route.geometry, { style: { color: '#38f3ff', weight: 5, opacity: 0.9 } }).addTo(map);

    const adjustedDuration = route.duration * cfg.factor;
    routeInfo.textContent = `${cfg.label}${vehicleMode.value === 'auto' ? ' (auto-picked)' : ''} • Distance: ${formatDistance(route.distance)} • ETA: ${formatDuration(adjustedDuration)} • Stops: ${targets.length}`;

    const legs = route.legs || [];
    const steps = legs.flatMap((leg) => leg.steps || []).slice(0, 20);
    latestRoute = { steps };
    activeStepIndex = 0;

    navSteps.innerHTML = '';
    steps.forEach((step, i) => {
      const li = document.createElement('li');
      li.textContent = `${i + 1}. ${instructionFromStep(step)}`;
      navSteps.appendChild(li);
    });

    if (!quiet) map.fitBounds(routeLayer.getBounds().pad(0.15));
  } catch (error) {
    routeInfo.textContent = `Route service unavailable: ${error.message}`;
  }
};

const startNavigation = () => {
  if (!latestRoute?.steps?.length) {
    routeInfo.textContent = 'Build a route first, then start navigation.';
    return;
  }

  navigating = true;
  activeStepIndex = 0;
  const firstText = instructionFromStep(latestRoute.steps[0]);
  routeInfo.textContent = `Navigation started • ${firstText}`;
  speak(`Navigation started. ${firstText}`);
};

const stopNavigation = () => {
  navigating = false;
  activeStepIndex = 0;
  window.speechSynthesis?.cancel?.();
  routeInfo.textContent = 'Navigation stopped.';
};

const joinCurrentRoom = async () => {
  const name = nameInput.value.trim();
  roomId = roomInput.value.trim();

  if (!name || !roomId) {
    updateStatus('Name and room ID are required.', true);
    return;
  }

  localStorage.setItem(preferredNameKey, name);

  const joined = await apiPost('/api/join', { roomId, name, deviceId: getDeviceId(), inviteToken });
  roomId = joined.roomId;
  userId = joined.userId;
  inviteToken = joined.inviteToken || inviteToken;

  localStorage.setItem(sessionKey, JSON.stringify({ roomId, inviteToken }));

  if (joined.inviteLink) {
    shareLinkInput.value = joined.inviteLink;
    shareLinkBox.classList.remove('hidden');
    window.history.replaceState({}, '', `/?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(inviteToken)}`);
  }

  trackerSection.classList.remove('hidden');
  roomTitle.textContent = `Room: ${roomId}`;

  if (!ensureMap()) return;
  setTimeout(() => map.invalidateSize(), 50);

  if (typeof myWatchId === 'number') navigator.geolocation.clearWatch(myWatchId);
  subscribeRoomStream();
  beginLocationTracking();
  updateStatus(`Joined room ${roomId} as ${joined.name}`);
};

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await joinCurrentRoom();
  } catch (error) {
    updateStatus(error.message, true);
  }
});

recenterBtn.addEventListener('click', () => fitAllUsers(usersSnapshot));
routeBtn.addEventListener('click', () => mapReady && drawRoute());
vehicleMode.addEventListener('change', () => mapReady && selectedTargetIds().length > 0 && drawRoute(true));
startNavBtn.addEventListener('click', startNavigation);
stopNavBtn.addEventListener('click', stopNavigation);

copyLinkBtn.addEventListener('click', async () => {
  if (!shareLinkInput.value) return;
  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    updateStatus('Invite link copied. Share it privately.');
  } catch {
    updateStatus('Could not copy automatically. Please copy the link manually.', true);
  }
});

whatsappShareBtn.addEventListener('click', () => {
  if (!shareLinkInput.value) return;
  const message = encodeURIComponent(`Join my private Distance Tracker room: ${shareLinkInput.value}`);
  window.open(`https://wa.me/?text=${message}`, '_blank');
});

selectAllBtn.addEventListener('click', () => setAllTargetCheckboxes(true));
clearAllBtn.addEventListener('click', () => setAllTargetCheckboxes(false));

installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) {
    updateStatus('Install prompt is not available on this device/browser.', true);
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.classList.add('hidden');
  if (choice.outcome !== 'accepted') {
    updateStatus('Install cancelled by user.', true);
  }
});

window.addEventListener('beforeunload', () => {
  // Keep room session on refresh/reopen so users do not drop to blank state.
  window.speechSynthesis?.cancel?.();
});

window.addEventListener('load', async () => {
  if (autoJoinAttempted) return;

  if (linkedRoomId && linkedToken) {
    autoJoinAttempted = true;
    if (!nameInput.value.trim()) {
      nameInput.value = `Guest-${crypto.randomUUID().slice(0, 6)}`;
    }
    try {
      await joinCurrentRoom();
      updateStatus('Joined directly from private invite link.');
    } catch (error) {
      updateStatus(`Invite link join failed: ${error.message}. You can still join manually.`, true);
      inviteToken = '';
      roomInput.readOnly = false;
      roomInput.title = '';
      shareLinkBox.classList.add('hidden');
    }
    return;
  }

  if (rememberedSession?.roomId && rememberedSession?.inviteToken) {
    autoJoinAttempted = true;
    roomInput.value = rememberedSession.roomId;
    inviteToken = rememberedSession.inviteToken;
    if (!nameInput.value.trim()) {
      nameInput.value = `Guest-${crypto.randomUUID().slice(0, 6)}`;
    }
    try {
      await joinCurrentRoom();
      updateStatus('Restored your last room session.');
    } catch (error) {
      localStorage.removeItem(sessionKey);
      inviteToken = '';
      roomInput.readOnly = false;
      roomInput.title = '';
      updateStatus(`Could not restore last room: ${error.message}. Join manually.`, true);
    }
  }
});

updateStatus('Ready. Enter a room ID and click Enter Room.');
