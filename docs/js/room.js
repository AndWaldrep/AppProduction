// The race room. It runs inside the host's browser: the host's phone keeps the
// lobby, the shared race start time, finish order and results, and relays each
// phone's kart data to the others. Guests reach it over a peer-to-peer link.
//
// A connection is any object with send(msg) and close().

const MAX_PLAYERS = 8;
const MAX_KARTS = 8;
const LOBBY_GRACE_MS = 3 * 60 * 1000; // keep a player's seat while they're away from the game
const RACE_GRACE_MS = 60 * 1000;
const RESULTS_TIMEOUT_MS = 30 * 1000; // after the first human finishes
const COUNTDOWN_MS = 4500;
const SILENT_MS = 12 * 1000; // a guest that sent nothing for this long has lost its connection
const TRACKS = ['sunny', 'desert'];
const BOT_NAMES = ['Turbo', 'Zippy', 'Blaze', 'Nitro', 'Dash', 'Comet', 'Rocket', 'Pixel'];
export const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292'];

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const a = new Uint8Array(4);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => letters[b % letters.length]).join('');
}

function cleanName(name) {
  const s = String(name || '').replace(/[^\p{L}\p{N} _.'!-]/gu, '').trim().slice(0, 12);
  return s || 'Racer';
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class Room {
  constructor(code, { now = () => Date.now() } = {}) {
    this.code = code;
    this.now = now;
    this.hostId = null;
    this.state = 'lobby';
    this.settings = { laps: 3, bots: 3, track: 'sunny' };
    this.players = new Map();
    this.conns = new Map(); // connection -> { player, lastHeard }
    this.race = null;
    this.resultsTimer = null;
    this.closed = false;
    this.watchdog = setInterval(() => this.checkSilent(), 3000);
  }

  // ------------------------------------------------------------ connections

  attach(conn) {
    this.conns.set(conn, { player: null, lastHeard: this.now() });
  }

  detach(conn) {
    const c = this.conns.get(conn);
    this.conns.delete(conn);
    if (!c || !c.player || c.player.conn !== conn) return;
    const player = c.player;
    player.conn = null;
    if (this.state === 'racing') this.maybeEndRace();
    player.dropTimer = setTimeout(
      () => this.removePlayer(player),
      this.state === 'lobby' ? LOBBY_GRACE_MS : RACE_GRACE_MS
    );
    this.pushRoom();
  }

  checkSilent() {
    const now = this.now();
    const late = this.lastCheck && now - this.lastCheck > 6000;
    this.lastCheck = now;
    if (late) {
      // The host's phone was asleep; nobody could be heard, so start the clock over.
      for (const c of this.conns.values()) c.lastHeard = now;
      return;
    }
    const cutoff = now - SILENT_MS;
    for (const [conn, c] of this.conns) {
      if (!conn.local && c.lastHeard < cutoff) {
        try {
          conn.close();
        } catch {}
        this.detach(conn);
      }
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.watchdog);
    clearTimeout(this.resultsTimer);
    for (const p of this.players.values()) clearTimeout(p.dropTimer);
  }

  send(conn, msg) {
    if (conn) {
      try {
        conn.send(msg);
      } catch {}
    }
  }

  broadcast(msg, exceptId) {
    for (const p of this.players.values()) {
      if (p.id !== exceptId && p.conn) this.send(p.conn, msg);
    }
  }

  // ------------------------------------------------------------ room state

  info() {
    return {
      t: 'room',
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      settings: this.settings,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        connected: !!p.conn,
        inRace: p.inRace,
      })),
    };
  }

  pushRoom() {
    if (!this.closed) this.broadcast(this.info());
  }

  startInfo() {
    const r = this.race;
    return { t: 'start', startAt: r.startAt, laps: r.laps, track: r.track, karts: r.karts, finished: r.finished, kstate: r.kstate };
  }

  // Use the requested color unless someone else in the room already has it.
  cleanColor(color, self) {
    const used = new Set([...this.players.values()].filter((p) => p !== self).map((p) => p.color));
    if (COLORS.includes(color) && !used.has(color)) return color;
    return COLORS.find((c) => !used.has(c)) || COLORS[0];
  }

  connectedHumans() {
    return [...this.players.values()].filter((p) => p.conn);
  }

  removePlayer(player) {
    clearTimeout(player.dropTimer);
    if (!this.players.delete(player.id)) return;
    if (this.state === 'racing') this.maybeEndRace();
    this.pushRoom();
  }

  startRace() {
    const humans = this.connectedHumans();
    const botCount = Math.max(0, Math.min(this.settings.bots, MAX_KARTS - humans.length));
    const karts = humans.map((p) => ({ id: p.id, name: p.name, color: p.color, bot: false }));
    const usedColors = new Set(karts.map((k) => k.color));
    const freeColors = COLORS.filter((c) => !usedColors.has(c));
    for (let i = 0; i < botCount; i++) {
      karts.push({ id: 'bot' + i, name: BOT_NAMES[i], color: freeColors[i % Math.max(1, freeColors.length)] || COLORS[i], bot: true });
    }
    // Humans start at the back of the grid, like the real thing.
    karts.reverse();
    karts.forEach((k, i) => (k.grid = i));
    for (const p of this.players.values()) p.inRace = !!p.conn;
    this.state = 'racing';
    this.race = {
      startAt: this.now() + COUNTDOWN_MS,
      laps: this.settings.laps,
      track: this.settings.track,
      karts,
      finished: [],
      kstate: {},
    };
    this.broadcast(this.startInfo());
    this.pushRoom();
  }

  maybeEndRace() {
    if (!this.race || this.state !== 'racing') return;
    const done = new Set(this.race.finished.map((f) => f.id));
    const racing = [...this.players.values()].filter((p) => p.inRace && p.conn);
    if (racing.length === 0 || racing.every((p) => done.has(p.id))) this.endRace();
  }

  endRace() {
    const race = this.race;
    if (!race || this.state !== 'racing') return;
    clearTimeout(this.resultsTimer);
    this.resultsTimer = null;
    const done = new Set(race.finished.map((f) => f.id));
    const rest = race.karts
      .filter((k) => !done.has(k.id))
      .sort((a, b) => (race.kstate[b.id]?.p ?? -1e9) - (race.kstate[a.id]?.p ?? -1e9));
    const byId = new Map(race.karts.map((k) => [k.id, k]));
    const standings = [
      ...race.finished.map((f) => ({ ...byId.get(f.id), time: f.time })),
      ...rest.map((k) => ({ ...k, time: null })),
    ];
    this.state = 'results';
    for (const p of this.players.values()) p.inRace = false;
    this.broadcast({ t: 'results', standings });
    this.pushRoom();
  }

  ownsKart(player, id) {
    if (id === player.id) return true;
    return player.id === this.hostId && typeof id === 'string' && id.startsWith('bot');
  }

  // ------------------------------------------------------------ messages

  handle(conn, msg) {
    if (this.closed || !msg || typeof msg !== 'object') return;
    const c = this.conns.get(conn);
    if (!c) return;
    c.lastHeard = this.now();

    if (msg.t === 'ping') {
      this.send(conn, { t: 'pong', c: msg.c, s: this.now() });
      return;
    }

    if (msg.t === 'create' || msg.t === 'join' || msg.t === 'rejoin') {
      if (c.player) return;
      if (msg.t === 'join' && String(msg.code || '').toUpperCase() !== this.code) {
        this.send(conn, { t: 'error', code: 'noroom', msg: "That race doesn't exist anymore. Ask your friend for a new link." });
        return;
      }
      if (msg.t === 'rejoin') {
        const p = this.players.get(msg.id);
        if (!p || p.token !== msg.token) {
          this.send(conn, { t: 'error', code: 'norejoin', msg: 'Seat expired' });
          return;
        }
        if (p.conn && p.conn !== conn) {
          const old = p.conn;
          this.conns.delete(old);
          try {
            old.close();
          } catch {}
        }
        clearTimeout(p.dropTimer);
        p.conn = conn;
        c.player = p;
        this.send(conn, { t: 'welcome', id: p.id, token: p.token, code: this.code });
        if (this.state === 'racing' && p.inRace) this.send(conn, this.startInfo());
        this.pushRoom();
        return;
      }
      if (this.players.size >= MAX_PLAYERS) {
        this.send(conn, { t: 'error', code: 'full', msg: 'That race is full.' });
        return;
      }
      const p = {
        id: (msg.t === 'create' && msg.id) || 'p' + randomHex(4),
        token: (msg.t === 'create' && msg.token) || randomHex(12),
        name: cleanName(msg.name),
        color: null,
        conn,
        inRace: false,
        dropTimer: null,
      };
      p.color = this.cleanColor(msg.color);
      this.players.set(p.id, p);
      if (msg.t === 'create' || !this.hostId) this.hostId = p.id;
      c.player = p;
      this.send(conn, { t: 'welcome', id: p.id, token: p.token, code: this.code });
      this.pushRoom();
      return;
    }

    const player = c.player;
    if (!player) return;
    const isHost = this.hostId === player.id;

    switch (msg.t) {
      case 's': {
        // Kart state, ~15 times a second. Remember progress for standings and relay.
        if (this.state !== 'racing' || !player.inRace || !Array.isArray(msg.k)) return;
        const out = [];
        for (const k of msg.k.slice(0, MAX_KARTS)) {
          if (!k || !this.ownsKart(player, k.id)) continue;
          const clean = {
            id: k.id, ts: num(k.ts), x: num(k.x), z: num(k.z), h: num(k.h), s: num(k.s), p: num(k.p),
            sp: num(k.sp), st: num(k.st), b: num(k.b), dd: num(k.dd), dc: num(k.dc), hop: num(k.hop),
          };
          this.race.kstate[k.id] = clean;
          out.push(clean);
        }
        if (out.length) this.broadcast({ t: 's', k: out }, player.id);
        return;
      }
      case 'e': {
        // Item events (box taken, item spawned, item hit).
        if (this.state !== 'racing') return;
        const ev = { t: 'e', type: String(msg.type), from: player.id };
        for (const key of ['i', 'hid', 'kind', 'x', 'z', 'vx', 'vz', 'owner']) {
          if (msg[key] !== undefined) ev[key] = typeof msg[key] === 'number' ? num(msg[key]) : String(msg[key]).slice(0, 40);
        }
        this.broadcast(ev, player.id);
        return;
      }
      case 'finish': {
        if (this.state !== 'racing' || !this.ownsKart(player, msg.id)) return;
        const race = this.race;
        const kart = race.karts.find((k) => k.id === msg.id);
        if (!kart || race.finished.some((f) => f.id === msg.id)) return;
        race.finished.push({ id: msg.id, time: Math.max(0, num(msg.time)) });
        this.broadcast({ t: 'fin', id: msg.id, time: num(msg.time), place: race.finished.length });
        if (!kart.bot && !this.resultsTimer) {
          this.resultsTimer = setTimeout(() => {
            this.resultsTimer = null;
            this.endRace();
          }, RESULTS_TIMEOUT_MS);
        }
        this.maybeEndRace();
        return;
      }
      case 'profile': {
        if (this.state !== 'lobby') return;
        if (msg.name !== undefined) player.name = cleanName(msg.name);
        if (msg.color !== undefined) player.color = this.cleanColor(msg.color, player);
        this.pushRoom();
        return;
      }
      case 'settings': {
        if (!isHost || this.state !== 'lobby') return;
        const s = this.settings;
        if (msg.laps !== undefined) s.laps = Math.max(1, Math.min(5, Math.round(num(msg.laps)) || 3));
        if (msg.bots !== undefined) s.bots = Math.max(0, Math.min(6, Math.round(num(msg.bots))));
        if (msg.track !== undefined && TRACKS.includes(msg.track)) s.track = msg.track;
        this.pushRoom();
        return;
      }
      case 'startRace': {
        if (isHost && this.state === 'lobby') this.startRace();
        return;
      }
      case 'toLobby': {
        if (!isHost) return;
        if (this.state === 'racing') this.endRace();
        this.state = 'lobby';
        this.race = null;
        this.pushRoom();
        return;
      }
      case 'leave': {
        c.player = null;
        if (isHost) {
          // The room lives on the host's phone, so it ends when the host leaves.
          this.broadcast({ t: 'error', code: 'hostleft', msg: 'The host left, so the race is over.' }, player.id);
          this.close();
          return;
        }
        this.removePlayer(player);
        return;
      }
    }
  }
}
