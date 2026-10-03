// Bullets and grenades. Pure math on the map grid and soldier positions, used by
// your phone for your own shots and by the host's phone for the bots' shots.

import { hitSoldier, forward, chest } from './player.js';
import { damageAt, NADE } from './weapons.js';

// Is `other` someone `shooter` can hurt?
export function hostile(mode, shooter, other) {
  if (other.id === shooter.id) return false;
  return mode !== 'tdm' || other.team !== shooter.team;
}

// One ray from (o) along (yaw, pitch) with random spread. Teammates don't block bullets.
// ents: [{ id, team, alive, view }]. Returns { t, x, y, z, ent, head, nx, ny, nz }.
export function trace(grid, ents, shooter, mode, o, yaw, pitch, spread, rnd, maxT = 160) {
  // Random point in a cone.
  const a = rnd() * Math.PI * 2;
  const r = Math.sqrt(rnd()) * spread;
  const yaw2 = yaw + Math.cos(a) * r;
  const pitch2 = pitch + Math.sin(a) * r;
  const [dx, dy, dz] = forward(yaw2, pitch2);
  const wall = grid.raycast(o[0], o[1], o[2], dx, dy, dz, maxT);
  let best = wall ? { ...wall, ent: null, head: false } : { t: maxT, x: o[0] + dx * maxT, y: o[1] + dy * maxT, z: o[2] + dz * maxT, ent: null, head: false, nx: 0, ny: 0, nz: 0 };
  for (const e of ents) {
    if (!e.alive || !hostile(mode, shooter, e)) continue;
    const h = hitSoldier(o[0], o[1], o[2], dx, dy, dz, e.view, best.t);
    if (h) best = { t: h.t, x: o[0] + dx * h.t, y: o[1] + dy * h.t, z: o[2] + dz * h.t, ent: e, head: h.head, nx: -dx, ny: -dy, nz: -dz };
  }
  best.dx = dx;
  best.dy = dy;
  best.dz = dz;
  return best;
}

// Fire one shot of weapon `w` (all pellets). Returns { rays, hits: [{ ent, dmg, head }] }.
export function shoot(grid, ents, shooter, mode, o, yaw, pitch, w, spread, rnd) {
  const rays = [];
  const byEnt = new Map();
  for (let i = 0; i < w.pellets; i++) {
    const r = trace(grid, ents, shooter, mode, o, yaw, pitch, i === 0 && w.pellets > 1 ? spread * 0.3 : spread, rnd);
    rays.push(r);
    if (!r.ent) continue;
    const dmg = damageAt(w, r.t) * (r.head ? w.headMul : 1);
    const cur = byEnt.get(r.ent) || { ent: r.ent, dmg: 0, head: false };
    cur.dmg += dmg;
    cur.head = cur.head || r.head;
    byEnt.set(r.ent, cur);
  }
  return { rays, hits: [...byEnt.values()].map((h) => ({ ...h, dmg: Math.round(h.dmg) })) };
}

// What the crosshair is on right now (no spread): used for auto-fire and enemy names.
export function aimTarget(grid, ents, shooter, mode, o, yaw, pitch, maxT) {
  const r = trace(grid, ents, shooter, mode, o, yaw, pitch, 0, () => 0, maxT);
  return r.ent ? r : null;
}

// ------------------------------------------------------------------ grenades

export class Grenade {
  constructor(grid, owner, x, y, z, vx, vy, vz, fuse = NADE.fuse) {
    this.grid = grid;
    this.owner = owner;
    Object.assign(this, { x, y, z, vx, vy, vz, fuse });
    this.done = false;
    this.bounces = 0;
    this.rest = false;
  }

  static throwFrom(grid, owner, eye, yaw, pitch) {
    const p = Math.min(1.2, pitch + 0.25);
    const [dx, dy, dz] = forward(yaw, p);
    // Start a little in front of the thrower, but never inside a wall.
    let sx = eye[0] + dx * 0.4;
    let sz = eye[2] + dz * 0.4;
    if (grid.colAt(Math.floor(sx), Math.floor(sz)) > eye[1] - 0.2) {
      sx = eye[0];
      sz = eye[2];
    }
    return new Grenade(grid, owner, sx, eye[1] - 0.15, sz, dx * NADE.speed, dy * NADE.speed + 1.5, dz * NADE.speed);
  }

  // Returns 'bounce' when it hits something, 'boom' when it explodes.
  update(dt) {
    if (this.done) return null;
    this.fuse -= dt;
    if (this.fuse <= 0) {
      this.done = true;
      return 'boom';
    }
    if (this.rest) return null;
    const g = this.grid;
    let ev = null;
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy, this.vz) * dt) / 0.15));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vy -= 20 * sdt;
      const nx = this.x + this.vx * sdt;
      const ny = this.y + this.vy * sdt;
      const nz = this.z + this.vz * sdt;
      const hx = g.rayAt(Math.floor(nx), Math.floor(this.z));
      const hz = g.rayAt(Math.floor(this.x), Math.floor(nz));
      if (ny < hx && Math.floor(nx) !== Math.floor(this.x)) {
        this.vx *= -0.45;
        ev = 'bounce';
      } else this.x = nx;
      if (ny < hz && Math.floor(nz) !== Math.floor(this.z)) {
        this.vz *= -0.45;
        ev = 'bounce';
      } else this.z = nz;
      const floor = g.rayAt(Math.floor(this.x), Math.floor(this.z));
      if (ny <= floor + 0.08) {
        this.y = floor + 0.08;
        if (Math.abs(this.vy) > 2) ev = 'bounce';
        this.vy = Math.abs(this.vy) * 0.35;
        this.vx *= 0.6;
        this.vz *= 0.6;
        if (this.vy < 1.2 && Math.hypot(this.vx, this.vz) < 0.8) {
          this.rest = true;
          this.vx = this.vy = this.vz = 0;
          break;
        }
      } else this.y = ny;
    }
    if (ev) this.bounces++;
    return ev;
  }

  // Damage to everyone near the blast who isn't behind cover. The thrower can hurt themselves.
  blast(ents, shooter, mode) {
    const out = [];
    for (const e of ents) {
      if (!e.alive) continue;
      if (e.id !== shooter.id && !hostile(mode, shooter, e)) continue;
      const c = chest(e.view);
      const d = Math.hypot(c[0] - this.x, c[1] - this.y, c[2] - this.z);
      if (d > NADE.radius) continue;
      if (!this.grid.clear(this.x, this.y + 0.3, this.z, c[0], c[1], c[2]) && !this.grid.clear(this.x, this.y + 0.3, this.z, e.view.x, e.view.y + 1.6, e.view.z)) continue;
      const f = 1 - d / NADE.radius;
      const dmg = Math.round(NADE.dmg * (0.25 + 0.75 * f) * (e.id === shooter.id ? 0.6 : 1));
      out.push({ ent: e, dmg });
    }
    return out;
  }
}
