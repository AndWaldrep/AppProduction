'use strict';
// Kart Clash server: serves the game files and relays race data between
// players in the same room over WebSockets. Each phone simulates its own kart;
// the server owns rooms, the race start time, finish order and results.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three', 'build');

const MAX_PLAYERS = 8;
const MAX_KARTS = 8;
const LOBBY_GRACE_MS = 3 * 60 * 1000; // keep a player's seat while they text an invite
const RACE_GRACE_MS = 60 * 1000;
const RESULTS_TIMEOUT_MS = 30 * 1000; // after the first human finishes
const COUNTDOWN_MS = 4500;
const TRACKS = ['sunny', 'desert'];
const BOT_NAMES = ['Turbo', 'Zippy', 'Blaze', 'Nitro', 'Dash', 'Comet', 'Rocket', 'Pixel'];
const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveFile(res, root, relPath) {
  const filePath = path.normalize(path.join(root, relPath));
  if (!filePath.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': root === THREE_DIR ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
}

function handleHttp(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (pathname.startsWith('/vendor/three/')) {
    serveFile(res, THREE_DIR, pathname.slice('/vendor/three/'.length));
    return;
  }
  serveFile(res, PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
}

// ---------------------------------------------------------------- rooms

const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += letters[crypto.randomInt(letters.length)];
    if (!rooms.has(code)) return code;
  }
}

function cleanName(name) {
  const s = String(name || '').replace(/[^\p{L}\p{N} _.'!-]/gu, '').trim().slice(0, 12);
  return s || 'Racer';
}

// Use the requested color unless someone else in the room already has it.
function cleanColor(color, room, self) {
  const used = new Set([...room.players.values()].filter((p) => p !== self).map((p) => p.color));
  if (COLORS.includes(color) && !used.has(color)) return color;
  return COLORS.find((c) => !used.has(c)) || COLORS[0];
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id !== exceptId && p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}

function roomInfo(room) {
  return {
    t: 'room',
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    settings: room.settings,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: !!p.ws,
      inRace: p.inRace,
    })),
  };
}

function pushRoom(room) {
  broadcast(room, roomInfo(room));
}

function startInfo(room) {
  const r = room.race;
  return {
    t: 'start',
    startAt: r.startAt,
    laps: r.laps,
    track: r.track,
    karts: r.karts,
    finished: r.finished,
    kstate: r.kstate,
  };
}

function connectedHumans(room) {
  return [...room.players.values()].filter((p) => p.ws);
}

function pickNewHost(room) {
  const next = connectedHumans(room)[0] || [...room.players.values()][0];
  if (next && next.id !== room.hostId) room.hostId = next.id;
}

function removePlayer(room, player) {
  clearTimeout(player.dropTimer);
  room.players.delete(player.id);
  if (room.players.size === 0) {
    clearTimeout(room.resultsTimer);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === player.id) pickNewHost(room);
  if (room.state === 'racing') maybeEndRace(room);
  pushRoom(room);
}

function startRace(room) {
  const humans = connectedHumans(room);
  const botCount = Math.max(0, Math.min(room.settings.bots, MAX_KARTS - humans.length));
  const karts = humans.map((p) => ({ id: p.id, name: p.name, color: p.color, bot: false }));
  const usedColors = new Set(karts.map((k) => k.color));
  const freeColors = COLORS.filter((c) => !usedColors.has(c));
  for (let i = 0; i < botCount; i++) {
    karts.push({
      id: 'bot' + i,
      name: BOT_NAMES[i],
      color: freeColors[i % Math.max(1, freeColors.length)] || COLORS[i],
      bot: true,
    });
  }
  // Humans start at the back of the grid, like the real thing.
  karts.reverse();
  karts.forEach((k, i) => (k.grid = i));
  for (const p of room.players.values()) p.inRace = !!p.ws;
  room.state = 'racing';
  room.race = {
    startAt: Date.now() + COUNTDOWN_MS,
    laps: room.settings.laps,
    track: room.settings.track,
    karts,
    finished: [],
    kstate: {},
  };
  broadcast(room, startInfo(room));
  pushRoom(room);
}

function maybeEndRace(room) {
  const race = room.race;
  if (!race || room.state !== 'racing') return;
  const done = new Set(race.finished.map((f) => f.id));
  const waiting = [...room.players.values()].filter((p) => p.inRace && p.ws && !done.has(p.id));
  const anyoneRacing = [...room.players.values()].some((p) => p.inRace && p.ws);
  if (waiting.length === 0 || !anyoneRacing) endRace(room);
}

function endRace(room) {
  const race = room.race;
  if (!race || room.state !== 'racing') return;
  clearTimeout(room.resultsTimer);
  const done = new Set(race.finished.map((f) => f.id));
  const rest = race.karts
    .filter((k) => !done.has(k.id))
    .sort((a, b) => (race.kstate[b.id]?.p ?? -1e9) - (race.kstate[a.id]?.p ?? -1e9));
  const byId = new Map(race.karts.map((k) => [k.id, k]));
  const standings = [
    ...race.finished.map((f) => ({ ...byId.get(f.id), time: f.time })),
    ...rest.map((k) => ({ ...k, time: null })),
  ];
  room.state = 'results';
  for (const p of room.players.values()) p.inRace = false;
  broadcast(room, { t: 'results', standings });
  pushRoom(room);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function ownsKart(room, player, id) {
  if (id === player.id) return true;
  return player.id === room.hostId && typeof id === 'string' && id.startsWith('bot');
}

function handleMessage(ws, msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.t === 'ping') {
    send(ws, { t: 'pong', c: msg.c, s: Date.now() });
    return;
  }

  // ---- joining
  if (msg.t === 'create' || msg.t === 'join' || msg.t === 'rejoin') {
    if (ws.player) return;
    let room;
    if (msg.t === 'create') {
      room = {
        code: makeCode(),
        hostId: null,
        state: 'lobby',
        settings: { laps: 3, bots: 3, track: 'sunny' },
        players: new Map(),
        race: null,
      };
      rooms.set(room.code, room);
    } else {
      room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) {
        send(ws, { t: 'error', code: 'noroom', msg: "That race doesn't exist anymore. Ask your friend for a new link." });
        return;
      }
    }

    if (msg.t === 'rejoin') {
      const p = room.players.get(msg.id);
      if (!p || p.token !== msg.token) {
        send(ws, { t: 'error', code: 'norejoin', msg: 'Seat expired' });
        return;
      }
      if (p.ws && p.ws !== ws) {
        p.ws.player = null;
        p.ws.close();
      }
      clearTimeout(p.dropTimer);
      p.ws = ws;
      ws.player = p;
      send(ws, { t: 'welcome', id: p.id, token: p.token, code: room.code });
      if (room.state === 'racing' && p.inRace) send(ws, startInfo(room));
      pushRoom(room);
      return;
    }

    if (room.players.size >= MAX_PLAYERS) {
      send(ws, { t: 'error', code: 'full', msg: 'That race is full.' });
      return;
    }
    const p = {
      id: 'p' + crypto.randomBytes(4).toString('hex'),
      token: crypto.randomBytes(12).toString('hex'),
      name: cleanName(msg.name),
      color: null,
      ws,
      room,
      inRace: false,
      dropTimer: null,
    };
    p.color = cleanColor(msg.color, room);
    room.players.set(p.id, p);
    if (!room.hostId || !room.players.has(room.hostId)) room.hostId = p.id;
    ws.player = p;
    send(ws, { t: 'welcome', id: p.id, token: p.token, code: room.code });
    pushRoom(room);
    return;
  }

  const player = ws.player;
  if (!player) return;
  const room = player.room;
  const isHost = room.hostId === player.id;

  switch (msg.t) {
    case 's': {
      // Kart state, ~15 times a second. Remember progress for standings and relay.
      if (room.state !== 'racing' || !player.inRace || !Array.isArray(msg.k)) return;
      const out = [];
      for (const k of msg.k.slice(0, MAX_KARTS)) {
        if (!k || !ownsKart(room, player, k.id)) continue;
        const clean = {
          id: k.id, ts: num(k.ts), x: num(k.x), z: num(k.z), h: num(k.h), s: num(k.s), p: num(k.p),
          sp: num(k.sp), st: num(k.st), b: num(k.b), dd: num(k.dd), dc: num(k.dc), hop: num(k.hop),
        };
        room.race.kstate[k.id] = clean;
        out.push(clean);
      }
      if (out.length) broadcast(room, { t: 's', k: out }, player.id);
      return;
    }
    case 'e': {
      // Item events (box taken, item spawned, item hit). Relayed as-is.
      if (room.state !== 'racing') return;
      broadcast(room, { ...msg, from: player.id }, player.id);
      return;
    }
    case 'finish': {
      if (room.state !== 'racing' || !ownsKart(room, player, msg.id)) return;
      const race = room.race;
      if (!race.karts.some((k) => k.id === msg.id)) return;
      if (race.finished.some((f) => f.id === msg.id)) return;
      race.finished.push({ id: msg.id, time: Math.max(0, num(msg.time)) });
      broadcast(room, { t: 'fin', id: msg.id, time: num(msg.time), place: race.finished.length });
      const kart = race.karts.find((k) => k.id === msg.id);
      if (!kart.bot && !room.resultsTimer) {
        room.resultsTimer = setTimeout(() => {
          room.resultsTimer = null;
          endRace(room);
        }, RESULTS_TIMEOUT_MS).unref();
      }
      maybeEndRace(room);
      return;
    }
    case 'profile': {
      if (room.state !== 'lobby') return;
      if (msg.name !== undefined) player.name = cleanName(msg.name);
      if (msg.color !== undefined) player.color = cleanColor(msg.color, room, player);
      pushRoom(room);
      return;
    }
    case 'settings': {
      if (!isHost || room.state !== 'lobby') return;
      const s = room.settings;
      if (msg.laps !== undefined) s.laps = Math.max(1, Math.min(5, Math.round(num(msg.laps)) || 3));
      if (msg.bots !== undefined) s.bots = Math.max(0, Math.min(6, Math.round(num(msg.bots))));
      if (msg.track !== undefined && TRACKS.includes(msg.track)) s.track = msg.track;
      pushRoom(room);
      return;
    }
    case 'startRace': {
      if (!isHost || room.state !== 'lobby') return;
      startRace(room);
      return;
    }
    case 'toLobby': {
      if (!isHost) return;
      if (room.state === 'racing') endRace(room);
      room.state = 'lobby';
      room.race = null;
      pushRoom(room);
      return;
    }
    case 'leave': {
      ws.player = null;
      removePlayer(room, player);
      return;
    }
  }
}

function handleClose(ws) {
  const player = ws.player;
  if (!player || player.ws !== ws) return;
  const room = player.room;
  player.ws = null;
  // During a race the host also drives the CPU karts, so hand that job over right away.
  if (room.state !== 'lobby' && room.hostId === player.id) pickNewHost(room);
  if (room.state === 'racing') maybeEndRace(room);
  if (room.players.has(player.id)) {
    player.dropTimer = setTimeout(
      () => removePlayer(room, player),
      room.state === 'lobby' ? LOBBY_GRACE_MS : RACE_GRACE_MS
    ).unref();
  }
  if (rooms.has(room.code)) pushRoom(room);
}

function createServer() {
  const server = http.createServer(handleHttp);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      handleMessage(ws, msg);
    });
    ws.on('close', () => handleClose(ws));
    ws.on('error', () => {});
  });
  // Drop sockets that silently died (phone went to sleep, lost signal).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000).unref();
  server.on('close', () => clearInterval(heartbeat));
  server.wss = wss;
  return server;
}

module.exports = { createServer, rooms };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`Kart Clash running at http://localhost:${port}`);
  });
}
