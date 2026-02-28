const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/**
 * roomId -> {
 *   users: Map<userId, { id, name, lat, lng, updatedAt }>,
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

const getOrCreateRoom = (roomId) => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { users: new Map(), clients: new Set() });
  }
  return rooms.get(roomId);
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

      if (!roomId) {
        json(res, 400, { error: 'Room ID is required.' });
        return;
      }

      const userId = crypto.randomUUID();
      const room = getOrCreateRoom(roomId);
      room.users.set(userId, {
        id: userId,
        name,
        lat: null,
        lng: null,
        accuracy: null,
        updatedAt: Date.now(),
      });

      json(res, 200, { ok: true, roomId, userId, name });
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
      json(res, 200, { ok: true });
      broadcast(roomId);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/leave') {
      const body = await parseBody(req);
      const roomId = sanitizeRoomId(body.roomId);
      const userId = String(body.userId || '');
      const room = rooms.get(roomId);

      if (room?.users.delete(userId)) {
        broadcast(roomId);
        cleanupRoom(roomId);
      }

      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/events?')) {
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const roomId = sanitizeRoomId(query.get('roomId'));

      if (!roomId) {
        json(res, 400, { error: 'roomId query is required.' });
        return;
      }

      const room = getOrCreateRoom(roomId);

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
