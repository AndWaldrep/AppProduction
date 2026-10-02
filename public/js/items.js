import * as THREE from 'three';

export const ITEM_ICONS = {
  banana: '🍌',
  shell: '🐢',
  mushroom: '🍄',
  mushroom3: '🍄×3',
  star: '⭐',
};
export const ROULETTE = ['🍌', '🐢', '🍄', '⭐'];
const BOX_RESPAWN_MS = 3000;
const MAX_BANANAS = 40;

// Back-of-the-pack racers get better items, like the real thing.
export function rollItem(rank, total) {
  const f = total > 1 ? (rank - 1) / (total - 1) : 0.5;
  const table = f < 0.2
    ? [['banana', 50], ['shell', 35], ['mushroom', 15]]
    : f < 0.7
      ? [['banana', 25], ['shell', 35], ['mushroom', 30], ['mushroom3', 7], ['star', 3]]
      : [['banana', 8], ['shell', 25], ['mushroom', 27], ['mushroom3', 25], ['star', 15]];
  let r = Math.random() * table.reduce((a, [, w]) => a + w, 0);
  for (const [item, w] of table) {
    if ((r -= w) < 0) return item;
  }
  return 'mushroom';
}

function boxTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 64, 64);
  g.addColorStop(0, '#ff5ec4');
  g.addColorStop(0.5, '#5ec8ff');
  g.addColorStop(1, '#ffe05e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, 58, 58);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 32, 35);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ItemBoxes {
  constructor(track, scene) {
    this.group = new THREE.Group();
    const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const mat = new THREE.MeshLambertMaterial({ map: boxTexture(), transparent: true, opacity: 0.88, emissive: '#ffffff', emissiveIntensity: 0.25 });
    this.boxes = track.boxes.map((b, i) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.x, 1.4, b.z);
      mesh.rotation.set(0.6, i, 0.4);
      this.group.add(mesh);
      return { x: b.x, z: b.z, mesh, respawnAt: 0 };
    });
    scene.add(this.group);
  }

  update(dt, now) {
    for (const b of this.boxes) {
      const active = now >= b.respawnAt;
      b.mesh.visible = active;
      if (active) {
        b.mesh.rotation.y += dt * 1.6;
        b.mesh.rotation.x += dt * 0.7;
        b.mesh.position.y = 1.4 + Math.sin(now / 300 + b.x) * 0.2;
        const grow = Math.min(1, (now - b.respawnAt) / 300);
        b.mesh.scale.setScalar(grow);
      }
    }
  }

  // Returns the index of a box the kart just drove through, or -1.
  touch(x, z, now) {
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (now < b.respawnAt) continue;
      if ((b.x - x) ** 2 + (b.z - z) ** 2 < 2.4 * 2.4) {
        b.respawnAt = now + BOX_RESPAWN_MS;
        return i;
      }
    }
    return -1;
  }

  take(i, now) {
    if (this.boxes[i]) this.boxes[i].respawnAt = now + BOX_RESPAWN_MS;
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}

// ------------------------------------------------------------------ bananas & shells

const bananaGeo = (() => {
  const g = new THREE.TorusGeometry(0.55, 0.2, 6, 10, Math.PI * 1.1);
  g.rotateZ(-Math.PI * 0.05);
  return g;
})();
const bananaMat = new THREE.MeshLambertMaterial({ color: '#ffd600', emissive: '#6d5a00', emissiveIntensity: 0.4 });
const shellTopGeo = new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const shellMat = new THREE.MeshLambertMaterial({ color: '#2ecc40', emissive: '#0b4d12', emissiveIntensity: 0.5 });
const rimGeo = new THREE.TorusGeometry(0.7, 0.15, 6, 16);
rimGeo.rotateX(Math.PI / 2);
const rimMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });

export class Hazards {
  constructor(track, scene) {
    this.track = track;
    this.scene = scene;
    this.list = new Map();
  }

  add({ hid, kind, x, z, vx = 0, vz = 0, owner, idx = -1 }, now) {
    if (this.list.has(hid)) return;
    const mesh = new THREE.Group();
    if (kind === 'banana') {
      const b = new THREE.Mesh(bananaGeo, bananaMat);
      b.position.y = 0.55;
      mesh.add(b);
    } else {
      const top = new THREE.Mesh(shellTopGeo, shellMat);
      top.position.y = 0.25;
      mesh.add(top);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.y = 0.25;
      mesh.add(rim);
    }
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.list.set(hid, { hid, kind, x, z, vx, vz, owner, born: now, bounces: 0, mesh, idx });
    if (kind === 'banana') {
      const bananas = [...this.list.values()].filter((h) => h.kind === 'banana');
      if (bananas.length > MAX_BANANAS) this.remove(bananas[0].hid);
    }
  }

  remove(hid) {
    const h = this.list.get(hid);
    if (!h) return;
    this.scene.remove(h.mesh);
    this.list.delete(hid);
  }

  update(dt, now) {
    const t = this.track;
    for (const h of [...this.list.values()]) {
      if (h.kind === 'banana') {
        h.mesh.rotation.y += dt * 0.5;
        continue;
      }
      h.x += h.vx * dt;
      h.z += h.vz * dt;
      const n = t.nearest(h.x, h.z, h.idx);
      h.idx = n.idx;
      const limit = t.wallLat - 0.7;
      if (Math.abs(n.lat) > limit) {
        const s = Math.sign(n.lat);
        const nx = t.nx[n.idx] * s;
        const nz = t.nz[n.idx] * s;
        const over = Math.abs(n.lat) - limit;
        h.x -= nx * over;
        h.z -= nz * over;
        const vn = h.vx * nx + h.vz * nz;
        if (vn > 0) {
          h.vx -= 2 * vn * nx;
          h.vz -= 2 * vn * nz;
        }
        h.bounces++;
      }
      h.mesh.position.set(h.x, 0, h.z);
      h.mesh.rotation.y += dt * 14;
      if (h.bounces > 6 || now - h.born > 9000) this.remove(h.hid);
    }
  }

  // Returns the hazard id that hit this kart (and removes it), or null.
  collide(kartId, x, z, now) {
    for (const h of this.list.values()) {
      if (h.owner === kartId && now - h.born < 700) continue;
      const r = h.kind === 'banana' ? 1.7 : 1.9;
      if ((h.x - x) ** 2 + (h.z - z) ** 2 < r * r) {
        this.remove(h.hid);
        return h;
      }
    }
    return null;
  }

  clear() {
    for (const hid of [...this.list.keys()]) this.remove(hid);
  }
}
