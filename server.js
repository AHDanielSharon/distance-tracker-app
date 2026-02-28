const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORE_FILE = path.join(__dirname, 'data', 'store.json');

/**
 * roomId -> {
 *   inviteToken: string,
 *   users: Map<userId, user>,
 *   clients: Set<ServerResponse>
 * }
 */
const rooms = new Map();

const toRad = (degrees) => (degrees * Math.PI) / 180;

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const sanitizeRoomId = (value) => String(value || '').trim().slice(0, 32);
const sanitizeName = (value) => String(value || '').trim().slice(0, 24);
const sanitizeDeviceId = (value) => String(value || '').trim().slice(0, 128);
const normalizeName = (value) => sanitizeName(value).toLowerCase();
const sanitizeInviteToken = (value) => String(value || '').trim().slice(0, 256);
const generateInviteToken = () => crypto.randomBytes(24).toString('base64url');

const getBaseUrl = (req) => {
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  return `${protocol}://${req.headers.host}`;
};


const haversineDistanceMeters = (a, b) => {
  const R = 6371000;
  const latDelta = toRad(b.lat - a.lat);
  const lngDelta = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
};

const getOrCreateRoom = (roomId, inviteToken) => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      inviteToken: sanitizeInviteToken(inviteToken) || generateInviteToken(),
      users: new Map(),
      clients: new Set(),
    });
  }
  return rooms.get(roomId);
};

const saveStore = () => {
  const plain = {};
  for (const [roomId, room] of rooms.entries()) {
    plain[roomId] = { inviteToken: room.inviteToken, users: [...room.users.values()] };
  }

  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify({ rooms: plain }, null, 2));
};

const loadStore = () => {
  if (!fs.existsSync(STORE_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    const storedRooms = parsed?.rooms || {};

    for (const [roomId, roomData] of Object.entries(storedRooms)) {
      const room = {
        inviteToken: sanitizeInviteToken(roomData.inviteToken) || generateInviteToken(),
        users: new Map(),
        clients: new Set(),
      };
      for (const user of roomData.users || []) {
        room.users.set(user.id, {
          id: user.id,
          deviceId: user.deviceId || null,
          name: sanitizeName(user.name) || 'Anonymous',
          lat: typeof user.lat === 'number' ? user.lat : null,
          lng: typeof user.lng === 'number' ? user.lng : null,
          accuracy: typeof user.accuracy === 'number' ? user.accuracy : null,
          updatedAt: user.updatedAt || Date.now(),
          lastSeenAt: user.lastSeenAt || Date.now(),
          active: false,
        });
      }
      rooms.set(roomId, room);
    }
  } catch {
    // ignore invalid persisted file and start clean
  }
};

const buildSnapshot = (roomId) => {
  const room = rooms.get(roomId);
  const users = room ? [...room.users.values()] : [];
  const distances = [];

  for (let i = 0; i < users.length; i += 1) {
    for (let j = i + 1; j < users.length; j += 1) {
      const a = users[i];
      const b = users[j];
      if (typeof a.lat === 'number' && typeof b.lat === 'number') {
        distances.push({
          between: [a.id, b.id],
          names: [a.name, b.name],
          meters: haversineDistanceMeters(a, b),
          errorMeters:
            (typeof a.accuracy === 'number' ? a.accuracy : 0) +
            (typeof b.accuracy === 'number' ? b.accuracy : 0),
        });
      }
    }
  }

  return { users, distances };
};

const cleanupRoom = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.users.size === 0 && room.clients.size === 0) {
    rooms.delete(roomId);
  }
};

const broadcast = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = `data: ${JSON.stringify(buildSnapshot(roomId))}\n\n`;
  for (const client of room.clients) {
    client.write(payload);
  }
};

const parseBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });

const contentTypeFor = (filePath) => {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.webmanifest')) return 'application/manifest+json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
};

const serveStatic = (req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(urlPath).replace(/^\.+[\\/]/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    json(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      json(res, 404, { error: 'Not found' });
      return;
    }

    res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
    res.end(data);
  });
};

loadStore();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      json(res, 200, { ok: true, rooms: rooms.size });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/join') {
      const body = await parseBody(req);
      const roomId = sanitizeRoomId(body.roomId);
      const name = sanitizeName(body.name) || 'Anonymous';
      const deviceId = sanitizeDeviceId(body.deviceId);
      const inviteToken = sanitizeInviteToken(body.inviteToken);

      if (!roomId) {
        json(res, 400, { error: 'Room ID is required.' });
        return;
      }

      const existingRoom = rooms.get(roomId);
      if (existingRoom && (!inviteToken || inviteToken !== existingRoom.inviteToken)) {
        json(res, 403, { error: 'Invalid invite link/token for this room.' });
        return;
      }

      const room = existingRoom || getOrCreateRoom(roomId, inviteToken);
      let user = null;

      if (deviceId) {
        for (const existing of room.users.values()) {
          if (existing.deviceId === deviceId) {
            user = existing;
            break;
          }
        }
      }

      if (!user) {
        const wantedName = normalizeName(name);
        for (const existing of room.users.values()) {
          if (normalizeName(existing.name) === wantedName) {
            user = existing;
            break;
          }
        }
      }

      if (!user) {
        const userId = crypto.randomUUID();
        user = {
          id: userId,
          deviceId: deviceId || null,
          name,
          lat: null,
          lng: null,
          accuracy: null,
          updatedAt: Date.now(),
          lastSeenAt: Date.now(),
          active: true,
        };
        room.users.set(userId, user);
      } else {
        user.deviceId = deviceId || user.deviceId || null;
        user.name = name;
        user.lat = null;
        user.lng = null;
        user.accuracy = null;
        user.active = true;
        user.updatedAt = Date.now();
        user.lastSeenAt = Date.now();
      }

      saveStore();
      const inviteLink = `${getBaseUrl(req)}/?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(room.inviteToken)}`;
      json(res, 200, {
        ok: true,
        roomId,
        userId: user.id,
        name: user.name,
        deviceId: user.deviceId,
        inviteToken: room.inviteToken,
        inviteLink,
      });
      broadcast(roomId);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/location') {
      const body = await parseBody(req);
      const roomId = sanitizeRoomId(body.roomId);
      const userId = String(body.userId || '');
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      const accuracy = Number(body.accuracy);

      const room = rooms.get(roomId);
      const user = room?.users.get(userId);

      if (!room || !user || Number.isNaN(lat) || Number.isNaN(lng)) {
        json(res, 400, { error: 'Invalid location payload.' });
        return;
      }

      user.lat = lat;
      user.lng = lng;
      user.accuracy = Number.isNaN(accuracy) ? null : Math.max(0, accuracy);
      user.updatedAt = Date.now();
      user.lastSeenAt = Date.now();
      user.active = true;

      saveStore();
      json(res, 200, { ok: true });
      broadcast(roomId);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/leave') {
      const body = await parseBody(req);
      const roomId = sanitizeRoomId(body.roomId);
      const userId = String(body.userId || '');
      const room = rooms.get(roomId);
      const user = room?.users.get(userId);

      if (user) {
        user.active = false;
        user.lastSeenAt = Date.now();
        saveStore();
        broadcast(roomId);
      }

      json(res, 200, { ok: true });
      cleanupRoom(roomId);
      return;
    }


    if (req.method === 'GET' && req.url.startsWith('/api/room?')) {
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const roomId = sanitizeRoomId(query.get('roomId'));
      const inviteToken = sanitizeInviteToken(query.get('token'));

      if (!roomId || !inviteToken) {
        json(res, 400, { error: 'roomId and token query are required.' });
        return;
      }

      const room = rooms.get(roomId);
      if (!room || room.inviteToken !== inviteToken) {
        json(res, 403, { error: 'Invalid room token.' });
        return;
      }

      json(res, 200, buildSnapshot(roomId));
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/events?')) {
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const roomId = sanitizeRoomId(query.get('roomId'));
      const inviteToken = sanitizeInviteToken(query.get('token'));

      if (!roomId || !inviteToken) {
        json(res, 400, { error: 'roomId and token query are required.' });
        return;
      }

      const room = rooms.get(roomId);
      if (!room || room.inviteToken !== inviteToken) {
        json(res, 403, { error: 'Invalid room token.' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
      });
      res.write('retry: 1500\n\n');

      room.clients.add(res);
      res.write(`data: ${JSON.stringify(buildSnapshot(roomId))}\n\n`);

      req.on('close', () => {
        room.clients.delete(res);
        cleanupRoom(roomId);
      });
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res);
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    json(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Distance tracker running at http://localhost:${PORT}`);
});
