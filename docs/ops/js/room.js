// The match room. It runs inside the host's browser: the host's phone keeps the
// lobby, team assignments, health, kills, scores, spawns and the match clock,
// and relays each phone's soldier data to the others. Guests reach it over a
// peer-to-peer link. Each phone moves its own soldier and decides what its own
// bullets hit (so aiming feels instant); the room applies the damage.
//
// A connection is any object with send(msg) and close().

import { getGrid, MAP_IDS } from './maps.js';
import { WEAPON_IDS, MAX_HIT } from './weapons.js';
import { hpAt, MAX_HP, EYE } from './player.js';

const MAX_PLAYERS = 8;
const MAX_ENTS = 12;
const LOBBY_GRACE_MS = 3 * 60 * 1000; // keep a player's seat while they're away from the game
const MATCH_GRACE_MS = 90 * 1000;
const SILENT_MS = 12 * 1000; // a guest that sent nothing for this long has lost its connection
export const COUNTDOWN_MS = 3500;
export const RESPAWN_MS = 3000;
export const PROTECT_MS = 1500;
export const LIMITS = { ffa: [10, 20, 30], tdm: [25, 50, 75] };
export const TIMES = [3, 5, 10];
const BOT_NAMES = ['Ghost', 'Viper', 'Havoc', 'Reaper', 'Nomad', 'Blitz', 'Talon', 'Raven', 'Spectre', 'Bishop'];
export const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292'];
export const TEAM_COLORS = ['#2f7de1', '#e0412f'];

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
  return s || 'Soldier';
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class Room {
  constructor(code, { now = () => Date.now(), respawnMs = RESPAWN_MS, countdownMs = COUNTDOWN_MS, random = Math.random } = {}) {
    this.code = code;
    this.now = now;
    this.respawnMs = respawnMs;
    this.countdownMs = countdownMs;
    this.random = random;
    this.hostId = null;
    this.state = 'lobby';
    this.settings = { map: 'dust', mode: 'tdm', bots: 3, skill: 2, limit: LIMITS.tdm[1], time: 5 };
    this.players = new Map();
    this.conns = new Map(); // connection -> { player, lastHeard }
    this.match = null;
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
    this.setAway(player, true);
    player.dropTimer = setTimeout(() => this.removePlayer(player), this.state === 'lobby' ? LOBBY_GRACE_MS : MATCH_GRACE_MS);
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
    this.stopMatchTimers();
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
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, weapon: p.weapon, connected: !!p.conn })),
    };
  }

  pushRoom() {
    if (!this.closed) this.broadcast(this.info());
  }

  cleanColor(color, self) {
    const used = new Set([...this.players.values()].filter((p) => p !== self).map((p) => p.color));
    if (COLORS.includes(color) && !used.has(color)) return color;
    return COLORS.find((c) => !used.has(c)) || COLORS[0];
  }

  removePlayer(player) {
    clearTimeout(player.dropTimer);
    if (!this.players.delete(player.id)) return;
    const m = this.match;
    if (m && m.ents.has(player.id)) {
      const e = m.ents.get(player.id);
      clearTimeout(e.spawnTimer);
      m.ents.delete(player.id);
      this.pushRoster();
    }
    if (this.state === 'playing' && ![...this.players.values()].some((p) => p.conn)) this.endMatch();
    this.pushRoom();
  }

  // ------------------------------------------------------------ match

  pub(e) {
    return {
      id: e.id, name: e.name, color: e.color, team: e.team, bot: e.bot, weapon: e.weapon, alive: e.alive, life: e.life,
      kills: e.kills, deaths: e.deaths, away: e.away, hp: e.hp, lastHit: e.lastHit, protectUntil: e.protectUntil,
      x: e.x, y: e.y, z: e.z, yaw: e.yaw,
    };
  }

  startInfo() {
    const m = this.match;
    return {
      t: 'start', startAt: m.startAt, endAt: m.endAt, map: m.map, mode: m.mode, limit: m.limit, skill: m.skill,
      ents: [...m.ents.values()].map((e) => this.pub(e)), teamScore: m.teamScore,
    };
  }

  pushRoster() {
    const m = this.match;
    if (m) this.broadcast({ t: 'roster', ents: [...m.ents.values()].map((e) => this.pub(e)), teamScore: m.teamScore });
  }

  newEnt(fields) {
    return {
      team: 0, bot: false, weapon: 'ar', nextWeapon: null, alive: false, life: 0, kills: 0, deaths: 0, streak: 0,
      hp: MAX_HP, lastHit: 0, protectUntil: 0, x: 0, y: 0, z: 0, yaw: 0, away: false, spawnTimer: null,
      ...fields,
    };
  }

  teamCounts() {
    const c = [0, 0];
    for (const e of this.match.ents.values()) c[e.team]++;
    return c;
  }

  startMatch() {
    const s = this.settings;
    const humans = [...this.players.values()].filter((p) => p.conn);
    const now = this.now();
    this.match = {
      map: s.map, mode: s.mode, limit: s.limit, skill: s.skill,
      startAt: now + this.countdownMs,
      endAt: now + this.countdownMs + s.time * 60 * 1000,
      ents: new Map(), teamScore: [0, 0], timer: null,
    };
    const m = this.match;
    const order = humans.slice().sort(() => this.random() - 0.5);
    order.forEach((p, i) => m.ents.set(p.id, this.newEnt({ id: p.id, name: p.name, color: p.color, weapon: p.weapon, team: i % 2 })));
    const bots = Math.max(0, Math.min(s.bots, MAX_ENTS - humans.length));
    const names = BOT_NAMES.slice().sort(() => this.random() - 0.5);
    const usedColors = new Set(humans.map((p) => p.color));
    const freeColors = COLORS.filter((c) => !usedColors.has(c));
    for (let i = 0; i < bots; i++) {
      const counts = this.teamCounts();
      m.ents.set('bot' + i, this.newEnt({
        id: 'bot' + i, name: names[i % names.length], bot: true, team: counts[0] <= counts[1] ? 0 : 1,
        color: freeColors[i % Math.max(1, freeColors.length)] || COLORS[i % COLORS.length],
        weapon: ['ar', 'smg', 'ar', 'shotgun', 'smg', 'sniper'][i % 6],
      }));
    }
    this.state = 'playing';
    m.taken = new Set();
    for (const e of m.ents.values()) this.spawn(e, m.startAt, true);
    m.taken = null;
    m.timer = setTimeout(() => this.endMatch(), m.endAt - now);
    this.broadcast(this.startInfo());
    this.pushRoom();
  }

  // Pick a spawn point away from enemies (and out of their sight), with a little randomness.
  pickSpawn(e, first) {
    const m = this.match;
    const grid = getGrid(m.map);
    const tdm = m.mode === 'tdm';
    let cands = grid.spawns;
    if (first) {
      const own = cands.filter((s) => (tdm ? s.team === e.team : s.team !== null));
      cands = own.filter((s) => !m.taken.has(s)).length ? own.filter((s) => !m.taken.has(s)) : own;
    }
    const enemies = [...m.ents.values()].filter((o) => o !== e && o.alive && (!tdm || o.team !== e.team));
    const friends = tdm ? [...m.ents.values()].filter((o) => o !== e && o.alive && o.team === e.team) : [];
    const scored = cands.map((s) => {
      let minD = 60;
      let seen = false;
      for (const o of enemies) {
        const d = Math.hypot(o.x - s.x, o.z - s.z);
        minD = Math.min(minD, d);
        if (d < 40 && grid.clear(o.x, o.y + EYE, o.z, s.x, s.y + 1.2, s.z)) seen = true;
      }
      let score = minD - (seen ? 25 : 0) + this.random() * 6;
      if (tdm && s.team === e.team) score += 6;
      if (tdm && friends.some((f) => Math.hypot(f.x - s.x, f.z - s.z) < 14)) score += 4;
      return { s, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[Math.floor(this.random() * Math.min(first ? scored.length : 2, scored.length))].s;
    m.taken?.add(pick);
    return pick;
  }

  spawn(e, at, first = false) {
    const m = this.match;
    if (!m || e.away) return;
    clearTimeout(e.spawnTimer);
    e.spawnTimer = null;
    const s = this.pickSpawn(e, first);
    if (e.nextWeapon) e.weapon = e.nextWeapon;
    e.nextWeapon = null;
    Object.assign(e, { alive: true, hp: MAX_HP, lastHit: 0, life: e.life + 1, x: s.x, y: s.y, z: s.z, yaw: s.yaw, protectUntil: at + PROTECT_MS });
    if (!first) this.broadcast({ t: 'spawn', ...this.pub(e) });
  }

  queueSpawn(e) {
    clearTimeout(e.spawnTimer);
    e.spawnTimer = setTimeout(() => {
      if (this.match && this.state === 'playing' && this.match.ents.get(e.id) === e && !e.alive) this.spawn(e, this.now());
    }, this.respawnMs);
  }

  setAway(player, away) {
    const m = this.match;
    const e = m && m.ents.get(player.id);
    if (!e || e.away === away) return;
    e.away = away;
    if (away) {
      clearTimeout(e.spawnTimer);
      e.alive = false;
    } else if (!e.alive && this.state === 'playing') {
      this.queueSpawn(e);
    }
    this.pushRoster();
  }

  addLateJoiner(p) {
    const m = this.match;
    if (!m || m.ents.has(p.id) || m.ents.size >= MAX_ENTS + 2) return;
    const counts = this.teamCounts();
    const e = this.newEnt({ id: p.id, name: p.name, color: p.color, weapon: p.weapon, team: counts[0] <= counts[1] ? 0 : 1 });
    m.ents.set(p.id, e);
    this.spawn(e, Math.max(this.now(), m.startAt), m.startAt > this.now());
    this.pushRoster();
  }

  stopMatchTimers() {
    const m = this.match;
    if (!m) return;
    clearTimeout(m.timer);
    for (const e of m.ents.values()) clearTimeout(e.spawnTimer);
  }

  endMatch() {
    const m = this.match;
    if (!m || this.state !== 'playing') return;
    this.stopMatchTimers();
    const board = [...m.ents.values()]
      .map((e) => ({ id: e.id, name: e.name, color: e.color, team: e.team, bot: e.bot, kills: e.kills, deaths: e.deaths }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    let winner = null;
    if (m.mode === 'tdm') winner = m.teamScore[0] === m.teamScore[1] ? -1 : m.teamScore[0] > m.teamScore[1] ? 0 : 1;
    else if (board.length) winner = board.length > 1 && board[1].kills === board[0].kills ? null : board[0].id;
    this.state = 'results';
    this.broadcast({ t: 'results', board, teamScore: m.teamScore, mode: m.mode, winner });
    this.pushRoom();
  }

  ownsEnt(player, id) {
    if (id === player.id) return true;
    return player.id === this.hostId && typeof id === 'string' && id.startsWith('bot');
  }

  applyHit(player, msg) {
    const m = this.match;
    const now = this.now();
    if (!m || now < m.startAt) return;
    const shooter = m.ents.get(msg.id);
    const target = m.ents.get(msg.target);
    if (!shooter || !target || !this.ownsEnt(player, shooter.id)) return;
    const nade = msg.w === 'nade';
    if (!shooter.alive && !nade) return;
    if (!target.alive || now < target.protectUntil) return;
    if (shooter === target && !nade) return;
    if (m.mode === 'tdm' && shooter !== target && shooter.team === target.team) return;
    const dmg = Math.max(0, Math.min(MAX_HIT, num(msg.dmg)));
    if (!dmg) return;
    target.hp = Math.max(0, hpAt(target.hp, target.lastHit, now) - dmg);
    target.lastHit = now;
    const head = !!msg.head;
    if (target.hp > 0) {
      this.broadcast({ t: 'dmg', id: target.id, by: shooter.id, hp: target.hp, at: now, head, w: String(msg.w).slice(0, 10) });
      return;
    }
    target.alive = false;
    target.deaths++;
    target.streak = 0;
    if (shooter !== target) {
      shooter.kills++;
      shooter.streak++;
      if (m.mode === 'tdm') m.teamScore[shooter.team]++;
    }
    this.broadcast({
      t: 'kill', killer: shooter.id, victim: target.id, w: String(msg.w).slice(0, 10), head,
      kills: shooter.kills, streak: shooter === target ? 0 : shooter.streak, vdeaths: target.deaths, teamScore: m.teamScore,
    });
    this.queueSpawn(target);
    const won = m.mode === 'tdm' ? m.teamScore[shooter.team] >= m.limit : shooter.kills >= m.limit;
    if (won) this.endMatch();
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
        this.send(conn, { t: 'error', code: 'noroom', msg: "That match doesn't exist anymore. Ask your friend for a new link." });
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
        if (this.state === 'playing') {
          if (!this.match.ents.has(p.id)) this.addLateJoiner(p);
          this.setAway(p, false);
          this.send(conn, this.startInfo());
        }
        this.pushRoom();
        return;
      }
      if (this.players.size >= MAX_PLAYERS) {
        this.send(conn, { t: 'error', code: 'full', msg: 'That match is full.' });
        return;
      }
      const p = {
        id: (msg.t === 'create' && msg.id) || 'p' + randomHex(4),
        token: (msg.t === 'create' && msg.token) || randomHex(12),
        name: cleanName(msg.name),
        color: null,
        weapon: WEAPON_IDS.includes(msg.weapon) ? msg.weapon : 'ar',
        conn,
        dropTimer: null,
      };
      p.color = this.cleanColor(msg.color);
      this.players.set(p.id, p);
      if (msg.t === 'create' || !this.hostId) this.hostId = p.id;
      c.player = p;
      this.send(conn, { t: 'welcome', id: p.id, token: p.token, code: this.code });
      if (this.state === 'playing') {
        // Jump straight into the match in progress.
        this.addLateJoiner(p);
        this.send(conn, this.startInfo());
      }
      this.pushRoom();
      return;
    }

    const player = c.player;
    if (!player) return;
    const isHost = this.hostId === player.id;
    const m = this.match;
    const playing = this.state === 'playing' && m;

    switch (msg.t) {
      case 's': {
        // Soldier state, ~20 times a second. Remember where everyone is (for spawns) and relay.
        if (!playing || !Array.isArray(msg.e)) return;
        const out = [];
        for (const s of msg.e.slice(0, MAX_ENTS)) {
          if (!s || !this.ownsEnt(player, s.id)) continue;
          const e = m.ents.get(s.id);
          if (!e || !e.alive || num(s.l) !== e.life) continue;
          const clean = {
            id: s.id, l: e.life, ts: num(s.ts), x: num(s.x), y: num(s.y), z: num(s.z), yaw: num(s.yaw), pitch: num(s.pitch),
            cr: num(s.cr), mv: num(s.mv), ads: num(s.ads), gr: num(s.gr),
          };
          e.x = clean.x;
          e.y = clean.y;
          e.z = clean.z;
          e.yaw = clean.yaw;
          out.push(clean);
        }
        if (out.length) this.broadcast({ t: 's', e: out }, player.id);
        return;
      }
      case 'fire':
      case 'nade': {
        // Tracers, muzzle flashes and grenades, for everyone else to see.
        if (!playing || !this.ownsEnt(player, msg.id)) return;
        const e = m.ents.get(msg.id);
        if (!e || !e.alive) return;
        const ev = { t: msg.t, id: msg.id };
        for (const key of ['w', 'x', 'y', 'z', 'hx', 'hy', 'hz', 'vx', 'vy', 'vz', 'n', 'hit']) {
          if (msg[key] !== undefined) ev[key] = typeof msg[key] === 'number' ? num(msg[key]) : String(msg[key]).slice(0, 12);
        }
        this.broadcast(ev, player.id);
        return;
      }
      case 'hit': {
        if (playing) this.applyHit(player, msg);
        return;
      }
      case 'loadout': {
        if (!WEAPON_IDS.includes(msg.weapon)) return;
        player.weapon = msg.weapon;
        const e = m && m.ents.get(player.id);
        if (e) e.nextWeapon = msg.weapon;
        this.pushRoom();
        return;
      }
      case 'botLoadout': {
        // Bots switch weapons between lives too.
        if (!playing || !isHost || !WEAPON_IDS.includes(msg.weapon)) return;
        const e = m.ents.get(msg.id);
        if (e && e.bot) e.nextWeapon = msg.weapon;
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
        if (msg.map !== undefined && MAP_IDS.includes(msg.map)) s.map = msg.map;
        if (msg.mode !== undefined && (msg.mode === 'ffa' || msg.mode === 'tdm') && msg.mode !== s.mode) {
          s.mode = msg.mode;
          s.limit = LIMITS[s.mode][1];
        }
        if (msg.bots !== undefined) s.bots = Math.max(0, Math.min(9, Math.round(num(msg.bots))));
        if (msg.skill !== undefined) s.skill = Math.max(1, Math.min(3, Math.round(num(msg.skill))));
        if (msg.limit !== undefined && LIMITS[s.mode].includes(msg.limit)) s.limit = msg.limit;
        if (msg.time !== undefined && TIMES.includes(msg.time)) s.time = msg.time;
        this.pushRoom();
        return;
      }
      case 'startMatch': {
        if (isHost && this.state === 'lobby') this.startMatch();
        return;
      }
      case 'endMatch': {
        if (isHost && this.state === 'playing') this.endMatch();
        return;
      }
      case 'toLobby': {
        if (!isHost) return;
        if (this.state === 'playing') this.endMatch();
        this.stopMatchTimers();
        this.state = 'lobby';
        this.match = null;
        this.pushRoom();
        return;
      }
      case 'leave': {
        c.player = null;
        if (isHost) {
          // The room lives on the host's phone, so it ends when the host leaves.
          this.broadcast({ t: 'error', code: 'hostleft', msg: 'The host left, so the match is over.' }, player.id);
          this.close();
          return;
        }
        this.removePlayer(player);
        return;
      }
    }
  }
}
