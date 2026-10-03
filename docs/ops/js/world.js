// Turns a map grid into 3D meshes: textured blocks with soft shading in the
// corners, a sky, scenery outside the walls, and props like palms and cranes.
// Textures are painted on canvases at startup, so there's nothing to download.

import * as THREE from 'three';

// ------------------------------------------------------------------ textures

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(size, paint, seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  paint(ctx, size, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, s, r, n, lo, hi, size = 2) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(lo + r() * (hi - lo));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(r() * s, r() * s, size, size);
  }
}

const PAINTERS = {
  sand(ctx, s, r) {
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, r, 1800, 205, 255, 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      const y = r() * s;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + 10, s * 0.6, y - 10, s, y);
      ctx.stroke();
    }
  },
  tiles(ctx, s, r) {
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(0, 0, s, s);
    const n = 2;
    const q = s / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = 215 + Math.floor(r() * 35);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x * q + 3, y * q + 3, q - 6, q - 6);
      }
    speckle(ctx, s, r, 400, 180, 240, 2);
  },
  plaster(ctx, s, r) {
    ctx.fillStyle = '#eeeeee';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const v = 215 + Math.floor(r() * 40);
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.beginPath();
      ctx.arc(r() * s, r() * s, 6 + r() * 20, 0, Math.PI * 2);
      ctx.fill();
    }
    speckle(ctx, s, r, 500, 200, 255, 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let x = r() * s;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < s * 0.5) {
      x += (r() - 0.5) * 12;
      y += 6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  },
  stone(ctx, s, r) {
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    const h = s / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * 40;
      while (x < s) {
        const w = 30 + r() * 40;
        const v = 190 + Math.floor(r() * 50);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x + 2, i * h + 2, w - 4, h - 4);
        x += w;
      }
    }
    speckle(ctx, s, r, 500, 150, 230, 2);
  },
  brick(ctx, s, r) {
    ctx.fillStyle = '#c8c8c8';
    ctx.fillRect(0, 0, s, s);
    const rows = 8;
    const h = s / rows;
    for (let i = 0; i < rows; i++) {
      const off = i % 2 ? s / 8 : 0;
      for (let x = -s / 4 + off; x < s; x += s / 4) {
        const v = 200 + Math.floor(r() * 55);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x + 2, i * h + 2, s / 4 - 4, h - 3);
      }
    }
    speckle(ctx, s, r, 300, 170, 240, 2);
  },
  wood(ctx, s, r) {
    ctx.fillStyle = '#dcdcdc';
    ctx.fillRect(0, 0, s, s);
    const planks = 4;
    const h = s / planks;
    for (let i = 0; i < planks; i++) {
      const v = 205 + Math.floor(r() * 45);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, i * h + 1, s, h - 3);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        const y = i * h + 4 + r() * (h - 8);
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.3, y + 3, s * 0.7, y - 3, s, y);
        ctx.stroke();
      }
    }
    // Crate frame
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(6, 6);
    ctx.lineTo(s - 6, s - 6);
    ctx.stroke();
  },
  metal(ctx, s, r) {
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 2) {
      const v = 200 + Math.floor(r() * 40);
      ctx.fillStyle = `rgba(${v},${v},${v},0.6)`;
      ctx.fillRect(0, i, s, 1);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (const [x, y] of [[8, 8], [s - 10, 8], [8, s - 10], [s - 10, s - 10]]) ctx.fillRect(x, y, 3, 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  },
  container(ctx, s, r) {
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(0, 0, s, s);
    const ribs = 8;
    const w = s / ribs;
    for (let i = 0; i < ribs; i++) {
      const g = ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
      g.addColorStop(0, '#bdbdbd');
      g.addColorStop(0.5, '#f4f4f4');
      g.addColorStop(1, '#c4c4c4');
      ctx.fillStyle = g;
      ctx.fillRect(i * w, 0, w, s);
    }
    speckle(ctx, s, r, 250, 150, 230, 2);
    ctx.fillStyle = 'rgba(120,70,40,0.18)';
    for (let i = 0; i < 6; i++) ctx.fillRect(r() * s, r() * s, 3 + r() * 6, 8 + r() * 20);
  },
  concrete(ctx, s, r) {
    ctx.fillStyle = '#d6d6d6';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, r, 1400, 180, 250, 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, s, s);
  },
  asphalt(ctx, s, r) {
    ctx.fillStyle = '#b8b8b8';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, r, 2000, 130, 230, 2);
    ctx.fillStyle = 'rgba(255,235,120,0.8)';
    ctx.fillRect(s / 2 - 3, 0, 6, s * 0.5);
  },
  water(ctx, s, r) {
    ctx.fillStyle = '#c8d8e0';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const x = r() * s;
      const y = r() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 8, y - 4, x + 16, y);
      ctx.stroke();
    }
  },
};

const texCache = new Map();
function tex(name) {
  if (!texCache.has(name)) texCache.set(name, canvasTex(128, PAINTERS[name] || PAINTERS.concrete, name.length * 977));
  return texCache.get(name);
}

// ------------------------------------------------------------------ the level

export function buildWorld(grid, def) {
  const root = new THREE.Group();
  const th = def.theme;
  const groups = new Map(); // texture -> buffers
  const buf = (t) => {
    if (!groups.has(t)) groups.set(t, { pos: [], nor: [], uv: [], col: [], idx: [] });
    return groups.get(t);
  };
  const color = new THREE.Color();
  const mats = grid.matNames.map((n) => def.mats[n]);
  const groundMat = def.mats[grid.matNames[0]];

  function quad(b, p, n, uv, c) {
    const base = b.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      b.pos.push(...p[i]);
      b.nor.push(...n);
      b.uv.push(...uv[i]);
      b.col.push(c[i][0], c[i][1], c[i][2]);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const W = grid.w;
  const D = grid.d;
  const vis = (x, z) => (x < 0 || z < 0 || x >= W || z >= D ? 0 : grid.vis[z * W + x]);
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      const h = grid.vis[i];
      let m = mats[grid.mat[i]];
      if (m.under && h <= 0.001) m = def.mats[m.under];
      const tint = grid.tint[i];
      color.set(m.color).multiplyScalar(tint);
      const base = [color.r, color.g, color.b];
      const shade = (k) => [base[0] * k, base[1] * k, base[2] * k];
      const b = buf(m.tex);
      // Top: darken corners next to taller blocks (cheap ambient occlusion).
      const ao = (vx, vz) => {
        let occ = 0;
        for (const [ox, oz] of [[vx - 1, vz - 1], [vx, vz - 1], [vx - 1, vz], [vx, vz]]) if (vis(ox, oz) > h + 0.25) occ++;
        return 1 - occ * 0.17;
      };
      const ts = m.tex === 'sand' || m.tex === 'concrete' || m.tex === 'asphalt' ? 0.5 : 1;
      quad(
        b,
        [[x, h, z], [x, h, z + 1], [x + 1, h, z + 1], [x + 1, h, z]],
        [0, 1, 0],
        [[x * ts, z * ts], [x * ts, (z + 1) * ts], [(x + 1) * ts, (z + 1) * ts], [(x + 1) * ts, z * ts]],
        [shade(ao(x, z)), shade(ao(x, z + 1)), shade(ao(x + 1, z + 1)), shade(ao(x + 1, z))]
      );
      // Sides wherever the neighbor is lower.
      const sides = [
        [x + 1, z, [1, 0, 0], [[x + 1, z + 1], [x + 1, z]]],
        [x - 1, z, [-1, 0, 0], [[x, z], [x, z + 1]]],
        [x, z + 1, [0, 0, 1], [[x, z + 1], [x + 1, z + 1]]],
        [x, z - 1, [0, 0, -1], [[x + 1, z], [x, z]]],
      ];
      for (const [nx, nz, n, [a, c]] of sides) {
        const nh = vis(nx, nz);
        if (nh >= h) continue;
        const lo = nh;
        const u0 = n[0] !== 0 ? a[1] : a[0];
        const u1 = n[0] !== 0 ? c[1] : c[0];
        const dark = lo <= 0.01 && h > 0.3 ? 0.72 : 0.85;
        quad(
          b,
          [[c[0], lo, c[1]], [c[0], h, c[1]], [a[0], h, a[1]], [a[0], lo, a[1]]],
          n,
          [[u1, lo], [u1, h], [u0, h], [u0, lo]],
          [shade(dark), shade(1), shade(1), shade(dark)]
        );
      }
    }
  }

  const levelMats = {};
  for (const [t, b] of groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.setIndex(b.idx);
    const mat = new THREE.MeshLambertMaterial({ map: tex(t), vertexColors: true });
    if (t === 'water') mat.map = tex('water').clone();
    levelMats[t] = mat;
    root.add(new THREE.Mesh(geo, mat));
  }
  const waterTex = levelMats.water ? levelMats.water.map : null;
  if (waterTex) waterTex.needsUpdate = true;

  root.add(buildSky(th));
  const decor = buildDecor(grid, def, groundMat);
  root.add(decor.group);
  for (const p of grid.props) {
    const m = PROPS[p.type]?.(p, def);
    if (m) root.add(m);
  }

  return {
    group: root,
    update(dt, t) {
      if (waterTex) {
        waterTex.offset.x = (t * 0.02) % 1;
        waterTex.offset.y = (t * 0.013) % 1;
      }
      if (decor.water) {
        decor.water.map.offset.x = (t * 0.01) % 1;
        decor.water.map.offset.y = (t * 0.006) % 1;
      }
    },
  };
}

function buildSky(th) {
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const top = new THREE.Color(th.skyTop);
  const bottom = new THREE.Color(th.skyBottom);
  const c = new THREE.Color();
  const cols = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 900;
    const f = Math.pow(Math.max(0, y), 0.55);
    c.copy(bottom).lerp(top, f);
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.renderOrder = -1;
  // Sun disc
  const sunGeo = new THREE.CircleGeometry(40, 24);
  const sun = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({ color: th.sun, fog: false, transparent: true, opacity: 0.85 }));
  const d = new THREE.Vector3(...th.sunDir).normalize().multiplyScalar(850);
  sun.position.copy(d);
  sun.lookAt(0, 0, 0);
  const g = new THREE.Group();
  g.add(mesh, sun);
  g.userData.sky = true;
  return g;
}

function lambert(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

function buildDecor(grid, def, groundMat) {
  const g = new THREE.Group();
  const th = def.theme;
  const cx = grid.w / 2;
  const cz = grid.d / 2;
  const r = rng(def.id.length * 31);
  let water = null;
  if (th.decor === 'dunes') {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), lambert(th.outside, { map: tex('sand') }));
    ground.material.map = tex('sand').clone();
    ground.material.map.repeat.set(400, 400);
    ground.material.map.needsUpdate = true;
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.02, cz);
    g.add(ground);
    // Dunes and mesas around the town.
    const duneMat = lambert('#dcb67a');
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + r() * 0.2;
      const dist = 60 + r() * 120;
      const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), duneMat);
      dune.scale.set(18 + r() * 25, 4 + r() * 8, 14 + r() * 20);
      dune.position.set(cx + Math.cos(a) * dist, -1, cz + Math.sin(a) * dist);
      g.add(dune);
    }
    const mesaMat = lambert('#b8754a');
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r();
      const dist = 260 + r() * 140;
      const h = 30 + r() * 50;
      const mesa = new THREE.Mesh(new THREE.CylinderGeometry(30 + r() * 30, 45 + r() * 30, h, 7), mesaMat);
      mesa.position.set(cx + Math.cos(a) * dist, h / 2 - 2, cz + Math.sin(a) * dist);
      g.add(mesa);
    }
    // Rooftops of the rest of the town peeking over the walls.
    const houseMat = lambert('#d2b088');
    for (let i = 0; i < 30; i++) {
      const side = i % 4;
      const along = r();
      const out = 6 + r() * 30;
      let x = side === 0 ? -out : side === 1 ? grid.w + out : along * grid.w;
      let z = side === 2 ? -out : side === 3 ? grid.d + out : along * grid.d;
      const w = 5 + r() * 8;
      const h = 4 + r() * 7;
      const house = new THREE.Mesh(new THREE.BoxGeometry(w, h, 5 + r() * 8), houseMat);
      house.position.set(x, h / 2, z);
      g.add(house);
    }
  } else if (th.decor === 'sea') {
    const wt = tex('water').clone();
    wt.repeat.set(160, 160);
    wt.needsUpdate = true;
    water = new THREE.MeshLambertMaterial({ color: '#2f5f7a', map: wt });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(cx + 500, -0.62, cz);
    g.add(sea);
    const landTex = tex('concrete').clone();
    landTex.repeat.set(200, 450);
    landTex.needsUpdate = true;
    const land = new THREE.Mesh(new THREE.PlaneGeometry(400, 900), lambert(th.outside, { map: landTex }));
    land.rotation.x = -Math.PI / 2;
    land.position.set(44 - 200, -0.02, cz);
    g.add(land);
    // Container stacks and warehouses outside the fence.
    const cols = ['#b8392c', '#2d6db5', '#3c8d4f', '#d9a52b', '#d8d8d2', '#7a3f8f'];
    for (let i = 0; i < 70; i++) {
      const side = i % 3;
      let x;
      let z;
      if (side === 0) (x = -4 - r() * 70), (z = r() * grid.d);
      else (x = r() * 44), (z = side === 1 ? -4 - r() * 50 : grid.d + 4 + r() * 50);
      const stack = 1 + Math.floor(r() * 3);
      const along = r() < 0.5;
      for (let k = 0; k < stack; k++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(along ? 6 : 2.4, 2.6, along ? 2.4 : 6), lambert(cols[Math.floor(r() * cols.length)], { map: tex('container') }));
        c.position.set(x, 1.3 + k * 2.6, z);
        g.add(c);
      }
    }
    // Far city skyline.
    const cityMat = lambert('#4b4560');
    for (let i = 0; i < 40; i++) {
      const h = 15 + r() * 60;
      const b = new THREE.Mesh(new THREE.BoxGeometry(10 + r() * 14, h, 10 + r() * 14), cityMat);
      b.position.set(-180 - r() * 120, h / 2, cz - 300 + i * 15 + r() * 8);
      g.add(b);
    }
  }
  return { group: g, water };
}

// ------------------------------------------------------------------ props

const PROPS = {
  palm(p) {
    const g = new THREE.Group();
    const trunkMat = lambert('#8a6239');
    let y = 0;
    let lean = 0;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.2 - i * 0.015, 0.24 - i * 0.015, 1.05, 7), trunkMat);
      lean += 0.04;
      seg.position.set(lean * i * 0.6, y + 0.5, 0);
      seg.rotation.z = -lean * 0.5;
      g.add(seg);
      y += 1;
    }
    const leafMat = lambert('#3f8f3a', { side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.45, 3.2, 4, 1, true), leafMat);
      leaf.scale.set(1, 1, 0.25);
      const a = (i / 8) * Math.PI * 2;
      leaf.position.set(lean * 3.6 + Math.cos(a) * 1.3, y - 0.2, Math.sin(a) * 1.3);
      leaf.rotation.set(Math.sin(a) * 1.25, -a, -Math.cos(a) * 1.25, 'YXZ');
      leaf.rotation.order = 'YXZ';
      leaf.rotation.y = -a + Math.PI / 2;
      leaf.rotation.x = 0;
      leaf.rotation.z = Math.PI / 2 + 0.35;
      g.add(leaf);
    }
    g.position.set(p.x, 0, p.z);
    return g;
  },
  crane(p) {
    const g = new THREE.Group();
    const orange = lambert('#e8a020');
    const beam = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.9, 0.9), orange);
    beam.position.set(0.5, 12.2, 0);
    g.add(beam);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(34, 0.8, 1.2), orange);
    boom.position.set(13, 13.1, 0);
    g.add(boom);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2.2), lambert('#dddddd'));
    cab.position.set(2, 11, 0);
    g.add(cab);
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 7, 0.06), lambert('#222'));
    cable.position.set(18, 9.5, 0);
    g.add(cable);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.4), lambert('#3c8d4f', { map: tex('container') }));
    hook.position.set(18, 4.8, 0);
    g.add(hook);
    g.position.set(p.x, 0, p.z);
    return g;
  },
  ship(p) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 70), lambert('#3a3f4a'));
    hull.position.set(0, 2, 0);
    g.add(hull);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(22.2, 1.2, 70.2), lambert('#a33a2c'));
    stripe.position.set(0, -0.8, 0);
    g.add(stripe);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(18, 9, 8), lambert('#e8e8e8'));
    bridge.position.set(0, 10, 28);
    g.add(bridge);
    const cols = ['#b8392c', '#2d6db5', '#3c8d4f', '#d9a52b', '#d8d8d2'];
    const r = rng(5);
    for (let z = -30; z < 20; z += 6.5)
      for (let x = -8; x <= 8; x += 2.6) {
        const h = 1 + Math.floor(r() * 3);
        const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6 * h, 6), lambert(cols[Math.floor(r() * cols.length)], { map: tex('container') }));
        c.position.set(x, 5.5 + 1.3 * h, z);
        g.add(c);
      }
    g.position.set(p.x + 18, 0, p.z);
    return g;
  },
};
