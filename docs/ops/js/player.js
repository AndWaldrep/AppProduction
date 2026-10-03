// Soldier movement and hitboxes. Shared by your own soldier and the bots.
// Yaw 0 looks toward -z (north); yaw grows turning left, like Three.js cameras.

import { STEP } from './grid.js';

export const RADIUS = 0.32;
export const EYE = 1.6;
export const EYE_CROUCH = 1.08;
export const GRAVITY = 22;
export const JUMP_V = 7.6; // about 1.3 m: enough to hop onto crates and low walls
export const WALK = 5.0;
export const SPRINT = 7.0;
export const CROUCH_SPEED = 2.4;
export const ADS_SPEED = 2.9;
export const MAX_HP = 100;
export const REGEN_DELAY = 4000; // ms after the last hit before health comes back
export const REGEN_RATE = 40 / 1000; // hp per ms

// Health after regeneration, given the hp at the last hit and when that was.
export function hpAt(hp, lastHit, now) {
  if (hp <= 0) return 0;
  const t = now - lastHit - REGEN_DELAY;
  return t > 0 ? Math.min(MAX_HP, hp + t * REGEN_RATE) : hp;
}

export function forward(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class PlayerSim {
  constructor(grid, spawn) {
    this.grid = grid;
    this.reset(spawn);
  }

  reset(s) {
    this.x = s.x;
    this.y = s.y ?? this.grid.floorAt(s.x, s.z, RADIUS);
    this.z = s.z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yaw = s.yaw ?? 0;
    this.pitch = 0;
    this.ground = true;
    this.crouch = 0; // 0 standing .. 1 crouched
    this.sprinting = false;
    this.speed = 0;
    this.events = [];
  }

  eye() {
    return this.y + EYE + (EYE_CROUCH - EYE) * this.crouch;
  }

  // ctl: { mx, mz } stick (-1..1, mz < 0 is forward), sprint, jump, crouch, ads, speedMul
  update(dt, ctl) {
    const g = this.grid;
    this.crouch += ((ctl.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    let mx = ctl.mx || 0;
    let mz = ctl.mz || 0;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    this.sprinting = !!ctl.sprint && mz < -0.5 && !ctl.ads && this.crouch < 0.5;
    let top = WALK;
    if (this.sprinting) top = SPRINT;
    else if (this.crouch > 0.5) top = CROUCH_SPEED;
    else if (ctl.ads) top = ADS_SPEED;
    top *= ctl.speedMul || 1;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Stick to world: forward is (-sin, -cos), right is (cos, -sin).
    const wx = (-sin * -mz + cos * mx) * top;
    const wz = (-cos * -mz - sin * mx) * top;
    const accel = this.ground ? 14 : 3;
    const k = Math.min(1, dt * accel);
    this.vx += (wx - this.vx) * k;
    this.vz += (wz - this.vz) * k;

    if (ctl.jump && this.ground && this.crouch < 0.5) {
      this.vy = JUMP_V;
      this.ground = false;
      this.events.push('jump');
    }
    if (!this.ground) this.vy -= GRAVITY * dt;

    // Move in small steps so nothing tunnels through thin walls.
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vz) * dt) / 0.2));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const climb = this.ground ? this.y + STEP : this.y + 0.02;
      let blocked;
      [this.x, blocked] = g.slide(this.x, this.z, RADIUS, 0, this.vx * sdt, climb);
      if (blocked) this.vx = 0;
      [this.z, blocked] = g.slide(this.x, this.z, RADIUS, 1, this.vz * sdt, climb);
      if (blocked) this.vz = 0;
    }

    const floor = g.floorAt(this.x, this.z, RADIUS - 0.02);
    const wasGround = this.ground;
    this.y += this.vy * dt;
    if (this.y <= floor) {
      if (!wasGround && this.vy < -9) this.events.push('land');
      this.y = floor;
      this.vy = 0;
      this.ground = true;
    } else if (wasGround && this.vy <= 0 && this.y - floor <= STEP + 0.05) {
      this.y = floor; // walk down steps instead of falling off each one
      this.vy = 0;
    } else {
      this.ground = false;
    }
    this.speed = Math.hypot(this.vx, this.vz);
  }

  snapshot() {
    return { x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch, cr: this.crouch, mv: this.speed, gr: this.ground ? 1 : 0 };
  }
}

// ------------------------------------------------------------------ hitboxes

// Where to aim at a soldier: chest and head, for a view { x, y, z, cr }.
export function chest(v) {
  return [v.x, v.y + 1.15 - 0.4 * (v.cr || 0), v.z];
}
export function head(v) {
  return [v.x, v.y + EYE + (EYE_CROUCH - EYE) * (v.cr || 0) + 0.02, v.z];
}

const HEAD_R = 0.25;
const BODY_R = 0.4;

// Ray (normalized dir) against one soldier. Returns { t, head } or null.
export function hitSoldier(ox, oy, oz, dx, dy, dz, v, maxT) {
  let best = null;
  const [hx, hy, hz] = head(v);
  // Head sphere
  const lx = ox - hx;
  const ly = oy - hy;
  const lz = oz - hz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - HEAD_R * HEAD_R;
  const disc = b * b - c;
  if (disc >= 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < maxT) best = { t, head: true };
  }
  // Body: vertical cylinder from the feet to the shoulders
  const top = hy - HEAD_R;
  const a2 = dx * dx + dz * dz;
  if (a2 > 1e-8) {
    const px = ox - v.x;
    const pz = oz - v.z;
    const bb = px * dx + pz * dz;
    const cc = px * px + pz * pz - BODY_R * BODY_R;
    const d2 = bb * bb - a2 * cc;
    if (d2 >= 0) {
      const sq = Math.sqrt(d2);
      for (const t of [(-bb - sq) / a2, (-bb + sq) / a2]) {
        if (t <= 0 || t >= maxT) continue;
        const y = oy + dy * t;
        if (y >= v.y && y <= top && (!best || t < best.t)) {
          best = { t, head: false };
          break;
        }
      }
    }
  }
  return best;
}
