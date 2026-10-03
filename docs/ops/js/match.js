// A match as seen from one phone, without any drawing: everyone's soldiers,
// the ones this phone controls (you, plus the bots if you're the host),
// shooting, grenades, and smoothing out the other phones' soldiers.
// main.js draws it; the tests run it headless against a real room.
//
// Things worth showing or playing a sound for are pushed onto `events`.

import { getGrid } from './maps.js';
import { PlayerSim, hpAt, wrapAngle, MAX_HP } from './player.js';
import { WeaponState, WEAPONS } from './weapons.js';
import { shoot, Grenade, hostile } from './combat.js';
import { Bot } from './bot.js';

export const SEND_MS = 50;
export const INTERP_MS = 110;

export class Match {
  constructor(msg, { myId, isHost, send, now, rnd = Math.random }) {
    this.myId = myId;
    this.isHost = isHost;
    this.send = send;
    this.now = now;
    this.rnd = rnd;
    this.map = msg.map;
    this.grid = getGrid(msg.map);
    this.mode = msg.mode;
    this.limit = msg.limit;
    this.skill = msg.skill || 2;
    this.startAt = msg.startAt;
    this.endAt = msg.endAt;
    this.teamScore = msg.teamScore || [0, 0];
    this.ents = new Map();
    this.grenades = [];
    this.events = [];
    this.lastSend = 0;
    this.botSeed = 7;
    for (const e of msg.ents) this.addEnt(e);
  }

  get me() {
    return this.ents.get(this.myId);
  }

  list() {
    return [...this.ents.values()];
  }

  owned(e) {
    return e.id === this.myId || (this.isHost && e.bot);
  }

  addEnt(p) {
    const e = {
      ...p,
      view: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: 0, cr: 0, mv: 0, ads: 0, gr: 1 },
      snaps: [],
      sim: null,
      wpn: null,
      ai: null,
      lastFired: -1e9,
      spawnedAt: this.now(),
    };
    this.ents.set(e.id, e);
    this.claim(e);
    return e;
  }

  claim(e) {
    if (!this.owned(e) || e.sim) return;
    e.sim = new PlayerSim(this.grid, { x: e.x, y: e.y, z: e.z, yaw: e.yaw });
    e.wpn = new WeaponState(e.weapon);
    if (e.bot) e.ai = new Bot(this.grid, e.id, this.skill, (this.botSeed = (this.botSeed * 48271) % 2147483647));
  }

  hp(e) {
    return hpAt(e.hp ?? MAX_HP, e.lastHit ?? 0, this.now());
  }

  // ------------------------------------------------------------ messages from the room

  handle(msg) {
    const sNow = this.now();
    switch (msg.t) {
      case 's': {
        for (const s of msg.e) {
          const e = this.ents.get(s.id);
          if (!e || e.sim || s.l !== e.life || !e.alive) continue;
          const last = e.snaps[e.snaps.length - 1];
          if (last && s.ts <= last.ts) continue;
          e.snaps.push(s);
          if (e.snaps.length > 30) e.snaps.shift();
        }
        return;
      }
      case 'fire': {
        const e = this.ents.get(msg.id);
        if (!e || e.sim) return;
        e.lastFired = sNow;
        this.events.push({ type: 'remoteShot', ent: e, w: msg.w, hx: msg.hx, hy: msg.hy, hz: msg.hz, hit: msg.hit });
        this.alertBots(e.view.x, e.view.z, e);
        return;
      }
      case 'nade': {
        const e = this.ents.get(msg.id);
        if (!e || e.sim) return;
        const g = new Grenade(this.grid, e.id, msg.x, msg.y, msg.z, msg.vx, msg.vy, msg.vz);
        this.grenades.push({ g, mine: false });
        this.events.push({ type: 'nade', g });
        return;
      }
      case 'dmg': {
        const e = this.ents.get(msg.id);
        if (!e) return;
        e.hp = msg.hp;
        e.lastHit = msg.at;
        if (e.ai) e.ai.hurtBy(msg.by);
        if (e.id === this.myId) this.events.push({ type: 'hurt', by: this.ents.get(msg.by), hp: msg.hp, w: msg.w });
        return;
      }
      case 'kill': {
        const victim = this.ents.get(msg.victim);
        const killer = this.ents.get(msg.killer);
        if (killer) {
          killer.kills = msg.kills;
          killer.streak = msg.streak;
        }
        if (victim) {
          victim.alive = false;
          victim.deaths = msg.vdeaths;
          victim.hp = 0;
          victim.diedAt = sNow;
          victim.killedBy = msg.killer;
          if (victim.bot && victim.sim && this.rnd() < 0.3) {
            const r = this.rnd();
            const w = r < 0.35 ? 'ar' : r < 0.65 ? 'smg' : r < 0.85 ? 'shotgun' : 'sniper';
            this.send({ t: 'botLoadout', id: victim.id, weapon: w });
          }
        }
        this.teamScore = msg.teamScore;
        this.events.push({ type: 'kill', killer, victim, w: msg.w, head: msg.head, streak: msg.streak });
        return;
      }
      case 'spawn': {
        const e = this.ents.get(msg.id);
        if (e) this.spawn(e, msg);
        return;
      }
      case 'roster': {
        const seen = new Set();
        for (const p of msg.ents) {
          seen.add(p.id);
          const e = this.ents.get(p.id);
          if (!e) {
            const ne = this.addEnt(p);
            this.events.push({ type: 'joined', ent: ne });
            continue;
          }
          Object.assign(e, { name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, away: p.away });
          if (p.alive && p.life > e.life) this.spawn(e, p);
          else if (!p.alive && e.alive) e.alive = false;
        }
        for (const [id, e] of this.ents) {
          if (!seen.has(id)) {
            this.ents.delete(id);
            this.events.push({ type: 'left', ent: e });
          }
        }
        if (msg.teamScore) this.teamScore = msg.teamScore;
        return;
      }
    }
  }

  spawn(e, p) {
    Object.assign(e, { alive: true, life: p.life, weapon: p.weapon, protectUntil: p.protectUntil, hp: MAX_HP, lastHit: 0, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
    e.view = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: 0, cr: 0, mv: 0, ads: 0, gr: 1 };
    e.snaps = [];
    e.spawnedAt = this.now();
    if (e.sim) {
      e.sim.reset({ x: p.x, y: p.y, z: p.z, yaw: p.yaw });
      e.wpn.set(p.weapon);
      e.ai?.reset();
    }
    this.events.push({ type: 'spawn', ent: e });
  }

  alertBots(x, z, shooter) {
    for (const b of this.ents.values()) {
      if (!b.ai || !b.alive || b === shooter) continue;
      if (Math.hypot(b.sim.x - x, b.sim.z - z) < 38) b.ai.hear(x, z);
    }
  }

  // ------------------------------------------------------------ simulation

  // myCtl: { mx, mz, sprint, jump, crouch, ads, fire, reload, nade }; aim is set on me.sim directly.
  update(dt, myCtl) {
    const sNow = this.now();
    const started = sNow >= this.startAt;
    const all = this.list();
    for (const e of all) {
      if (!e.sim || !e.alive) continue;
      const isMe = e.id === this.myId;
      const sim = e.sim;
      const wpn = e.wpn;
      let ctl = isMe ? myCtl || {} : e.ai.think(dt, sim, wpn, { ents: all, mode: this.mode, team: e.team });
      if (!started) ctl = { ads: ctl.ads };
      sim.update(dt, { ...ctl, speedMul: wpn.w.move });
      for (const ev of sim.events) if (isMe) this.events.push({ type: ev });
      sim.events.length = 0;
      const ads = !!ctl.ads && !sim.sprinting;
      if (wpn.update(dt, ads) === 'reloaded' && isMe) this.events.push({ type: 'reloaded' });
      if ((ctl.reload || (wpn.ammo === 0 && wpn.cooldown <= 0)) && wpn.startReload()) this.events.push({ type: 'reload', ent: e, mine: isMe });
      if (ctl.fire && !sim.sprinting && wpn.canFire()) {
        wpn.fire();
        this.fire(e, all);
      } else if (ctl.fire && isMe && wpn.ammo === 0 && wpn.reloading <= 0 && wpn.cooldown <= 0) {
        this.events.push({ type: 'dry' });
      }
      if (ctl.nade && wpn.nades > 0 && started) {
        wpn.nades--;
        const g = Grenade.throwFrom(this.grid, e.id, [sim.x, sim.eye(), sim.z], sim.yaw, sim.pitch);
        this.grenades.push({ g, mine: true });
        this.send({ t: 'nade', id: e.id, x: r2(g.x), y: r2(g.y), z: r2(g.z), vx: r2(g.vx), vy: r2(g.vy), vz: r2(g.vz) });
        this.events.push({ type: 'nade', g, mine: isMe });
      }
      e.view = sim.snapshot();
      e.view.ads = wpn.adsT;
    }

    // Grenades
    for (const n of this.grenades) {
      const ev = n.g.update(dt);
      if (ev === 'bounce') this.events.push({ type: 'bounce', g: n.g });
      if (ev !== 'boom') continue;
      this.events.push({ type: 'boom', g: n.g });
      const thrower = this.ents.get(n.g.owner);
      if (n.mine && thrower) {
        for (const h of n.g.blast(all, thrower, this.mode)) {
          this.send({ t: 'hit', id: thrower.id, target: h.ent.id, dmg: h.dmg, head: false, w: 'nade' });
          if (thrower.id === this.myId && h.ent !== thrower) this.events.push({ type: 'hitmarker', ent: h.ent, head: false });
        }
      }
      this.alertBots(n.g.x, n.g.z, null);
    }
    this.grenades = this.grenades.filter((n) => !n.g.done);

    // Tell everyone where our soldiers are.
    if (sNow - this.lastSend >= SEND_MS) {
      this.lastSend = sNow;
      const out = [];
      for (const e of all) {
        if (!e.sim || !e.alive) continue;
        const v = e.view;
        out.push({
          id: e.id, l: e.life, ts: Math.round(sNow), x: r2(v.x), y: r2(v.y), z: r2(v.z), yaw: r3(v.yaw), pitch: r3(v.pitch),
          cr: r2(v.cr), mv: r2(v.mv), ads: r2(v.ads), gr: v.gr,
        });
      }
      if (out.length) this.send({ t: 's', e: out });
    }

    // Everyone else, smoothed.
    const renderT = sNow - INTERP_MS;
    for (const e of all) if (!e.sim && e.alive) e.view = interpolate(e, renderT);
  }

  fire(e, all) {
    const sim = e.sim;
    const wpn = e.wpn;
    const w = wpn.w;
    const isMe = e.id === this.myId;
    const eye = [sim.x, sim.eye(), sim.z];
    const { rays, hits } = shoot(this.grid, all, e, this.mode, eye, sim.yaw, sim.pitch, w, wpn.spread(), this.rnd);
    for (const h of hits) {
      this.send({ t: 'hit', id: e.id, target: h.ent.id, dmg: h.dmg, head: h.head, w: w.id });
      if (isMe) this.events.push({ type: 'hitmarker', ent: h.ent, head: h.head, dmg: h.dmg });
    }
    const r = rays[0];
    this.send({ t: 'fire', id: e.id, w: w.id, hx: r2(r.x), hy: r2(r.y), hz: r2(r.z), hit: r.ent ? 1 : 0 });
    this.events.push({ type: 'shot', ent: e, rays, mine: isMe, w });
    e.lastFired = this.now();
    // Recoil kicks the aim up (bots fight it like anyone else).
    const k = w.recoil * (1 - 0.45 * wpn.adsT);
    sim.pitch = Math.min(1.4, sim.pitch + k * (0.75 + this.rnd() * 0.5));
    sim.yaw += (this.rnd() - 0.5) * k * 0.6;
    this.alertBots(sim.x, sim.z, e);
  }

  // Enemies within a cone of the crosshair, for gentle aim assist.
  assistTarget(e, maxAngle) {
    const sim = e.sim;
    let best = null;
    let bestA = maxAngle;
    const eyeY = sim.eye();
    for (const o of this.ents.values()) {
      if (!o.alive || !hostile(this.mode, e, o)) continue;
      const v = o.view;
      const tx = v.x - sim.x;
      const ty = v.y + 1.2 - (v.cr || 0) * 0.4 - eyeY;
      const tz = v.z - sim.z;
      const d = Math.hypot(tx, tz);
      if (d > 60) continue;
      const yawTo = Math.atan2(-tx, -tz);
      const pitchTo = Math.atan2(ty, d);
      const a = Math.hypot(wrapAngle(yawTo - sim.yaw), pitchTo - sim.pitch);
      if (a < bestA && this.grid.clear(sim.x, eyeY, sim.z, v.x, v.y + 1.2, v.z)) {
        bestA = a;
        best = { ent: o, yaw: yawTo, pitch: pitchTo, angle: a, dist: d };
      }
    }
    return best;
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Where another phone's soldier was INTERP_MS ago, blended between updates.
export function interpolate(e, t) {
  const s = e.snaps;
  if (!s.length) return e.view;
  while (s.length > 2 && s[1].ts <= t) s.shift();
  const a = s[0];
  const b = s[1];
  if (!b || t <= a.ts) return { ...a };
  if (t >= b.ts) {
    // Ran out of updates: carry on a little in the same direction.
    const over = Math.min(0.15, (t - b.ts) / 1000);
    const span = Math.max(0.001, (b.ts - a.ts) / 1000);
    return { ...b, x: b.x + ((b.x - a.x) / span) * over, z: b.z + ((b.z - a.z) / span) * over };
  }
  const f = (t - a.ts) / (b.ts - a.ts);
  const lerp = (p, q) => p + (q - p) * f;
  return {
    ...b,
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    z: lerp(a.z, b.z),
    yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * f,
    pitch: lerp(a.pitch, b.pitch),
    cr: lerp(a.cr, b.cr),
    mv: lerp(a.mv, b.mv),
    ads: lerp(a.ads, b.ads),
  };
}

export { WEAPONS };
