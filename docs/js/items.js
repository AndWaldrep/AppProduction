import * as THREE from 'three';

export const ITEM_ICONS = {
  banana: '🍌',
  shell: '🐢',
  mushroom: '🍄',
  mushroom3: '🍄×3',
  star: '⭐',
  rocket: '🚀',
  glider: '🪂',
  ghost: '👻',
  tornado: '🌪️',
  bomb: '💣',
};
// What each newer item does, shown the first time you get one.
export const ITEM_TIPS = {
  rocket: '🚀 Rocket! Tap ITEM to blast down the track on autopilot',
  glider: '🪂 Glider! Tap ITEM to launch into the sky and glide',
  ghost: '👻 Ghost! Tap ITEM to pass right through everything',
  tornado: '🌪️ Tornado! Tap ITEM to send a twister up the track',
  bomb: '💣 Bomb! Tap ITEM to lob it ahead. Boom!',
};
export const ROULETTE = ['🍌', '🐢', '🍄', '⭐', '🚀', '🪂', '👻', '🌪️', '💣'];
const BOX_RESPAWN_MS = 3000;
const MAX_BANANAS = 40;
const TORNADO_SPEED = 44; // faster than a kart, so it catches whoever is ahead
const TORNADO_LIFE_MS = 8000;
const BOMB_FUSE_MS = 2400;
export const BLAST_RADIUS = 8;

// Back-of-the-pack racers get better items, like the real thing.
export function rollItem(rank, total) {
  const f = total > 1 ? (rank - 1) / (total - 1) : 0.5;
  const table = f < 0.2
    ? [['banana', 38], ['shell', 28], ['mushroom', 14], ['bomb', 12], ['ghost', 8]]
    : f < 0.7
      ? [['banana', 14], ['shell', 22], ['mushroom', 16], ['mushroom3', 8], ['bomb', 12], ['tornado', 10], ['ghost', 8], ['glider', 6], ['star', 4]]
      : [['shell', 10], ['mushroom', 10], ['mushroom3', 14], ['star', 12], ['rocket', 18], ['glider', 16], ['tornado', 12], ['ghost', 8]];
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
      mesh.position.set(b.x, b.y + 1.4, b.z);
      mesh.rotation.set(0.6, i, 0.4);
      this.group.add(mesh);
      return { x: b.x, y: b.y, z: b.z, mesh, respawnAt: 0 };
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
        b.mesh.position.y = b.y + 1.4 + Math.sin(now / 300 + b.x) * 0.2;
        const grow = Math.min(1, (now - b.respawnAt) / 300);
        b.mesh.scale.setScalar(grow);
      }
    }
  }

  // Returns the index of a box the kart just drove through, or -1.
  touch(x, y, z, now) {
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (now < b.respawnAt || Math.abs(y - b.y) > 3) continue;
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

// ------------------------------------------------------------------ bananas, shells, tornadoes, bombs

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
const twisterMat = new THREE.MeshLambertMaterial({ color: '#cfd8dc', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
const bombMat = new THREE.MeshLambertMaterial({ color: '#212121' });
const fuseMat = new THREE.MeshBasicMaterial({ color: '#ff3d00' });
const blastMat = new THREE.MeshBasicMaterial({ color: '#ff9100', transparent: true, opacity: 0.8, depthWrite: false });

function hazardMesh(kind) {
  const mesh = new THREE.Group();
  if (kind === 'banana') {
    const b = new THREE.Mesh(bananaGeo, bananaMat);
    b.position.y = 0.55;
    mesh.add(b);
  } else if (kind === 'tornado') {
    // A stack of open cones, each spinning a little differently.
    for (let i = 0; i < 5; i++) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.9 + i * 0.7, 0.5 + i * 0.6, 1.6, 12, 1, true), twisterMat);
      cone.position.y = 0.8 + i * 1.5;
      mesh.add(cone);
    }
  } else if (kind === 'bomb') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10), bombMat);
    ball.position.y = 0.75;
    mesh.add(ball);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 8), bombMat);
    cap.position.y = 1.55;
    mesh.add(cap);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), fuseMat);
    spark.position.y = 1.8;
    mesh.add(spark);
    mesh.userData.spark = spark;
  } else {
    const top = new THREE.Mesh(shellTopGeo, shellMat);
    top.position.y = 0.25;
    mesh.add(top);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = 0.25;
    mesh.add(rim);
  }
  return mesh;
}

export class Hazards {
  constructor(track, scene) {
    this.track = track;
    this.scene = scene;
    this.list = new Map();
    this.blasts = []; // explosion effects
    this.booms = []; // explosions that happened since the last update()
  }

  add({ hid, kind, x, z, vx = 0, vz = 0, owner, idx = -1 }, now) {
    if (this.list.has(hid)) return;
    const n = this.track.nearest(x, z, idx);
    if (this.track.isGap(n.frac) && kind !== 'tornado' && kind !== 'bomb') return; // falls in
    idx = n.idx;
    const y = this.track.heightAt(n.frac);
    const mesh = hazardMesh(kind);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    const h = { hid, kind, x, y, z, vx, vz, owner, born: now, bounces: 0, mesh, idx };
    if (kind === 'tornado') {
      h.prog = n.frac;
      h.lat = n.lat;
      h.seed = (hid.length * 7) % 10;
    }
    if (kind === 'bomb') {
      h.vy = 9; // lobbed in an arc
      h.y += 1.2;
    }
    this.list.set(hid, h);
    if (kind === 'banana') {
      const bananas = [...this.list.values()].filter((b) => b.kind === 'banana');
      if (bananas.length > MAX_BANANAS) this.remove(bananas[0].hid);
    }
  }

  remove(hid) {
    const h = this.list.get(hid);
    if (!h) return;
    this.scene.remove(h.mesh);
    this.list.delete(hid);
  }

  // Blow up a bomb now (fuse ran out, someone touched it, or another phone said so).
  explode(hid) {
    const h = this.list.get(hid);
    if (!h) return;
    this.remove(hid);
    this.booms.push({ x: h.x, y: h.y, z: h.z, owner: h.owner });
    const fx = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), blastMat.clone());
    fx.position.set(h.x, h.y + 1, h.z);
    this.scene.add(fx);
    this.blasts.push({ mesh: fx, age: 0 });
  }

  // Moves everything; returns the explosions that happened.
  update(dt, now) {
    const t = this.track;
    for (const h of [...this.list.values()]) {
      const age = now - h.born;
      if (h.kind === 'banana') {
        h.mesh.rotation.y += dt * 0.5;
        continue;
      }
      if (h.kind === 'tornado') {
        h.prog += (TORNADO_SPEED * dt) / t.spacing;
        const i = t.wrap(Math.floor(h.prog));
        const lat = Math.sin(age / 600 + h.seed) * (t.halfWidth - 2);
        h.x = t.px[i] + t.nx[i] * lat;
        h.z = t.pz[i] + t.nz[i] * lat;
        h.y = t.heightAt(h.prog);
        h.mesh.position.set(h.x, h.y, h.z);
        h.mesh.children.forEach((c, k) => (c.rotation.y += dt * (8 + k * 2)));
        h.mesh.rotation.z = Math.sin(age / 300) * 0.08;
        if (age > TORNADO_LIFE_MS) this.remove(h.hid);
        continue;
      }
      if (h.kind === 'bomb') {
        if (h.vy !== 0 || h.vx || h.vz) {
          h.x += h.vx * dt;
          h.z += h.vz * dt;
          h.vy -= 30 * dt;
          h.y += h.vy * dt;
          const n = t.nearest(h.x, h.z, h.idx);
          h.idx = n.idx;
          const gy = t.heightAt(n.frac);
          if (h.y <= gy) {
            if (t.isGap(n.frac)) {
              this.remove(h.hid);
              continue;
            }
            h.y = gy;
            h.vx = h.vz = h.vy = 0;
          }
        }
        h.mesh.position.set(h.x, h.y, h.z);
        const left = BOMB_FUSE_MS - age;
        h.mesh.userData.spark.visible = Math.floor(now / Math.max(60, left / 8)) % 2 === 0;
        h.mesh.scale.setScalar(1 + Math.max(0, 1 - left / 600) * 0.4);
        if (left <= 0) this.explode(h.hid);
        continue;
      }
      // Shells
      h.x += h.vx * dt;
      h.z += h.vz * dt;
      const n = t.nearest(h.x, h.z, h.idx);
      h.idx = n.idx;
      if (t.isGap(n.frac)) {
        this.remove(h.hid); // shells fall into gaps
        continue;
      }
      h.y = t.heightAt(n.frac);
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
      h.mesh.position.set(h.x, h.y, h.z);
      h.mesh.rotation.y += dt * 14;
      if (h.bounces > 6 || age > 9000) this.remove(h.hid);
    }
    for (const b of [...this.blasts]) {
      b.age += dt;
      b.mesh.scale.setScalar(1 + b.age * 22);
      b.mesh.material.opacity = Math.max(0, 0.8 - b.age * 1.8);
      if (b.age > 0.45) {
        this.scene.remove(b.mesh);
        this.blasts.splice(this.blasts.indexOf(b), 1);
      }
    }
    const booms = this.booms;
    this.booms = [];
    return booms;
  }

  // What hit this kart, if anything: { h, effect: 'spin' | 'launch' | 'boom' }.
  // Bananas and shells are used up; tornadoes keep going; bombs explode.
  collide(kartId, x, y, z, now) {
    for (const h of this.list.values()) {
      const immune = h.kind === 'tornado' ? 1500 : 700;
      if (h.owner === kartId && now - h.born < immune) continue;
      if (h.kind === 'tornado') {
        if (Math.abs(y - h.y) < 7 && (h.x - x) ** 2 + (h.z - z) ** 2 < 3.2 * 3.2) return { h, effect: 'launch' };
        continue;
      }
      if (Math.abs(y - h.y) > 1.6) continue;
      if (h.kind === 'bomb') {
        if (now - h.born > 500 && (h.x - x) ** 2 + (h.z - z) ** 2 < 2 * 2) return { h, effect: 'boom' };
        continue;
      }
      const r = h.kind === 'banana' ? 1.7 : 1.9;
      if ((h.x - x) ** 2 + (h.z - z) ** 2 < r * r) {
        this.remove(h.hid);
        return { h, effect: 'spin' };
      }
    }
    return null;
  }

  clear() {
    for (const hid of [...this.list.keys()]) this.remove(hid);
    for (const b of this.blasts) this.scene.remove(b.mesh);
    this.blasts = [];
    this.booms = [];
  }
}
