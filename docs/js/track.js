import * as THREE from 'three';
import { TRACKS } from './tracks.js';

export const WALL_MARGIN = 5; // grass strip between the road edge and the barrier
const RAMP_LEN = 10; // metres of ramp before a jump's lip
const RAMP_RISE = 2.2; // how far the ramp lip sits above the road
const BANK_SLOPE = 1.5; // earth bank under raised road: metres out per metre down
export const ROLLER_RADIUS = 2.3;

const THEMES = {
  grass: {
    skyTop: '#3d8fe0', skyBottom: '#bfe6ff', fog: '#bfe6ff',
    ground: '#5fae4a', groundDots: ['#4f9a3c', '#6cbd55', '#58a344'],
    bank: '#7a9a45', bankDots: ['#6b8a3a', '#8aab52', '#5f7f35'],
    road: '#5b5e66', wallA: '#e53935', wallB: '#ffffff',
    mountain: '#6f9f5a', water: '#2f8fd8',
  },
  desert: {
    skyTop: '#f28c4a', skyBottom: '#ffe1a8', fog: '#ffd9a0',
    ground: '#e2b86e', groundDots: ['#d6a95c', '#ecc584', '#cf9f52'],
    bank: '#c98d4f', bankDots: ['#b97c42', '#d99d5c', '#a96f3a'],
    road: '#6e6259', wallA: '#ff8f00', wallB: '#fff3e0',
    mountain: '#c9783f', water: '#2fa3a0',
  },
  snow: {
    skyTop: '#5f9bd8', skyBottom: '#e6f2ff', fog: '#e3eefa',
    ground: '#eef3f9', groundDots: ['#dde6f0', '#ffffff', '#d3dde9'],
    bank: '#dfe7f1', bankDots: ['#c9d4e2', '#f4f8fc', '#b8c6d6'],
    road: '#4b5563', wallA: '#1e88e5', wallB: '#ffffff',
    mountain: '#b8c7da', water: '#6fc6ec',
  },
};

function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function speckle(ctx, w, h, colors, count, size) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

function geometry(positions, uvs, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class Track {
  constructor(id) {
    const def = TRACKS[id] || TRACKS.sunny;
    this.id = TRACKS[id] ? id : 'sunny';
    this.def = def;
    this.theme = THEMES[def.theme];
    this.halfWidth = def.halfWidth;
    this.wallLat = def.halfWidth + WALL_MARGIN;

    const curve = new THREE.CatmullRomCurve3(
      def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal'
    );
    this.length = curve.getLength();
    const N = (this.N = Math.round(this.length / 2));
    this.spacing = this.length / N;
    const pts = curve.getSpacedPoints(N);
    this.px = new Float32Array(N);
    this.pz = new Float32Array(N);
    this.tx = new Float32Array(N);
    this.tz = new Float32Array(N);
    this.nx = new Float32Array(N); // left-hand normal
    this.nz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.px[i] = pts[i].x;
      this.pz[i] = pts[i].z;
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N;
      const b = (i + 1) % N;
      let tx = this.px[b] - this.px[a];
      let tz = this.pz[b] - this.pz[a];
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      this.tx[i] = tx;
      this.tz[i] = tz;
      this.nx[i] = tz;
      this.nz[i] = -tx;
    }

    // ---- road height, ramps and gaps
    this.py = new Float32Array(N);
    this.gap = new Uint8Array(N);
    this.ramp = new Uint8Array(N);
    const keys = [...(def.heights || [[0, 0]])].sort((a, b) => a[0] - b[0]);
    keys.push([1 + keys[0][0], keys[0][1]]);
    for (let i = 0; i < N; i++) {
      const f = i / N;
      let k = 0;
      while (k < keys.length - 2 && keys[k + 1][0] <= f) k++;
      const [f0, h0] = keys[k];
      const [f1, h1] = keys[k + 1];
      const t = f1 > f0 ? Math.min(1, Math.max(0, (f - f0) / (f1 - f0))) : 0;
      this.py[i] = h0 + (h1 - h0) * t * t * (3 - 2 * t);
    }
    this.jumps = (def.jumps || []).map((j) => {
      const lip = Math.round(j.at * N);
      const rampN = Math.round(RAMP_LEN / this.spacing);
      const gapN = Math.max(2, Math.round(j.gap / this.spacing));
      for (let k = 0; k <= rampN; k++) {
        const i = this.wrap(lip - rampN + k);
        this.py[i] += RAMP_RISE * Math.pow(k / rampN, 1.15);
        this.ramp[i] = 1;
      }
      for (let k = 1; k <= gapN; k++) this.gap[this.wrap(lip + k)] = 1;
      return { lip, start: this.wrap(lip - rampN), end: this.wrap(lip + gapN + 1), gapN };
    });

    this.pads = def.pads.map((p) => ({ idx: Math.round(p.at * N), lat: p.lat, halfW: 2.4, halfL: 3.2 }));
    this.boxes = [];
    for (const f of def.boxes) {
      const idx = Math.round(f * N);
      for (const lat of [-6, -2, 2, 6]) {
        this.boxes.push({ x: this.px[idx] + this.nx[idx] * lat, y: this.py[idx], z: this.pz[idx] + this.nz[idx] * lat });
      }
    }
    this.rollers = (def.rollers || []).map((r) => ({
      idx: Math.round(r.at * N),
      period: r.period,
      phase: r.phase,
      amp: this.halfWidth - 1,
    }));

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, this.px[i]);
      maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]);
      maxZ = Math.max(maxZ, this.pz[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  }

  wrap(i) {
    const N = this.N;
    return ((i % N) + N) % N;
  }

  // Nearest centre-line sample to (x, z). `hint` is last frame's index, which keeps this cheap.
  nearest(x, z, hint = -1) {
    let best = 0;
    let bestD = Infinity;
    const scan = (from, to) => {
      for (let k = from; k <= to; k++) {
        const i = this.wrap(k);
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    };
    if (hint >= 0) {
      scan(hint - 25, hint + 25);
      const lim = this.wallLat + 8;
      if (bestD > lim * lim) {
        bestD = Infinity;
        scan(0, this.N - 1);
      }
    } else {
      scan(0, this.N - 1);
    }
    const dx = x - this.px[best];
    const dz = z - this.pz[best];
    const along = dx * this.tx[best] + dz * this.tz[best];
    const lat = dx * this.nx[best] + dz * this.nz[best];
    return { idx: best, lat, frac: best + along / this.spacing };
  }

  // Road height at a fractional sample position (gaps report the height of the road edges).
  heightAt(frac) {
    const i0 = Math.floor(frac);
    const t = frac - i0;
    const a = this.wrap(i0);
    const b = this.wrap(i0 + 1);
    // At a ramp lip keep the ramp's angle instead of blending down toward the far side.
    if (this.gap[b] && !this.gap[a]) return this.py[a] + (this.py[a] - this.py[this.wrap(i0 - 1)]) * t;
    return this.py[a] + (this.py[b] - this.py[a]) * t;
  }

  isGap(frac) {
    return this.gap[this.wrap(Math.round(frac))] === 1;
  }

  isRamp(idx) {
    return this.ramp[this.wrap(idx)] === 1;
  }

  // Rise over run along the road, positive uphill.
  slopeAt(idx) {
    const a = this.wrap(idx - 1);
    const b = this.wrap(idx + 1);
    if (this.gap[a] || this.gap[b]) return 0;
    return (this.py[b] - this.py[a]) / (2 * this.spacing);
  }

  pointAt(idx, lat = 0) {
    const i = this.wrap(Math.round(idx));
    return { x: this.px[i] + this.nx[i] * lat, y: this.py[i], z: this.pz[i] + this.nz[i] * lat, h: Math.atan2(this.tx[i], this.tz[i]) };
  }

  gridPose(slot) {
    const row = Math.floor(slot / 2);
    const col = slot % 2;
    const idx = this.N - 5 - row * 5 - col * 2;
    const p = this.pointAt(idx, col ? -3.5 : 3.5);
    return { ...p, idx: this.wrap(idx) };
  }

  // Where a rolling boulder is at race time t (seconds). Same on every phone.
  rollerAt(r, t) {
    const lat = r.amp * Math.sin((t / r.period) * Math.PI * 2 + r.phase);
    const i = r.idx;
    return { x: this.px[i] + this.nx[i] * lat, y: this.py[i] + ROLLER_RADIUS, z: this.pz[i] + this.nz[i] * lat, lat };
  }

  // ------------------------------------------------------------ visuals

  build() {
    const group = new THREE.Group();
    const th = this.theme;

    // Sky dome with a vertical gradient.
    const skyGeo = new THREE.SphereGeometry(900, 24, 12);
    const top = new THREE.Color(th.skyTop);
    const bottom = new THREE.Color(th.skyBottom);
    const colors = [];
    const pos = skyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 900);
      const c = bottom.clone().lerp(top, Math.pow(t, 0.6));
      colors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
    sky.position.set(this.bounds.cx, 0, this.bounds.cz);
    group.add(sky);

    // Ground
    const groundTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = th.ground;
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, th.groundDots, 900, 2);
    }, 120, 120);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.MeshLambertMaterial({ map: groundTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.bounds.cx, -0.02, this.bounds.cz);
    group.add(ground);

    // Road surface (also covers the grass verge up to the barriers when raised)
    const roadTex = canvasTexture(128, 256, (ctx, w, h) => {
      ctx.fillStyle = th.road;
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, ['rgba(0,0,0,0.15)', 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.08)'], 2500, 2);
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(5, 0, 4, h);
      ctx.fillRect(w - 9, 0, 4, h);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(w / 2 - 2, 0, 4, h / 2);
    });
    group.add(this.ribbon(-this.halfWidth, this.halfWidth, 0.03, 16, new THREE.MeshLambertMaterial({ map: roadTex })));

    // Verge between road and barrier: follows the road height so raised sections look solid.
    const vergeTex = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = th.ground;
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, th.groundDots, 300, 2);
    });
    const vergeMat = new THREE.MeshLambertMaterial({ map: vergeTex });
    group.add(this.ribbon(this.halfWidth, this.wallLat, 0.0, 6, vergeMat));
    group.add(this.ribbon(-this.wallLat, -this.halfWidth, 0.0, 6, vergeMat));

    // Curbs
    const curbTex = canvasTexture(16, 64, (ctx, w, h) => {
      ctx.fillStyle = th.wallA;
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, h / 2, w, h / 2);
    });
    const curbMat = new THREE.MeshLambertMaterial({ map: curbTex });
    group.add(this.ribbon(this.halfWidth, this.halfWidth + 1.4, 0.05, 5, curbMat));
    group.add(this.ribbon(-this.halfWidth - 1.4, -this.halfWidth, 0.05, 5, curbMat));

    // Ramps: yellow and black chevrons
    const rampTex = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#ffd600';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#212121';
      for (const y0 of [0, 32]) {
        ctx.beginPath();
        ctx.moveTo(0, y0 + 28);
        ctx.lineTo(32, y0 + 8);
        ctx.lineTo(64, y0 + 28);
        ctx.lineTo(64, y0 + 18);
        ctx.lineTo(32, y0 - 2);
        ctx.lineTo(0, y0 + 18);
        ctx.closePath();
        ctx.fill();
      }
    }, 2, 1);
    const rampMat = new THREE.MeshLambertMaterial({ map: rampTex, emissive: '#3a3000' });
    for (const j of this.jumps) {
      group.add(this.ribbon(-this.halfWidth, this.halfWidth, 0.06, 6, rampMat, { from: j.start, to: j.lip }));
    }

    // Earth banks under raised road, cliff faces at gaps, water below the gaps
    const bankTex = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = th.bank;
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, th.bankDots, 500, 3);
    });
    const bankMat = new THREE.MeshLambertMaterial({ map: bankTex, side: THREE.DoubleSide });
    group.add(this.bank(1, bankMat));
    group.add(this.bank(-1, bankMat));
    for (const j of this.jumps) {
      group.add(this.cliff(j.lip, bankMat));
      group.add(this.cliff(j.end, bankMat));
    }
    this.waterTex = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = th.water;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (let y = 6; y < h; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.quadraticCurveTo(16, y - 5, 32, y);
        ctx.quadraticCurveTo(48, y + 5, 64, y);
        ctx.stroke();
      }
    }, 3, 1);
    const waterMat = new THREE.MeshLambertMaterial({ map: this.waterTex, emissive: th.water, emissiveIntensity: 0.25 });
    for (const j of this.jumps) {
      const w = this.wallLat + this.py[j.lip] * BANK_SLOPE + 30;
      group.add(this.ribbon(-w, w, 0.12, 8, waterMat, { from: this.wrap(j.lip - 4), to: this.wrap(j.end + 4), absY: true }));
    }

    // Barriers
    const wallTex = canvasTexture(64, 32, (ctx, w, h) => {
      ctx.fillStyle = th.wallA;
      ctx.fillRect(0, 0, w / 2, h);
      ctx.fillStyle = th.wallB;
      ctx.fillRect(w / 2, 0, w / 2, h);
    });
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide });
    group.add(this.wall(this.wallLat, 1.3, wallMat));
    group.add(this.wall(-this.wallLat, 1.3, wallMat));

    // Start line and arch
    const checker = canvasTexture(64, 16, (ctx) => {
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 2; y++) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
          ctx.fillRect(x * 8, y * 8, 8, 8);
        }
      }
    }, 3, 1);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(this.halfWidth * 2, 2.5), new THREE.MeshLambertMaterial({ map: checker }));
    const s = this.pointAt(0);
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = s.h;
    line.position.set(s.x, s.y + 0.07, s.z);
    group.add(line);
    group.add(this.arch(s));

    // Boost pads
    this.padTex = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#ff6d00';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffd600';
      ctx.beginPath();
      ctx.moveTo(8, 44);
      ctx.lineTo(32, 16);
      ctx.lineTo(56, 44);
      ctx.lineTo(44, 44);
      ctx.lineTo(32, 30);
      ctx.lineTo(20, 44);
      ctx.closePath();
      ctx.fill();
    }, 1, 2);
    const padMat = new THREE.MeshBasicMaterial({ map: this.padTex });
    for (const pad of this.pads) {
      const p = this.pointAt(pad.idx, pad.lat);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pad.halfW * 2, pad.halfL * 2), padMat);
      m.rotation.order = 'YXZ';
      m.rotation.y = p.h + Math.PI; // arrow texture points along the direction of travel
      m.rotation.x = -Math.PI / 2 + Math.atan(this.slopeAt(pad.idx));
      m.position.set(p.x, p.y + 0.08, p.z);
      group.add(m);
    }

    // Rolling boulders / snowballs
    this.rollerMeshes = this.rollers.map(() => {
      const holder = new THREE.Group();
      let ball;
      if (this.def.theme === 'snow') {
        ball = new THREE.Mesh(new THREE.IcosahedronGeometry(ROLLER_RADIUS, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }));
      } else {
        ball = new THREE.Mesh(new THREE.DodecahedronGeometry(ROLLER_RADIUS, 0), new THREE.MeshLambertMaterial({ color: '#8d5a3b', flatShading: true }));
      }
      holder.add(ball);
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(ROLLER_RADIUS * 0.9, 16),
        new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -ROLLER_RADIUS + 0.09;
      holder.add(shadow);
      holder.userData.ball = ball;
      group.add(holder);
      return holder;
    });
    this.updateRollers(0);

    this.addScenery(group);
    return group;
  }

  // Per-frame animation: water, boost pads, rollers, balloons, snow.
  animate(dt, raceTime, camera) {
    if (this.padTex) this.padTex.offset.y = (this.padTex.offset.y - dt * 1.5) % 1;
    if (this.waterTex) this.waterTex.offset.x = (this.waterTex.offset.x + dt * 0.15) % 1;
    this.updateRollers(raceTime);
    if (this.balloons) {
      for (const b of this.balloons) {
        b.position.y = b.userData.y + Math.sin(raceTime * 0.4 + b.userData.p) * 3;
        b.rotation.y += dt * 0.05;
      }
    }
    if (this.snow && camera) {
      const p = this.snow.geometry.attributes.position;
      const a = p.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] -= dt * (5 + (i % 7));
        a[i] += Math.sin(raceTime + i) * dt * 0.8;
        if (a[i + 1] < 0) a[i + 1] += 60;
      }
      p.needsUpdate = true;
      this.snow.position.set(Math.round(camera.position.x / 4) * 4 - 60, 0, Math.round(camera.position.z / 4) * 4 - 60);
    }
  }

  updateRollers(t) {
    if (!this.rollerMeshes) return;
    this.rollers.forEach((r, k) => {
      const m = this.rollerMeshes[k];
      const p = this.rollerAt(r, t);
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = Math.atan2(this.tx[r.idx], this.tz[r.idx]);
      m.userData.ball.rotation.z = -p.lat / ROLLER_RADIUS;
    });
  }

  // A strip that follows the track between two lateral offsets, at road height + y.
  // opts.from/to limit it to part of the lap; opts.absY uses y as an absolute height.
  ribbon(latA, latB, y, vLen, material, opts = {}) {
    const N = this.N;
    const from = opts.from ?? 0;
    const count = opts.to !== undefined ? this.wrap(opts.to - from) : N;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let k = 0; k <= count; k++) {
      const i = this.wrap(from + k);
      const v = (k * this.spacing) / vLen;
      const yy = opts.absY ? y : this.py[i] + y;
      positions.push(this.px[i] + this.nx[i] * latA, yy, this.pz[i] + this.nz[i] * latA);
      positions.push(this.px[i] + this.nx[i] * latB, yy, this.pz[i] + this.nz[i] * latB);
      uvs.push(0, v, 1, v);
      if (k < count) {
        const next = this.wrap(i + 1);
        if (!opts.absY && (this.gap[i] || this.gap[next])) continue;
        const a = k * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    return new THREE.Mesh(geometry(positions, uvs, indices), material);
  }

  wall(lat, height, material) {
    const N = this.N;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let k = 0; k <= N; k++) {
      const i = k % N;
      const x = this.px[i] + this.nx[i] * lat;
      const z = this.pz[i] + this.nz[i] * lat;
      const u = (k * this.spacing) / 4;
      positions.push(x, this.py[i], z, x, this.py[i] + height, z);
      uvs.push(u, 0, u, 1);
      if (k < N && !this.gap[i] && !this.gap[(i + 1) % N]) {
        const a = k * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    return new THREE.Mesh(geometry(positions, uvs, indices), material);
  }

  // Sloped earth bank from the barrier down to the ground, wherever the road is raised.
  bank(side, material) {
    const N = this.N;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let k = 0; k <= N; k++) {
      const i = k % N;
      const h = this.py[i];
      const inner = side * this.wallLat;
      const outer = side * (this.wallLat + h * BANK_SLOPE + 0.3);
      positions.push(this.px[i] + this.nx[i] * inner, h, this.pz[i] + this.nz[i] * inner);
      positions.push(this.px[i] + this.nx[i] * outer, -0.05, this.pz[i] + this.nz[i] * outer);
      const v = (k * this.spacing) / 8;
      uvs.push(0, v, Math.max(0.2, h / 4), v);
      const j = (i + 1) % N;
      if (k < N && !this.gap[i] && !this.gap[j] && (h > 0.05 || this.py[j] > 0.05)) {
        const a = k * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    return new THREE.Mesh(geometry(positions, uvs, indices), material);
  }

  // Vertical end face where the road stops at a gap.
  cliff(idx, material) {
    const i = this.wrap(idx);
    const h = this.py[i];
    const w = this.wallLat;
    const W = this.wallLat + h * BANK_SLOPE + 0.3;
    const P = (lat, y) => [this.px[i] + this.nx[i] * lat, y, this.pz[i] + this.nz[i] * lat];
    const positions = [...P(-w, h), ...P(w, h), ...P(W, -0.05), ...P(-W, -0.05)];
    return new THREE.Mesh(geometry(positions, [0, 1, 1, 1, 1, 0, 0, 0], [0, 1, 2, 0, 2, 3]), material);
  }

  arch(s) {
    const g = new THREE.Group();
    const postMat = new THREE.MeshLambertMaterial({ color: '#37474f' });
    const span = this.halfWidth + 2;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), postMat);
      post.position.set(side * span, 3.5, 0);
      g.add(post);
    }
    const bannerTex = canvasTexture(512, 64, (ctx, w, h) => {
      ctx.fillStyle = '#d32f2f';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 44px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★  KART CLASH  ★', w / 2, h / 2 + 2);
    });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.8, 1.8, 0.4), new THREE.MeshLambertMaterial({ map: bannerTex }));
    banner.position.set(0, 6.4, 0);
    g.add(banner);
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.h;
    return g;
  }

  // Distance from (x, z) to the edge of the track's footprint (including banks).
  clearance(x, z) {
    const n = this.nearest(x, z);
    return Math.abs(n.lat) - (this.wallLat + this.py[n.idx] * BANK_SLOPE);
  }

  addScenery(group) {
    const rand = rng({ sunny: 7, desert: 42, frosty: 99 }[this.id] || 1);
    const theme = this.def.theme;
    const th = this.theme;
    const b = this.bounds;
    const spots = [];
    for (let tries = 0; tries < 1600 && spots.length < 260; tries++) {
      const x = b.minX - 120 + rand() * (b.maxX - b.minX + 240);
      const z = b.minZ - 120 + rand() * (b.maxZ - b.minZ + 240);
      if (this.clearance(x, z) < 4) continue;
      spots.push([x, z, 0.7 + rand() * 0.8, rand() * Math.PI * 2]);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (mesh, list, fn) => {
      list.forEach((spot, i) => {
        const [x, z, s, r] = spot;
        const { px, py, pz, sx, sy, sz, ry = r, rz = 0 } = fn(spot);
        q.setFromEuler(new THREE.Euler(0, ry, rz));
        m.compose(new THREE.Vector3(x + (px || 0), py, z + (pz || 0)), q, new THREE.Vector3(sx * s, sy * s, sz * s));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    };

    if (theme === 'grass' || theme === 'snow') {
      const snow = theme === 'snow';
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), new THREE.MeshLambertMaterial({ color: '#7b5a3a' }), spots.length);
      const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 6, 7), new THREE.MeshLambertMaterial({ color: snow ? '#2f5d3a' : '#2e7d32', flatShading: true }), spots.length);
      place(trunk, spots, () => ({ py: 1.5, sx: 1, sy: 1, sz: 1 }));
      place(leaves, spots, ([, , s]) => ({ py: 3 * s + 2.6 * s, sx: 1, sy: 1, sz: 1 }));
      if (snow) {
        const caps = new THREE.InstancedMesh(new THREE.ConeGeometry(1.5, 2.6, 7), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), spots.length);
        place(caps, spots, ([, , s]) => ({ py: 3 * s + 4.6 * s, sx: 1, sy: 1, sz: 1 }));
        this.addSnowmen(group, spots.slice(0, 8));
        this.addSnowfall(group);
      } else {
        this.addBalloons(group, rand);
      }
    } else {
      const cacti = spots.filter((_, i) => i % 3 !== 0);
      const rocks = spots.filter((_, i) => i % 3 === 0);
      const green = new THREE.MeshLambertMaterial({ color: '#4c8c3a', flatShading: true });
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 0.7, 6, 7), green, cacti.length);
      const arm1 = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.45, 2.6, 6), green, cacti.length);
      const arm2 = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.45, 2.2, 6), green, cacti.length);
      place(trunk, cacti, () => ({ py: 3, sx: 1, sy: 1, sz: 1 }));
      place(arm1, cacti, ([, , s, r]) => ({ px: Math.cos(r) * 1.1 * s, pz: -Math.sin(r) * 1.1 * s, py: 3.4 * s, sx: 1, sy: 1, sz: 1, rz: -0.6 }));
      place(arm2, cacti, ([, , s, r]) => ({ px: -Math.cos(r) * 1.0 * s, pz: Math.sin(r) * 1.0 * s, py: 2.6 * s, sx: 1, sy: 1, sz: 1, rz: 0.6 }));
      const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.6, 0), new THREE.MeshLambertMaterial({ color: '#a0643a', flatShading: true }), rocks.length);
      place(rock, rocks, () => ({ py: 0.6, sx: 1.4, sy: 0.9, sz: 1.2 }));
      this.addMesas(group, rand);
    }

    this.addGrandstand(group, rand);

    // Distant mountains in a ring
    const mountainMat = new THREE.MeshLambertMaterial({ color: th.mountain, flatShading: true });
    const count = 28;
    const mountains = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), mountainMat, count);
    const peaks = theme === 'snow' ? new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), count) : null;
    const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 260;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.15;
      const r = radius + rand() * 120;
      const w = 60 + rand() * 80;
      const h = (theme === 'snow' ? 90 : 50) + rand() * 90;
      q.setFromAxisAngle(up, rand() * Math.PI);
      const cx = b.cx + Math.cos(a) * r;
      const cz = b.cz + Math.sin(a) * r;
      m.compose(new THREE.Vector3(cx, h / 2 - 2, cz), q, new THREE.Vector3(w, h, w));
      mountains.setMatrixAt(i, m);
      if (peaks) {
        m.compose(new THREE.Vector3(cx, h - 2 - h * 0.15 + 0.5, cz), q, new THREE.Vector3(w * 0.31, h * 0.31, w * 0.31));
        peaks.setMatrixAt(i, m);
      }
    }
    group.add(mountains);
    if (peaks) group.add(peaks);

    // Clouds
    const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.35 });
    const puff = new THREE.SphereGeometry(1, 8, 6);
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const p = new THREE.Mesh(puff, cloudMat);
        p.scale.setScalar(8 + rand() * 7);
        p.position.set(j * 9 - 13 + rand() * 4, rand() * 4, rand() * 6);
        cloud.add(p);
      }
      const a = rand() * Math.PI * 2;
      const r = 150 + rand() * 350;
      cloud.position.set(b.cx + Math.cos(a) * r, 90 + rand() * 60, b.cz + Math.sin(a) * r);
      cloud.rotation.y = rand() * Math.PI;
      group.add(cloud);
    }
  }

  // Stands full of cheering fans beside the start straight, plus flags.
  addGrandstand(group, rand) {
    const idx = this.wrap(-14);
    let side = 1;
    const test = (sd) => this.clearance(this.px[idx] + this.nx[idx] * sd * (this.wallLat + 14), this.pz[idx] + this.nz[idx] * sd * (this.wallLat + 14));
    if (test(-1) > test(1)) side = -1;
    const stand = new THREE.Group();
    const steps = 4;
    const len = 44;
    const stepMat = new THREE.MeshLambertMaterial({ color: '#90a4ae' });
    const fanColors = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#ffffff', '#8e24aa', '#fb8c00'];
    const fanGeo = new THREE.BoxGeometry(0.7, 1.1, 0.6);
    const fans = new THREE.InstancedMesh(fanGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), steps * 30);
    const m = new THREE.Matrix4();
    let n = 0;
    for (let s = 0; s < steps; s++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2 * (s + 1), 2.4), stepMat);
      step.position.set(0, 0.6 * (s + 1), 3 + s * 2.4);
      stand.add(step);
      for (let k = 0; k < 30; k++) {
        m.makeTranslation(-len / 2 + 1 + k * ((len - 2) / 29), 1.2 * (s + 1) + 0.55, 3 + s * 2.4);
        fans.setMatrixAt(n, m);
        fans.setColorAt(n, new THREE.Color(fanColors[Math.floor(rand() * fanColors.length)]));
        n++;
      }
    }
    fans.instanceMatrix.needsUpdate = true;
    if (fans.instanceColor) fans.instanceColor.needsUpdate = true;
    stand.add(fans);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.4, steps * 2.4 + 2), new THREE.MeshLambertMaterial({ color: this.theme.wallA }));
    roof.position.set(0, 1.2 * steps + 4, 3 + (steps - 1) * 1.2);
    stand.add(roof);
    for (const x of [-len / 2, len / 2]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2 * steps + 4, 0.5), stepMat);
      pole.position.set(x, (1.2 * steps + 4) / 2, 3 + steps * 2.4);
      stand.add(pole);
    }
    const lat = side * (this.wallLat + 2);
    stand.position.set(this.px[idx] + this.nx[idx] * lat, this.py[idx], this.pz[idx] + this.nz[idx] * lat);
    // Local +z points away from the road.
    stand.rotation.y = Math.atan2(this.nx[idx] * side, this.nz[idx] * side);
    group.add(stand);

    // Flags along the start straight
    const flagGeo = new THREE.PlaneGeometry(1.6, 1);
    flagGeo.translate(0.8, 0, 0);
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 5, 5);
    const poleMat = new THREE.MeshLambertMaterial({ color: '#eeeeee' });
    for (let k = 0; k < 10; k++) {
      const i = this.wrap(-40 + k * 8);
      for (const sd of [-1, 1]) {
        const lt = sd * (this.wallLat + 0.6);
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(this.px[i] + this.nx[i] * lt, this.py[i] + 2.5, this.pz[i] + this.nz[i] * lt);
        const flag = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({ color: fanColors[(k + (sd > 0 ? 0 : 3)) % fanColors.length], side: THREE.DoubleSide }));
        flag.position.set(0, 1.9, 0);
        flag.rotation.y = rand() * Math.PI * 2;
        pole.add(flag);
        group.add(pole);
      }
    }
  }

  addBalloons(group, rand) {
    const b = this.bounds;
    const colors = ['#e53935', '#fdd835', '#1e88e5', '#8e24aa', '#fb8c00'];
    this.balloons = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const env = new THREE.Mesh(new THREE.SphereGeometry(6, 14, 10), new THREE.MeshLambertMaterial({ color: colors[i % colors.length] }));
      env.scale.y = 1.2;
      g.add(env);
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(6.05, 0.5, 6, 20), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
      stripe.rotation.x = Math.PI / 2;
      g.add(stripe);
      const basket = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), new THREE.MeshLambertMaterial({ color: '#8d6e63' }));
      basket.position.y = -9.5;
      g.add(basket);
      const x = b.minX - 40 + rand() * (b.maxX - b.minX + 80);
      const z = b.minZ - 40 + rand() * (b.maxZ - b.minZ + 80);
      g.userData = { y: 45 + rand() * 40, p: rand() * 6 };
      g.position.set(x, g.userData.y, z);
      group.add(g);
      this.balloons.push(g);
    }
  }

  addMesas(group, rand) {
    const b = this.bounds;
    const layers = ['#b5562e', '#d07a45', '#c4683a'];
    let placed = 0;
    for (let tries = 0; tries < 200 && placed < 9; tries++) {
      const x = b.minX - 150 + rand() * (b.maxX - b.minX + 300);
      const z = b.minZ - 150 + rand() * (b.maxZ - b.minZ + 300);
      const r = 14 + rand() * 18;
      if (this.clearance(x, z) < r + 10) continue;
      const h = 20 + rand() * 30;
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(r * (1 - k * 0.06) - 1, r * (1 - k * 0.06), h / 3, 9),
          new THREE.MeshLambertMaterial({ color: layers[k], flatShading: true })
        );
        seg.position.y = h / 6 + (k * h) / 3;
        g.add(seg);
      }
      g.position.set(x, 0, z);
      g.rotation.y = rand() * Math.PI;
      group.add(g);
      placed++;
    }
  }

  addSnowmen(group, spots) {
    const white = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const orange = new THREE.MeshLambertMaterial({ color: '#ff7043' });
    const black = new THREE.MeshLambertMaterial({ color: '#212121' });
    for (const [x, z, s, r] of spots) {
      if (this.clearance(x + 5, z + 5) < 3) continue;
      const g = new THREE.Group();
      [[1.3, 1.2], [0.95, 3.1], [0.7, 4.5]].forEach(([rad, y]) => {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(rad, 12, 10), white);
        ball.position.y = y;
        g.add(ball);
      });
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.7, 6), orange);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 4.5, 0.85);
      g.add(nose);
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.8, 10), black);
      hat.position.y = 5.4;
      g.add(hat);
      g.position.set(x + 5, 0, z + 5);
      g.rotation.y = r;
      g.scale.setScalar(s);
      group.add(g);
    }
  }

  addSnowfall(group) {
    const count = 900;
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      a[i * 3] = Math.random() * 120;
      a[i * 3 + 1] = Math.random() * 60;
      a[i * 3 + 2] = Math.random() * 120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(a, 3));
    this.snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.35, transparent: true, opacity: 0.85, depthWrite: false }));
    this.snow.frustumCulled = false;
    group.add(this.snow);
  }
}
