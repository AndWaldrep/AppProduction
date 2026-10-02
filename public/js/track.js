import * as THREE from 'three';
import { TRACKS } from './tracks.js';

export const WALL_MARGIN = 5; // grass strip between the road edge and the barrier

const THEMES = {
  grass: {
    skyTop: '#3d8fe0', skyBottom: '#bfe6ff', fog: '#bfe6ff',
    ground: '#5fae4a', groundDots: ['#4f9a3c', '#6cbd55', '#58a344'],
    road: '#5b5e66', wallA: '#e53935', wallB: '#ffffff',
    mountain: '#6f9f5a', mountainTop: '#f4f4f4',
  },
  desert: {
    skyTop: '#f28c4a', skyBottom: '#ffe1a8', fog: '#ffd9a0',
    ground: '#e2b86e', groundDots: ['#d6a95c', '#ecc584', '#cf9f52'],
    road: '#6e6259', wallA: '#ff8f00', wallB: '#fff3e0',
    mountain: '#c9783f', mountainTop: '#e5a066',
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

    this.pads = def.pads.map((p) => ({ idx: Math.round(p.at * N), lat: p.lat, halfW: 2.4, halfL: 3.2 }));
    this.boxes = [];
    for (const f of def.boxes) {
      const idx = Math.round(f * N);
      for (const lat of [-6, -2, 2, 6]) {
        this.boxes.push({ x: this.px[idx] + this.nx[idx] * lat, z: this.pz[idx] + this.nz[idx] * lat });
      }
    }

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

  pointAt(idx, lat = 0) {
    const i = this.wrap(Math.round(idx));
    return { x: this.px[i] + this.nx[i] * lat, z: this.pz[i] + this.nz[i] * lat, h: Math.atan2(this.tx[i], this.tz[i]) };
  }

  gridPose(slot) {
    const row = Math.floor(slot / 2);
    const col = slot % 2;
    const idx = this.N - 5 - row * 5 - col * 2;
    const p = this.pointAt(idx, col ? -3.5 : 3.5);
    return { ...p, idx: this.wrap(idx) };
  }

  // ------------------------------------------------------------ visuals

  build() {
    const group = new THREE.Group();
    const th = this.theme;
    const N = this.N;

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
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1800),
      new THREE.MeshLambertMaterial({ map: groundTex })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.bounds.cx, -0.02, this.bounds.cz);
    group.add(ground);

    // Road surface
    const roadTex = canvasTexture(128, 256, (ctx, w, h) => {
      ctx.fillStyle = th.road;
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, ['#4c4f56', '#6a6d75', '#55585f'], 2500, 2);
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(5, 0, 4, h);
      ctx.fillRect(w - 9, 0, 4, h);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(w / 2 - 2, 0, 4, h / 2);
    });
    group.add(this.ribbon(-this.halfWidth, this.halfWidth, 0.02, 0.02, 16, new THREE.MeshLambertMaterial({ map: roadTex })));

    // Red/white curbs
    const curbTex = canvasTexture(16, 64, (ctx, w, h) => {
      ctx.fillStyle = th.wallA;
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, h / 2, w, h / 2);
    });
    const curbMat = new THREE.MeshLambertMaterial({ map: curbTex });
    group.add(this.ribbon(this.halfWidth, this.halfWidth + 1.4, 0.04, 0.04, 5, curbMat));
    group.add(this.ribbon(-this.halfWidth - 1.4, -this.halfWidth, 0.04, 0.04, 5, curbMat));

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
    const checker = canvasTexture(64, 16, (ctx, w, h) => {
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
    line.position.set(s.x, 0.05, s.z);
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
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, 0.06, p.z);
      group.add(m);
    }

    this.addScenery(group);
    return group;
  }

  // A strip that follows the track between two lateral offsets.
  ribbon(latA, latB, yA, yB, vLen, material) {
    const N = this.N;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let k = 0; k <= N; k++) {
      const i = k % N;
      const v = (k * this.spacing) / vLen;
      positions.push(this.px[i] + this.nx[i] * latA, yA, this.pz[i] + this.nz[i] * latA);
      positions.push(this.px[i] + this.nx[i] * latB, yB, this.pz[i] + this.nz[i] * latB);
      uvs.push(0, v, 1, v);
      if (k < N) {
        const a = k * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
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
      positions.push(x, 0, z, x, height, z);
      uvs.push(u, 0, u, 1);
      if (k < N) {
        const a = k * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
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
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(span * 2 + 0.8, 1.8, 0.4),
      new THREE.MeshLambertMaterial({ map: bannerTex })
    );
    banner.position.set(0, 6.4, 0);
    g.add(banner);
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.h;
    return g;
  }

  distanceToTrack(x, z) {
    const n = this.nearest(x, z);
    return Math.abs(n.lat);
  }

  addScenery(group) {
    const rand = rng(this.id === 'sunny' ? 7 : 42);
    const th = this.theme;
    const b = this.bounds;
    const spots = [];
    for (let tries = 0; tries < 1400 && spots.length < 260; tries++) {
      const x = b.minX - 120 + rand() * (b.maxX - b.minX + 240);
      const z = b.minZ - 120 + rand() * (b.maxZ - b.minZ + 240);
      if (this.distanceToTrack(x, z) < this.wallLat + 4) continue;
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

    if (th === THEMES.grass) {
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), new THREE.MeshLambertMaterial({ color: '#7b5a3a' }), spots.length);
      const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 6, 7), new THREE.MeshLambertMaterial({ color: '#2e7d32', flatShading: true }), spots.length);
      place(trunk, spots, () => ({ py: 1.5, sx: 1, sy: 1, sz: 1 }));
      place(leaves, spots, ([, , s]) => ({ py: 3 * s + 2.6 * s, sx: 1, sy: 1, sz: 1 }));
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
    }

    // Distant mountains in a ring
    const mountainGeo = new THREE.ConeGeometry(1, 1, 6);
    const mountainMat = new THREE.MeshLambertMaterial({ color: th.mountain, flatShading: true });
    const count = 28;
    const mountains = new THREE.InstancedMesh(mountainGeo, mountainMat, count);
    const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 260;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.15;
      const r = radius + rand() * 120;
      const w = 60 + rand() * 80;
      const h = 50 + rand() * 90;
      q.setFromAxisAngle(up, rand() * Math.PI);
      m.compose(new THREE.Vector3(b.cx + Math.cos(a) * r, h / 2 - 2, b.cz + Math.sin(a) * r), q, new THREE.Vector3(w, h, w));
      mountains.setMatrixAt(i, m);
    }
    group.add(mountains);

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
}
