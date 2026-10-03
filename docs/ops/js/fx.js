// Bullet tracers, impact puffs, grenades and explosions, from small reusable pools.

import * as THREE from 'three';
import { glowTexture } from './soldier.js';

let smokeTex = null;
function smokeTexture() {
  if (smokeTex) return smokeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  smokeTex = new THREE.CanvasTexture(c);
  return smokeTex;
}

const tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1).translate(0, 0, -0.5);

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    for (let i = 0; i < 30; i++) {
      const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: '#ffe38a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }
    this.parts = [];
    for (let i = 0; i < 140; i++) {
      const mat = new THREE.SpriteMaterial({ map: smokeTexture(), transparent: true, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.parts.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 0, size: 1, glow: false, grav: 0 });
    }
    this.nades = new Map();
    this.nadeGeo = new THREE.SphereGeometry(0.09, 8, 6);
    this.nadeMat = new THREE.MeshLambertMaterial({ color: '#3d4a2f' });
    this.pi = 0;
    this.ti = 0;
  }

  tracer(from, to, color = '#ffe38a') {
    const t = this.tracers[this.ti++ % this.tracers.length];
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.rotateY(Math.PI); // geometry points down -z; lookAt aims +z
    t.mesh.scale.set(1, 1, len);
    t.mesh.material.color.set(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = 0.07;
  }

  particle(x, y, z, o) {
    const p = this.parts[this.pi++ % this.parts.length];
    p.s.position.set(x, y, z);
    p.life = p.max = o.life ?? 0.5;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.vz = o.vz ?? 0;
    p.size = o.size ?? 0.3;
    p.grow = o.grow ?? 1;
    p.grav = o.grav ?? 0;
    p.glow = !!o.glow;
    p.s.material.map = p.glow ? glowTexture() : smokeTexture();
    p.s.material.blending = p.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.s.material.color.set(o.color ?? '#cccccc');
    p.s.material.opacity = o.opacity ?? 0.8;
    p.alpha = o.opacity ?? 0.8;
    p.s.scale.set(p.size, p.size, 1);
    p.s.visible = true;
  }

  impact(x, y, z, nx, ny, nz, color = '#cdbb9a') {
    for (let i = 0; i < 4; i++) {
      this.particle(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, {
        life: 0.35 + Math.random() * 0.25,
        vx: nx * 1.5 + (Math.random() - 0.5) * 1.6,
        vy: ny * 1.5 + Math.random() * 1.2,
        vz: nz * 1.5 + (Math.random() - 0.5) * 1.6,
        size: 0.12 + Math.random() * 0.1,
        grow: 1.2,
        color,
        grav: 3,
      });
    }
    this.particle(x, y, z, { life: 0.06, size: 0.25, glow: true, color: '#ffd27a', opacity: 1 });
  }

  blood(x, y, z) {
    for (let i = 0; i < 5; i++) {
      this.particle(x, y, z, {
        life: 0.3 + Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 2,
        vy: Math.random() * 1.5,
        vz: (Math.random() - 0.5) * 2,
        size: 0.1 + Math.random() * 0.1,
        grow: 0.6,
        color: '#b0141a',
        opacity: 0.9,
        grav: 6,
      });
    }
  }

  explosion(x, y, z) {
    this.particle(x, y + 0.5, z, { life: 0.25, size: 5, grow: 2, glow: true, color: '#ffcf6a', opacity: 1 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3;
      this.particle(x, y + 0.3, z, {
        life: 0.9 + Math.random() * 0.8,
        vx: Math.cos(a) * sp,
        vy: 1 + Math.random() * 2.5,
        vz: Math.sin(a) * sp,
        size: 0.8 + Math.random() * 0.8,
        grow: 2.2,
        color: i < 4 ? '#ff9a3a' : '#555049',
        opacity: 0.85,
      });
    }
    for (let i = 0; i < 10; i++) {
      this.particle(x, y + 0.2, z, {
        life: 0.5,
        vx: (Math.random() - 0.5) * 12,
        vy: 3 + Math.random() * 6,
        vz: (Math.random() - 0.5) * 12,
        size: 0.12,
        grow: 0,
        glow: true,
        color: '#ffb347',
        opacity: 1,
        grav: 14,
      });
    }
  }

  addNade(g) {
    const mesh = new THREE.Mesh(this.nadeGeo, this.nadeMat);
    mesh.position.set(g.x, g.y, g.z);
    this.scene.add(mesh);
    this.nades.set(g, mesh);
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      p.vy -= p.grav * dt;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      const k = Math.exp(-dt * 2);
      p.vx *= k;
      p.vz *= k;
      const age = 1 - p.life / p.max;
      const sz = p.size * (1 + p.grow * age);
      p.s.scale.set(sz, sz, 1);
      p.s.material.opacity = p.alpha * (1 - age);
    }
    for (const [g, mesh] of this.nades) {
      if (g.done) {
        this.scene.remove(mesh);
        this.nades.delete(g);
        continue;
      }
      mesh.position.set(g.x, g.y, g.z);
      mesh.rotation.x += dt * 8;
    }
  }

  clear() {
    for (const t of this.tracers) (t.life = 0), (t.mesh.visible = false);
    for (const p of this.parts) (p.life = 0), (p.s.visible = false);
    for (const mesh of this.nades.values()) this.scene.remove(mesh);
    this.nades.clear();
  }
}
