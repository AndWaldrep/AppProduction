// CPU soldiers. The host's phone runs them with the same movement and weapons
// as everyone else, so they play by the same rules. They wander the map with A*
// pathfinding, chase gunfire, and fight with human-like reaction time and aim.

import { STEP } from './grid.js';
import { chest, head, wrapAngle, EYE, RADIUS } from './player.js';

const SKILL = {
  1: { react: 0.8, turn: 3.2, err: 0.11, errMin: 0.035, settle: 1.2, range: 0.65, fov: 1.1, nade: 0 },
  2: { react: 0.55, turn: 5.0, err: 0.075, errMin: 0.022, settle: 1.8, range: 0.85, fov: 1.25, nade: 0.12 },
  3: { react: 0.3, turn: 7.5, err: 0.045, errMin: 0.007, settle: 2.6, range: 1, fov: 1.4, nade: 0.2 },
};
const PREFERRED = { ar: 16, smg: 8, shotgun: 4, sniper: 28 };

export class Bot {
  constructor(grid, id, skill, seed = 1) {
    this.grid = grid;
    this.id = id;
    this.k = SKILL[skill] || SKILL[2];
    this.seed = seed;
    this.reset();
  }

  rand() {
    // Small deterministic generator so each bot behaves a little differently.
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  reset() {
    this.path = null;
    this.goal = null;
    this.repathIn = 0;
    this.target = null;
    this.targetSince = 0;
    this.lostTime = 0;
    this.lastSeen = null; // { x, z, t }
    this.heard = null;
    this.thinkIn = 0;
    this.strafe = 1;
    this.strafeIn = 0;
    this.errYaw = 0;
    this.errPitch = 0;
    this.stuckT = 0;
    this.stuckRef = null;
    this.burst = 0;
    this.pause = 0;
    this.crouchT = 0;
    this.aimHead = false;
    this.attacker = null;
    this.nadeTried = false;
  }

  hurtBy(id) {
    this.attacker = { id, t: 0 };
  }

  hear(x, z) {
    this.heard = { x, z, t: 0 };
  }

  // sim: our PlayerSim, wpn: our WeaponState, ctx: { ents: [{ id, team, alive, view }], mode, team }
  think(dt, sim, wpn, ctx) {
    const k = this.k;
    const g = this.grid;
    const ctl = { mx: 0, mz: 0, sprint: false, jump: false, crouch: false, ads: false, fire: false, reload: false, nade: false };
    if (this.lastSeen) this.lastSeen.t += dt;
    if (this.heard) this.heard.t += dt;
    if (this.attacker) {
      this.attacker.t += dt;
      if (this.attacker.t > 3) this.attacker = null;
    }

    // --- perception
    this.thinkIn -= dt;
    if (this.thinkIn <= 0) {
      this.thinkIn = 0.12 + this.rand() * 0.06;
      const prev = this.target;
      this.target = this.pickTarget(sim, ctx);
      if (this.target && (!prev || prev.id !== this.target.id)) {
        // New target: take a moment to react, and aim starts off a bit wide.
        this.targetSince = -(k.react * (0.75 + this.rand() * 0.5)) - (this.target.flank ? 0.25 : 0);
        this.errYaw = (this.rand() - 0.5) * 2 * k.err;
        this.errPitch = (this.rand() - 0.5) * k.err;
        this.aimHead = this.rand() < (k.react < 0.35 ? 0.35 : 0.12);
        this.nadeTried = false;
      }
    }
    const tgt = this.target ? ctx.ents.find((e) => e.id === this.target.id && e.alive) : null;
    if (!tgt) this.target = null;

    const eyeY = sim.eye();
    let wantYaw = sim.yaw;
    let wantPitch = 0;

    if (tgt) {
      this.targetSince += dt;
      const v = tgt.view;
      const p = this.aimHead ? head(v) : chest(v);
      const dx = p[0] - sim.x;
      const dy = p[1] - eyeY;
      const dz = p[2] - sim.z;
      const dist = Math.hypot(dx, dz);
      this.lastSeen = { x: v.x, z: v.z, t: 0 };
      // Aim error shrinks the longer we track the target.
      const decay = Math.exp(-dt * k.settle);
      this.errYaw *= decay;
      this.errPitch *= decay;
      const jitter = k.errMin * (0.6 + 0.4 * Math.sin(performance.now() / 170 + this.seed));
      wantYaw = Math.atan2(-dx, -dz) + this.errYaw + jitter * (this.rand() - 0.5);
      wantPitch = Math.atan2(dy, dist) + this.errPitch;

      const w = wpn.w;
      const pref = PREFERRED[w.id] || 14;
      ctl.ads = w.id === 'sniper' || (dist > 11 && w.id !== 'shotgun');
      // Strafe while fighting, and keep a comfortable distance.
      this.strafeIn -= dt;
      if (this.strafeIn <= 0) {
        this.strafeIn = 0.5 + this.rand() * 1.1;
        this.strafe = this.rand() < 0.5 ? -1 : 1;
        if (this.rand() < 0.25) this.strafe = 0;
        this.crouchT = this.rand() < 0.15 && dist > 10 ? 1.2 : 0;
      }
      ctl.mx = this.strafe * (ctl.ads ? 1 : 0.85);
      if (dist > pref * 1.4) ctl.mz = -0.8;
      else if (dist < pref * 0.5 && w.id !== 'shotgun') ctl.mz = 0.6;
      if (this.crouchT > 0) {
        this.crouchT -= dt;
        ctl.crouch = true;
        ctl.mx = 0;
        ctl.mz = 0;
      }
      // Don't strafe off a ledge or into a wall.
      if (ctl.mx || ctl.mz) {
        const s = Math.sin(sim.yaw);
        const c = Math.cos(sim.yaw);
        const mvx = -s * -ctl.mz + c * ctl.mx;
        const mvz = -c * -ctl.mz - s * ctl.mx;
        const nx = sim.x + mvx * 1.2;
        const nz = sim.z + mvz * 1.2;
        const h = g.floorAt(nx, nz, RADIUS);
        if (h - sim.y > STEP || sim.y - h > 0.6) {
          this.strafe = -this.strafe;
          ctl.mx = -ctl.mx;
          ctl.mz = 0;
        }
      }

      // Fire when lined up.
      const aimErr = Math.abs(wrapAngle(sim.yaw - Math.atan2(-dx, -dz))) + Math.abs(sim.pitch - Math.atan2(dy, dist)) * 0.7;
      const tol = Math.atan2(0.45, dist) + 0.03;
      const inRange = dist < w.autoRange * k.range * (w.id === 'sniper' ? 1 : 1.1);
      const settle = w.id === 'sniper' ? 0.35 + (1 - k.range) : 0; // scoped shots take a moment to line up
      if (this.targetSince > settle && aimErr < tol && inRange && (!ctl.ads || wpn.adsT > (w.scope ? 0.9 : 0.6))) {
        if (this.pause > 0) this.pause -= dt;
        else {
          ctl.fire = true;
          this.burst += dt;
          if (w.auto && dist > 18 && this.burst > 0.35 + this.rand() * 0.3) {
            this.burst = 0;
            this.pause = 0.2 + this.rand() * 0.25;
          }
        }
      }
      if (!this.nadeTried && this.targetSince > 0.6 && wpn.nades > 0 && dist > 8 && dist < 20) {
        this.nadeTried = true;
        if (this.rand() < k.nade) ctl.nade = true;
      }
      if (wpn.ammo === 0) ctl.reload = true;
    } else {
      this.burst = 0;
      // --- roam
      if (wpn.ammo < wpn.w.mag * 0.4) ctl.reload = true;
      this.repathIn -= dt;
      const want = this.chooseGoal(sim, ctx);
      if (!this.path || this.repathIn <= 0 || (want && this.goal && (want[0] !== this.goal[0] || want[1] !== this.goal[1]) && this.repathIn < 2)) {
        this.goal = want || this.randomGoal(ctx);
        this.path = g.path(Math.floor(sim.x), Math.floor(sim.z), this.goal[0], this.goal[1]);
        this.repathIn = 3 + this.rand() * 2;
        if (!this.path) {
          this.goal = this.randomGoal(ctx);
          this.path = g.path(Math.floor(sim.x), Math.floor(sim.z), this.goal[0], this.goal[1]);
          this.repathIn = 1;
        }
      }
      const step = this.follow(sim);
      if (step) {
        wantYaw = Math.atan2(-step.dx, -step.dz);
        const facing = Math.abs(wrapAngle(wantYaw - sim.yaw));
        ctl.mz = facing < 0.9 ? -1 : -0.3;
        ctl.sprint = facing < 0.3 && step.far;
        ctl.jump = step.jump;
      } else {
        this.path = null;
        this.repathIn = 0;
      }
      // Glance toward where the action was.
      if (this.attacker) {
        const a = ctx.ents.find((e) => e.id === this.attacker.id);
        if (a) wantYaw = Math.atan2(-(a.view.x - sim.x), -(a.view.z - sim.z));
      }
      wantPitch = 0;
    }

    // Unstick: if we've barely moved while trying to, hop and pick somewhere else.
    if (ctl.mx || ctl.mz) {
      this.stuckT += dt;
      if (this.stuckT > 1.0) {
        const ref = this.stuckRef;
        if (ref && Math.hypot(sim.x - ref[0], sim.z - ref[1]) < 0.4) {
          ctl.jump = true;
          this.path = null;
          this.goal = this.randomGoal(ctx);
          this.strafe = -this.strafe;
        }
        this.stuckRef = [sim.x, sim.z];
        this.stuckT = 0;
      }
    }

    // Turn toward where we want to look, no faster than a person could.
    const turn = k.turn * dt * (tgt ? 1 : 0.8);
    const dyaw = wrapAngle(wantYaw - sim.yaw);
    sim.yaw = wrapAngle(sim.yaw + Math.max(-turn, Math.min(turn, dyaw)));
    const dp = wantPitch - sim.pitch;
    sim.pitch += Math.max(-turn, Math.min(turn, dp));
    return ctl;
  }

  pickTarget(sim, ctx) {
    const g = this.grid;
    const eyeY = sim.eye();
    let best = null;
    let bestScore = Infinity;
    const fwdYaw = sim.yaw;
    for (const e of ctx.ents) {
      if (e.id === this.id || !e.alive) continue;
      if (ctx.mode === 'tdm' && e.team === ctx.team) continue;
      const v = e.view;
      const dx = v.x - sim.x;
      const dz = v.z - sim.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 70) continue;
      const ang = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - fwdYaw));
      const isAttacker = this.attacker && this.attacker.id === e.id;
      const tracked = this.target && this.target.id === e.id;
      if (ang > this.k.fov && dist > 5 && !isAttacker && !tracked) continue;
      const c = chest(v);
      const h = head(v);
      if (!g.clear(sim.x, eyeY, sim.z, h[0], h[1], h[2]) && !g.clear(sim.x, eyeY, sim.z, c[0], c[1], c[2])) continue;
      const score = dist + ang * 12 - (tracked ? 8 : 0) - (isAttacker ? 10 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { id: e.id, flank: ang > this.k.fov };
      }
    }
    return best;
  }

  chooseGoal(sim, ctx) {
    if (this.lastSeen && this.lastSeen.t < 6) return this.cellNear(this.lastSeen.x, this.lastSeen.z);
    if (this.heard && this.heard.t < 5 && Math.hypot(this.heard.x - sim.x, this.heard.z - sim.z) < 35) return this.cellNear(this.heard.x, this.heard.z);
    if (this.goal && Math.hypot(this.goal[0] + 0.5 - sim.x, this.goal[1] + 0.5 - sim.z) > 1.5) return this.goal;
    return null;
  }

  cellNear(x, z) {
    return [Math.max(0, Math.min(this.grid.w - 1, Math.floor(x))), Math.max(0, Math.min(this.grid.d - 1, Math.floor(z)))];
  }

  randomGoal(ctx) {
    const g = this.grid;
    // Head toward the action: mostly the other team's half, or toward a random enemy.
    const enemies = ctx.ents.filter((e) => e.alive && e.id !== this.id && (ctx.mode !== 'tdm' || e.team !== ctx.team));
    if (enemies.length && this.rand() < 0.45) {
      const e = enemies[Math.floor(this.rand() * enemies.length)];
      return this.cellNear(e.view.x + (this.rand() - 0.5) * 10, e.view.z + (this.rand() - 0.5) * 10);
    }
    const spots = g.roam || (g.roam = this.roamSpots());
    return spots[Math.floor(this.rand() * spots.length)];
  }

  roamSpots() {
    const g = this.grid;
    const reach = g.reachable();
    const out = [];
    for (let z = 1; z < g.d - 1; z += 2) {
      for (let x = 1; x < g.w - 1; x += 2) {
        const i = z * g.w + x;
        if (reach[i] && g.col[i] < 50) out.push([x, z]);
      }
    }
    return out;
  }

  // Next point to walk toward, skipping waypoints we can walk straight to.
  follow(sim) {
    const g = this.grid;
    const p = this.path;
    if (!p || !p.length) return null;
    // Drop waypoints we've reached.
    while (p.length) {
      const [cx, cz] = p[0];
      const reached = Math.hypot(cx + 0.5 - sim.x, cz + 0.5 - sim.z) < 0.55 && Math.abs(g.colAt(cx, cz) - sim.y) < 0.6;
      if (!reached) break;
      p.shift();
    }
    if (!p.length) return null;
    let idx = 0;
    for (let i = Math.min(p.length - 1, 6); i > 0; i--) {
      const [cx, cz] = p[i];
      let ok = g.walkable(sim.x, sim.z, cx + 0.5, cz + 0.5);
      for (let j = 0; ok && j <= i; j++) if (g.colAt(p[j][0], p[j][1]) - g.colAt(...(j ? p[j - 1] : [Math.floor(sim.x), Math.floor(sim.z)])) > STEP) ok = false;
      if (ok) {
        idx = i;
        break;
      }
    }
    const [cx, cz] = p[idx];
    const dx = cx + 0.5 - sim.x;
    const dz = cz + 0.5 - sim.z;
    const d = Math.hypot(dx, dz) || 1;
    const rise = g.colAt(p[0][0], p[0][1]) - sim.y;
    const nearNext = Math.hypot(p[0][0] + 0.5 - sim.x, p[0][1] + 0.5 - sim.z) < 1.4;
    return { dx: dx / d, dz: dz / d, jump: rise > STEP && nearNext && sim.ground, far: p.length > 4 };
  }
}

