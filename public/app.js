import { MapManager } from './modules/map.js';
import { MovementAnalytics } from './modules/analytics.js';
import { predictNextPositions, estimateArrivalSeconds, bearingDegrees } from './modules/aiPrediction.js';
import { AlertsManager } from './modules/alerts.js';
import { ReplayController } from './modules/replay.js';

const $ = (id) => document.getElementById(id);
const els = {
  joinForm: $('join-form'),
  name: $('name-input'),
  room: $('room-input'),
  status: $('status'),
  tracker: $('tracker-section'),
  people: $('people-list'),
  distances: $('distance-list'),
  targetUsers: $('target-users'),
  targetCount: $('target-count'),
  routeInfo: $('route-info'),
  navSteps: $('nav-steps'),
  vehicle: $('vehicle-mode'),
  routeBtn: $('route-btn'),
  startNav: $('start-nav-btn'),
  stopNav: $('stop-nav-btn'),
  recenter: $('recenter-btn'),
  theme: $('theme-toggle'),
  live: $('live-indicator'),
  shareBox: $('share-link-box'),
  shareLink: $('share-link'),
  copy: $('copy-link-btn'),
  wa: $('whatsapp-share-btn'),
  install: $('install-btn'),
  heat: $('heat-toggle'),
  replaySlider: $('replay-slider'),
  replayPlay: $('replay-play'),
  replayStop: $('replay-stop'),
  speedometer: $('speedometer'),
  speedStats: $('speed-stats'),
  movementGraph: $('movement-graph'),
  roomAnalytics: $('room-analytics'),
  leaderboard: $('leaderboard'),
  prediction: $('prediction'),
  radius: $('radius-select'),
  soundAlert: $('sound-alert'),
  batterySaver: $('battery-saver'),
  privacyBlur: $('privacy-blur'),
  sosBtn: $('sos-btn'),
  sosBanner: $('sos-banner'),
  selectAll: $('select-all-btn'),
  clearAll: $('clear-all-btn'),
};

const mapManager = new MapManager('map');
const analytics = new MovementAnalytics();
const alerts = new AlertsManager();
const replay = new ReplayController(els.replaySlider);

let roomId = '';
let inviteToken = '';
let userId = '';
let events;
let routeLayer;
let latestRoute = [];
let navOn = false;
let lastVoice = '';
let deferredInstallPrompt;
let lastUsers = [];
let heatMode = false;
let isSos = false;
let myWatchId;

const sessionKey = 'distance-tracker-last-session';
const nameKey = 'distance-tracker-preferred-name';
const deviceKey = 'distance-tracker-device-id';
const themeKey = 'distance-tracker-theme';

const getDeviceId = () => {
  let id = localStorage.getItem(deviceKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(deviceKey, id);
  }
  return id;
};

const toKmh = (mps) => mps * 3.6;
const fmtDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const fmtTime = (s) => {
  if (!s) return 'N/A';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
};

const setLive = (state) => {
  els.live.className = `live-indicator ${
    state === 'connected' ? 'live-connected' : state === 'reconnecting' ? 'live-reconnecting' : 'live-offline'
  }`;
  els.live.textContent = state[0].toUpperCase() + state.slice(1);
};

const setStatus = (msg, err = false) => {
  els.status.textContent = msg;
  els.status.style.color = err ? '#ff97a6' : '';
};

const speak = (text) => {
  if (!('speechSynthesis' in window) || !text || text === lastVoice) return;
  lastVoice = text;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  window.speechSynthesis.speak(u);
};

const apiPost = async (path, payload) => {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'API error');
  return body;
};

const selectedTargetIds = () => [...els.targetUsers.querySelectorAll('input[type="checkbox"]:checked')].map((e) => e.value);
const updateTargetCount = () => { els.targetCount.textContent = `${selectedTargetIds().length} selected`; };

const renderTargets = (users) => {
  const old = new Set(selectedTargetIds());
  els.targetUsers.innerHTML = '';
  const candidates = users.filter((u) => u.id !== userId && typeof u.lat === 'number' && typeof u.lng === 'number');
  if (!candidates.length) {
    els.targetUsers.textContent = 'No route targets yet.';
    updateTargetCount();
    return;
  }
  const auto = old.size === 0;
  candidates.forEach((u) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = u.id;
    cb.checked = auto || old.has(u.id);
    cb.addEventListener('change', updateTargetCount);
    label.append(cb, document.createTextNode(` ${u.name}`));
    els.targetUsers.appendChild(label);
  });
  updateTargetCount();
};

const drawSpeedometer = (speedKmh) => {
  const c = els.speedometer;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#244';
  ctx.beginPath();
  ctx.arc(110, 110, 75, Math.PI, 2 * Math.PI);
  ctx.stroke();
  const t = Math.min(1, speedKmh / 120);
  ctx.strokeStyle = '#38f3ff';
  ctx.beginPath();
  ctx.arc(110, 110, 75, Math.PI, Math.PI + Math.PI * t);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '16px sans-serif';
  ctx.fillText(`${speedKmh.toFixed(1)} km/h`, 70, 70);
};

const drawMovementGraph = (series) => {
  const c = els.movementGraph;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#2a3455';
  ctx.strokeRect(0, 0, c.width, c.height);
  if (!series.length) return;
  const max = Math.max(5, ...series.map((p) => p.speedKmh));
  ctx.strokeStyle = '#7affd9';
  ctx.beginPath();
  series.forEach((p, i) => {
    const x = (i / Math.max(1, series.length - 1)) * (c.width - 10) + 5;
    const y = c.height - (p.speedKmh / max) * (c.height - 10) - 5;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
};

const blurLocation = (lat, lng) => {
  const step = 0.001;
  return [Math.round(lat / step) * step, Math.round(lng / step) * step];
};

const getMe = () => lastUsers.find((u) => u.id === userId);

const updateNavigationProgress = (lat, lng) => {
  if (!navOn || !latestRoute.length) return;
  let bestI = 0;
  let bestD = Number.POSITIVE_INFINITY;
  latestRoute.forEach((s, i) => {
    const loc = s.maneuver?.location;
    if (!loc) return;
    const d = MovementAnalytics.haversine({ lat, lng }, { lat: loc[1], lng: loc[0] });
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  });
  const step = latestRoute[bestI];
  const text = `${step.maneuver?.type || 'Go'} ${step.maneuver?.modifier || 'ahead'} for ${fmtDistance(step.distance)}`;
  els.routeInfo.textContent = `Navigation: ${text}`;
  speak(text);
};

const routeUrl = (profile, coords) =>
  coords.length <= 2
    ? `https://router.project-osrm.org/route/v1/${profile}/${coords.join(';')}?overview=full&geometries=geojson&steps=true`
    : `https://router.project-osrm.org/trip/v1/${profile}/${coords.join(';')}?overview=full&geometries=geojson&steps=true&source=first&roundtrip=false`;

const buildRoute = async (quiet = false) => {
  const me = getMe();
  if (!me || typeof me.lat !== 'number') return setStatus('Your location not available yet.', true);
  const targets = selectedTargetIds().map((id) => lastUsers.find((u) => u.id === id)).filter(Boolean);
  if (!targets.length) return setStatus('Select one or more people for routing.', true);

  const avg =
    targets.reduce((acc, t) => acc + MovementAnalytics.haversine(me, t), 0) / Math.max(1, targets.length);
  const mode = els.vehicle.value === 'auto' ? (avg < 700 ? 'walking' : avg < 3500 ? 'scooter' : avg < 15000 ? 'motorcycle' : 'driving') : els.vehicle.value;
  const profile = ['walking', 'cycling', 'scooter'].includes(mode) ? 'cycling' : 'driving';
  const coords = [[me.lng, me.lat], ...targets.map((t) => [t.lng, t.lat])].map((p) => `${p[0]},${p[1]}`);

  const res = await fetch(routeUrl(profile, coords));
  const body = await res.json();
  const route = body.routes?.[0] || body.trips?.[0];
  if (!route) return setStatus('No route found.', true);

  if (routeLayer) mapManager.map.removeLayer(routeLayer);
  routeLayer = L.geoJSON(route.geometry, { style: { color: '#38f3ff', weight: 4 } }).addTo(mapManager.map);
  if (!quiet) mapManager.map.fitBounds(routeLayer.getBounds().pad(0.2));

  const steps = (route.legs || []).flatMap((leg) => leg.steps || []);
  latestRoute = steps;
  els.navSteps.innerHTML = '';
  steps.slice(0, 20).forEach((s, i) => {
    const li = document.createElement('li');
    const text = `${s.instruction || `${s.maneuver?.type || 'Go'} ${s.maneuver?.modifier || 'ahead'}`} for ${fmtDistance(s.distance)}`;
    li.textContent = `${i + 1}. ${text}`;
    els.navSteps.appendChild(li);
  });

  const eta = estimateArrivalSeconds(route.distance, analytics.speedKmh(userId) / 3.6 || 8);
  els.routeInfo.textContent = `${mode} • ${fmtDistance(route.distance)} • ETA ${fmtTime(eta || route.duration)}`;

  // directional compass toward first selected target
  const first = targets[0];
  const br = bearingDegrees(me, first);
  mapManager.drawCompass(me, first, br);
};

const renderSnapshot = (snapshot) => {
  const users = snapshot.users || [];
  const distances = snapshot.distances || [];
  lastUsers = users;
  analytics.ingestUsers(users);

  els.people.innerHTML = '';
  users.forEach((u) => {
    const li = document.createElement('li');
    const ll = typeof u.lat === 'number' ? `${u.lat.toFixed(5)}, ${u.lng.toFixed(5)}` : 'waiting GPS';
    li.textContent = `${u.name}${u.id === userId ? ' (You)' : ''} • ${ll}`;
    els.people.appendChild(li);

    const sos = !!u.sosUntil && u.sosUntil > Date.now();
    mapManager.upsertUser(u, u.id === userId, sos);
    mapManager.drawTrail(u.id, analytics.history(u.id));
    mapManager.drawPrediction(u.id, predictNextPositions(analytics.history(u.id), 5));
  });

  els.distances.innerHTML = '';
  if (!distances.length) {
    els.distances.innerHTML = '<li>Need at least two users with active coordinates.</li>';
  } else {
    distances.sort((a, b) => a.meters - b.meters).forEach((d) => {
      const li = document.createElement('li');
      li.textContent = `${d.names[0]} ↔ ${d.names[1]}: ${fmtDistance(d.meters)} (±${Math.round(d.errorMeters || 0)} m)`;
      els.distances.appendChild(li);
    });
  }

  renderTargets(users);
  mapManager.setHeatMode(heatMode, users);

  const me = getMe();
  if (me) {
    drawSpeedometer(analytics.speedKmh(me.id));
    drawMovementGraph(analytics.movementSeries(me.id));
    els.speedStats.textContent = `Speed: ${analytics.speedKmh(me.id).toFixed(1)} km/h • Acc: ${analytics.acceleration(me.id).toFixed(2)} m/s² • Session distance: ${fmtDistance(analytics.totalDistance(me.id))}`;

    const firstTarget = selectedTargetIds().map((id) => users.find((u) => u.id === id)).find(Boolean);
    if (firstTarget) {
      const pred = predictNextPositions(analytics.history(firstTarget.id), 5);
      const last = pred[pred.length - 1];
      if (last) {
        const d = MovementAnalytics.haversine(me, last);
        const eta = estimateArrivalSeconds(d, analytics.speedKmh(me.id) / 3.6 || 5);
        els.prediction.textContent = `Predicted arrival to ${firstTarget.name}: ${fmtTime(eta)} (forecast path shown)`;
      }
    }

    replay.setHistory(analytics.history(me.id));
  }

  const active = users.filter((u) => u.active);
  const stats = analytics.groupStats(active);
  const lb = analytics.leaderboard(users, distances);
  els.roomAnalytics.textContent = `Avg speed: ${stats.avgSpeed.toFixed(1)} km/h • Combined distance: ${fmtDistance(stats.totalCombined)} • Active users: ${stats.activeUsers}`;
  els.leaderboard.textContent = `Challenge: Fastest ${lb.fastest?.name || '-'} • Farthest ${lb.farthest?.name || '-'} • Closest ${lb.closestPair ? `${lb.closestPair.names[0]}-${lb.closestPair.names[1]}` : '-'}`;

  const sosActive = users.some((u) => u.sosUntil && u.sosUntil > Date.now());
  els.sosBanner.classList.toggle('hidden', !sosActive);

  alerts.checkProximity(me, users, (msg) => setStatus(msg));

  if (navOn && selectedTargetIds().length) buildRoute(true).catch(() => {});
};

const fetchSnapshot = async () => {
  const res = await fetch(`/api/room?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(inviteToken)}`);
  if (!res.ok) return;
  renderSnapshot(await res.json());
};

const subscribe = () => {
  if (events) events.close();
  events = new EventSource(`/api/events?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(inviteToken)}`);
  events.onopen = () => setLive('connected');
  events.onmessage = (e) => renderSnapshot(JSON.parse(e.data));
  events.onerror = () => {
    setLive('reconnecting');
    fetchSnapshot().catch(() => setLive('offline'));
  };
};

const joinRoom = async () => {
  const name = els.name.value.trim() || `Guest-${crypto.randomUUID().slice(0, 5)}`;
  roomId = els.room.value.trim();
  if (!roomId) return setStatus('Room ID required.', true);

  const joined = await apiPost('/api/join', { roomId, name, deviceId: getDeviceId(), inviteToken });
  userId = joined.userId;
  inviteToken = joined.inviteToken;
  localStorage.setItem(nameKey, name);
  localStorage.setItem(sessionKey, JSON.stringify({ roomId, inviteToken }));

  els.tracker.classList.remove('hidden');
  mapManager.init(() => setStatus('Map tiles issue: switching layers can help.', true));

  els.shareLink.value = joined.inviteLink;
  els.shareBox.classList.remove('hidden');
  history.replaceState({}, '', `/?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(inviteToken)}`);

  subscribe();
  fetchSnapshot().catch(() => {});
  setStatus(`Joined ${roomId}`);
};

const pushLocation = async (position) => {
  let lat = position.coords.latitude;
  let lng = position.coords.longitude;
  if (els.privacyBlur.checked) [lat, lng] = blurLocation(lat, lng);

  await apiPost('/api/location', {
    roomId,
    userId,
    lat,
    lng,
    accuracy: position.coords.accuracy,
    sosUntil: isSos ? Date.now() + 60_000 : null,
  });

  updateNavigationProgress(lat, lng);
};

const startGeo = () => {
  if (!navigator.geolocation) return setStatus('Geolocation unsupported.', true);
  const getOptions = () => ({ enableHighAccuracy: true, maximumAge: els.batterySaver.checked ? 6000 : 1200, timeout: 12000 });

  if (myWatchId) navigator.geolocation.clearWatch(myWatchId);
  myWatchId = navigator.geolocation.watchPosition(
    (pos) => pushLocation(pos).catch((e) => setStatus(e.message, true)),
    (e) => setStatus(`GPS error: ${e.message}`, true),
    getOptions(),
  );
};

// Replay
replay.onFrame = (point) => {
  mapManager.upsertUser({ id: 'replay-me', name: 'Replay', lat: point.lat, lng: point.lng }, false, false);
};

els.joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinRoom().then(startGeo).catch((err) => setStatus(err.message, true));
});
els.routeBtn.addEventListener('click', () => buildRoute().catch((e) => setStatus(e.message, true)));
els.startNav.addEventListener('click', () => {
  navOn = true;
  if (latestRoute[0]) speak(latestRoute[0].instruction || 'Navigation started');
});
els.stopNav.addEventListener('click', () => {
  navOn = false;
  speechSynthesis.cancel();
});
els.recenter.addEventListener('click', () => mapManager.fitUsers(lastUsers));
els.selectAll.addEventListener('click', () => {
  [...els.targetUsers.querySelectorAll('input[type="checkbox"]')].forEach((c) => (c.checked = true));
  updateTargetCount();
});
els.clearAll.addEventListener('click', () => {
  [...els.targetUsers.querySelectorAll('input[type="checkbox"]')].forEach((c) => (c.checked = false));
  updateTargetCount();
});
els.copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.shareLink.value);
  setStatus('Invite link copied.');
});
els.wa.addEventListener('click', () => {
  const txt = encodeURIComponent(`Join my private room: ${els.shareLink.value}`);
  window.open(`https://wa.me/?text=${txt}`, '_blank');
});
els.install.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return setStatus('Install not available.', true);
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.install.classList.add('hidden');
});
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  els.install.classList.remove('hidden');
});
els.theme.addEventListener('click', () => {
  document.body.classList.toggle('light');
  localStorage.setItem(themeKey, document.body.classList.contains('light') ? 'light' : 'dark');
});
if (localStorage.getItem(themeKey) === 'light') document.body.classList.add('light');
els.heat.addEventListener('click', () => {
  heatMode = !heatMode;
  mapManager.setHeatMode(heatMode, lastUsers);
});
els.radius.addEventListener('change', () => alerts.setRadius(Number(els.radius.value)));
els.soundAlert.addEventListener('change', () => alerts.setSound(els.soundAlert.checked));
els.replayPlay.addEventListener('click', () => replay.play());
els.replayStop.addEventListener('click', () => replay.stop());
els.sosBtn.addEventListener('click', () => {
  isSos = true;
  setTimeout(() => { isSos = false; }, 60_000);
  setStatus('SOS active for 60 seconds', true);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) els.batterySaver.checked = true;
});
els.batterySaver.addEventListener('change', startGeo);

window.addEventListener('online', () => setLive('connected'));
window.addEventListener('offline', () => setLive('offline'));

const restore = () => {
  const params = new URLSearchParams(location.search);
  let room = params.get('room') || '';
  let token = params.get('token') || '';
  if (room && /^https?:\/\//i.test(room)) {
    try {
      const nested = new URL(room);
      room = nested.searchParams.get('room') || room;
      token = token || nested.searchParams.get('token') || '';
    } catch {}
  }

  if (!room || !token) {
    try {
      const last = JSON.parse(localStorage.getItem(sessionKey) || 'null');
      room = room || last?.roomId || '';
      token = token || last?.inviteToken || '';
    } catch {}
  }

  const prefName = localStorage.getItem(nameKey);
  if (prefName) els.name.value = prefName;

  if (room) {
    els.room.value = room;
    roomId = room;
  }
  if (token) inviteToken = token;

  if (room && token) {
    joinRoom().then(startGeo).catch((e) => setStatus(`Auto-join failed: ${e.message}`, true));
  }
};

setLive(navigator.onLine ? 'connected' : 'offline');
setStatus('Ready. Join room to start.');
restore();
