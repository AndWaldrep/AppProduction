import * as THREE from 'three';

export const MAX_SPEED = 30;
const OFFROAD_MAX = 13;
const BOOST_SPEED = 42;
const STAR_SPEED = 36;
const REVERSE_MAX = -9;
const KART_RADIUS = 1.15;

// ------------------------------------------------------------------ model

const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.38, 12);
wheelGeo.rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshLambertMaterial({ color: '#1b1b1b' });
const hubMat = new THREE.MeshLambertMaterial({ color: '#cfd8dc' });
const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.4, 8);
hubGeo.rotateZ(Math.PI / 2);
const darkMat = new THREE.MeshLambertMaterial({ color: '#263238' });
const skinMat = new THREE.MeshLambertMaterial({ color: '#ffcc99' });
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const SPARK_COLORS = [null, '#4fc3f7', '#ff9100'];

function nameTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 34px system-ui, sans-serif';
  const w = Math.min(248, ctx.measureText(name).width + 28);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(128 - w / 2, 8, w, 48, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(128 - w / 2 + 12, 26, 10, 12);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128 + 6, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(4, 1, 1);
  sprite.position.y = 3.2;
  sprite.renderOrder = 10;
  return sprite;
}

export function buildKartMesh(color, name) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts / spins / hops; root only moves
  root.add(body);
  const paint = new THREE.MeshLambertMaterial({ color });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 2.7), paint);
  chassis.position.y = 0.55;
  body.add(chassis);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.9), paint);
  nose.position.set(0, 0.5, 1.6);
  body.add(nose);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 0.3), darkMat);
  bumper.position.set(0, 0.4, 2.05);
  body.add(bumper);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.3), darkMat);
  seat.position.set(0, 1.1, -0.75);
  body.add(seat);
  const wheelBar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), darkMat);
  wheelBar.position.set(0, 1.0, 0.55);
  wheelBar.rotation.x = -0.8;
  body.add(wheelBar);
  const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 6, 14), darkMat);
  steeringWheel.position.set(0, 1.18, 0.4);
  steeringWheel.rotation.x = -0.8;
  body.add(steeringWheel);

  // Driver
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.45, 0.9, 8), paint);
  torso.position.set(0, 1.25, -0.35);
  body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10), skinMat);
  head.position.set(0, 1.95, -0.3);
  body.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), paint);
  helmet.position.set(0, 2.0, -0.33);
  body.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.12), darkMat);
  visor.position.set(0, 2.05, 0.06);
  body.add(visor);

  // Spoiler
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.55), paint);
  wing.position.set(0, 1.35, -1.45);
  body.add(wing);
  for (const s of [-0.6, 0.6]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.1), darkMat);
    strut.position.set(s, 1.0, -1.4);
    body.add(strut);
  }

  // Wheels
  const wheels = [];
  const frontPivots = [];
  for (const [x, z, front] of [[-0.95, 1.05, true], [0.95, 1.05, true], [-0.95, -1.0, false], [0.95, -1.0, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.42, z);
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.add(new THREE.Mesh(hubGeo, hubMat));
    pivot.add(w);
    body.add(pivot);
    wheels.push(w);
    if (front) frontPivots.push(pivot);
  }

  // Boost flame
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1.4, 8),
    new THREE.MeshBasicMaterial({ color: '#ffab00', transparent: true, opacity: 0.85 })
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.6, -1.95);
  flame.visible = false;
  body.add(flame);

  // Drift sparks (one glowing blob per rear wheel)
  const sparkMat = new THREE.SpriteMaterial({ color: '#4fc3f7', transparent: true, opacity: 0.9, depthWrite: false });
  const sparks = [-1, 1].map((s) => {
    const sp = new THREE.Sprite(sparkMat);
    sp.position.set(s * 0.95, 0.35, -1.4);
    sp.scale.set(0.7, 0.7, 1);
    sp.visible = false;
    body.add(sp);
    return sp;
  });

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 4),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  root.add(shadow);

  let tag = null;
  if (name) {
    tag = nameTag(name, color);
    root.add(tag);
  }

  root.userData = { body, wheels, frontPivots, flame, sparks, sparkMat, paint, baseColor: new THREE.Color(color), tag };
  return root;
}

// Applies a visual state (shared by local and remote karts) to a kart mesh.
export function poseKartMesh(mesh, v, time, dt) {
  const u = mesh.userData;
  mesh.position.set(v.x, 0, v.z);
  mesh.rotation.y = v.h;
  u.slide = THREE.MathUtils.lerp(u.slide || 0, -(v.dd || 0) * 0.38, Math.min(1, dt * 8));
  let yaw = u.slide;
  if (v.sp) yaw += (time * 12) % (Math.PI * 2);
  u.body.rotation.y = yaw;
  u.body.position.y = v.hop || 0;
  u.body.rotation.z = THREE.MathUtils.lerp(u.body.rotation.z, -(v.steer || 0) * 0.06, Math.min(1, dt * 6));
  const spin = ((v.s || 0) * dt) / 0.42;
  for (const w of u.wheels) w.rotation.x += spin;
  for (const p of u.frontPivots) p.rotation.y = (v.steer || 0) * 0.45;
  u.flame.visible = !!v.b;
  if (v.b) u.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
  const tier = v.dc || 0;
  for (const s of u.sparks) {
    s.visible = tier > 0;
    if (tier > 0) s.scale.setScalar(0.5 + Math.random() * 0.5);
  }
  if (tier > 0) u.sparkMat.color.set(SPARK_COLORS[tier]);
  if (v.st) {
    u.paint.color.setHSL((time * 1.5) % 1, 1, 0.55);
  } else if (!u.paint.color.equals(u.baseColor)) {
    u.paint.color.copy(u.baseColor);
  }
}

// ------------------------------------------------------------------ physics

export class KartSim {
  constructor(track, pose) {
    this.track = track;
    this.x = pose.x;
    this.z = pose.z;
    this.h = pose.h;
    this.speed = 0;
    this.kx = 0; // knockback velocity
    this.kz = 0;
    this.steer = 0;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftWasHeld = false;
    this.hop = 0;
    this.hopV = 0;
    this.boostTime = 0;
    this.spinTime = 0;
    this.starTime = 0;
    this.offroad = false;
    this.maxFactor = 1;
    const n = track.nearest(this.x, this.z);
    this.idx = n.idx;
    this.lastFrac = n.frac;
    this.progress = n.frac > track.N / 2 ? n.frac - track.N : n.frac;
    this.events = []; // 'wall', 'boost', 'miniturbo', 'bump'
  }

  get driftTier() {
    if (!this.driftDir) return 0;
    return this.driftCharge > 2.1 ? 2 : this.driftCharge > 0.9 ? 1 : 0;
  }

  boost(seconds) {
    this.boostTime = Math.max(this.boostTime, seconds);
    this.speed = Math.max(this.speed, BOOST_SPEED - 4);
    this.events.push('boost');
  }

  star() {
    this.starTime = 7;
    this.events.push('boost');
  }

  hit() {
    if (this.starTime > 0 || this.spinTime > 0) return false;
    this.spinTime = 1.3;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.boostTime = 0;
    this.hopV = 6;
    return true;
  }

  update(dt, input, others) {
    const t = this.track;
    this.boostTime = Math.max(0, this.boostTime - dt);
    this.starTime = Math.max(0, this.starTime - dt);
    this.spinTime = Math.max(0, this.spinTime - dt);

    const canDrive = this.spinTime <= 0;
    const steerIn = canDrive ? input.steer : 0;
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 10);

    // ---- drifting: hop on press, slide while held and steering, mini-turbo on release
    const driftHeld = canDrive && input.drift;
    if (driftHeld && !this.driftWasHeld && this.hop <= 0.01) this.hopV = 5;
    if (driftHeld && !this.driftDir && Math.abs(input.steer) > 0.3 && this.speed > 12) {
      this.driftDir = Math.sign(input.steer);
      this.driftCharge = 0;
    }
    if (this.driftDir && (!driftHeld || this.speed < 8)) {
      const tier = this.driftTier;
      if (tier && this.speed >= 8) {
        this.boost(tier === 2 ? 1.3 : 0.7);
        this.events.push('miniturbo');
      }
      this.driftDir = 0;
      this.driftCharge = 0;
    }
    this.driftWasHeld = driftHeld;
    if (this.driftDir) this.driftCharge += dt * (0.8 + 0.6 * Math.max(0, input.steer * this.driftDir));

    this.hopV -= 30 * dt;
    this.hop = Math.max(0, this.hop + this.hopV * dt);
    if (this.hop === 0) this.hopV = Math.max(0, this.hopV);

    // ---- speed
    let top = MAX_SPEED * this.maxFactor;
    if (this.starTime > 0) top = STAR_SPEED;
    if (this.boostTime > 0) top = BOOST_SPEED;
    else if (this.offroad && this.starTime <= 0) top = OFFROAD_MAX;

    if (!canDrive) {
      this.speed *= Math.exp(-2.5 * dt);
    } else if (input.brake) {
      this.speed -= (this.speed > 0 ? 40 : 14) * dt;
      this.speed = Math.max(REVERSE_MAX, this.speed);
    } else if (input.throttle) {
      if (this.speed < top) {
        const accel = this.boostTime > 0 ? 60 : 24 * (1 - 0.55 * Math.max(0, this.speed) / MAX_SPEED);
        this.speed = Math.min(top, this.speed + accel * dt);
      } else {
        this.speed = Math.max(top, this.speed - 18 * dt);
      }
    } else {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 8 * dt);
    }
    if (this.speed > top) this.speed = Math.max(top, this.speed - (this.offroad ? 45 : 18) * dt);

    // ---- steering
    const speedFactor = Math.min(1, Math.abs(this.speed) / 9);
    const rate = 2.1 - 0.7 * (Math.max(0, this.speed) / MAX_SPEED);
    let turn;
    if (this.driftDir) {
      turn = this.driftDir * (1.0 + 0.65 * this.steer * this.driftDir) * 1.45;
    } else {
      turn = this.steer * rate;
    }
    this.h -= turn * speedFactor * Math.sign(this.speed || 1) * dt;

    // ---- move
    this.kx *= Math.exp(-4 * dt);
    this.kz *= Math.exp(-4 * dt);
    this.x += (Math.sin(this.h) * this.speed + this.kx) * dt;
    this.z += (Math.cos(this.h) * this.speed + this.kz) * dt;

    // ---- other karts
    if (others) {
      for (const o of others) {
        const dx = this.x - o.x;
        const dz = this.z - o.z;
        const d = Math.hypot(dx, dz);
        const minD = KART_RADIUS * 2;
        if (d > 0.001 && d < minD) {
          const nx = dx / d;
          const nz = dz / d;
          this.x += nx * (minD - d) * 0.6;
          this.z += nz * (minD - d) * 0.6;
          const push = o.star && this.starTime <= 0 ? 0 : 7;
          this.kx += nx * push;
          this.kz += nz * push;
          if (o.star && this.starTime <= 0) {
            if (this.hit()) this.events.push('hit');
          } else if (!this._bumpCooldown) {
            this.speed *= 0.88;
            this.events.push('bump');
          }
          this._bumpCooldown = 0.3;
        }
      }
      this._bumpCooldown = Math.max(0, (this._bumpCooldown || 0) - dt);
    }

    // ---- track: off-road, walls, progress
    const n = t.nearest(this.x, this.z, this.idx);
    this.offroad = Math.abs(n.lat) > t.halfWidth + 1.2;
    const limit = t.wallLat - KART_RADIUS * 0.8;
    if (Math.abs(n.lat) > limit) {
      const over = Math.abs(n.lat) - limit;
      const s = Math.sign(n.lat);
      const nx = t.nx[n.idx] * s;
      const nz = t.nz[n.idx] * s;
      this.x -= nx * over;
      this.z -= nz * over;
      // How directly did we drive into the wall?
      const fx = Math.sin(this.h);
      const fz = Math.cos(this.h);
      const into = fx * nx + fz * nz;
      if (into > 0.25 && this.speed > 6) {
        this.speed *= 1 - 0.5 * into;
        this.events.push('wall');
      }
      // Turn the kart to slide along the wall instead of sticking.
      if (into > 0) {
        const tx = t.tx[n.idx];
        const tz = t.tz[n.idx];
        const along = fx * tx + fz * tz >= 0 ? 1 : -1;
        const target = Math.atan2(tx * along, tz * along);
        let diff = target - this.h;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.h += diff * Math.min(1, dt * 6);
      }
      const kn = this.kx * nx + this.kz * nz;
      if (kn > 0) {
        this.kx -= nx * kn * 1.6;
        this.kz -= nz * kn * 1.6;
      }
    }

    // Boost pads
    for (const pad of t.pads) {
      let di = n.idx - pad.idx;
      if (di > t.N / 2) di -= t.N;
      if (di < -t.N / 2) di += t.N;
      if (Math.abs(di * t.spacing) < pad.halfL && Math.abs(n.lat - pad.lat) < pad.halfW + 0.6) {
        if (this.boostTime < 0.9) this.boost(1.0);
      }
    }

    let delta = n.frac - this.lastFrac;
    if (delta > t.N / 2) delta -= t.N;
    if (delta < -t.N / 2) delta += t.N;
    this.progress += delta;
    this.lastFrac = n.frac;
    this.idx = n.idx;
    this.lat = n.lat;
  }

  // Compact state sent over the network and used to draw the kart.
  snapshot() {
    return {
      x: this.x,
      z: this.z,
      h: this.h,
      s: this.speed,
      p: this.progress,
      sp: this.spinTime > 0 ? 1 : 0,
      st: this.starTime > 0 ? 1 : 0,
      b: this.boostTime > 0 || this.starTime > 0 ? 1 : 0,
      dd: this.driftDir,
      dc: this.driftTier,
      hop: this.hop,
      steer: this.steer,
    };
  }
}

// ------------------------------------------------------------------ CPU driver

export class BotDriver {
  constructor(track, seed) {
    this.track = track;
    this.laneTarget = 0;
    this.lane = 0;
    this.laneTimer = 0;
    this.rand = (() => {
      let s = seed * 9301 + 49297;
      return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    })();
    this.skill = 0.9 + this.rand() * 0.08;
    this.itemTimer = 0;
  }

  // leaderGap: how far (in samples) this kart is ahead of the best human. Positive = ahead.
  drive(sim, dt, leaderGap = 0) {
    const t = this.track;
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 2 + this.rand() * 3;
      this.laneTarget = (this.rand() * 2 - 1) * (t.halfWidth - 3);
    }
    this.lane += (this.laneTarget - this.lane) * Math.min(1, dt * 0.8);
    const look = 6 + Math.max(0, sim.speed) * 0.35;
    const target = t.pointAt(sim.idx + look, this.lane);
    let want = Math.atan2(target.x - sim.x, target.z - sim.z);
    let diff = want - sim.h;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));

    // Gentle rubber-banding so the race stays close.
    const band = Math.max(-0.08, Math.min(0.1, -leaderGap / 900));
    sim.maxFactor = Math.max(0.78, Math.min(1.04, this.skill + band));

    return {
      steer: Math.max(-1, Math.min(1, -diff * 2.4)),
      throttle: Math.abs(diff) < 1.4,
      brake: Math.abs(diff) > 1.6 && sim.speed > 5,
      drift: false,
      corner: Math.abs(diff),
    };
  }
}
