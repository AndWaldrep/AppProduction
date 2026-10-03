// Blocky soldier models for everyone else, with walk, crouch, aim and death poses.

import * as THREE from 'three';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const GEO = {
  leg: box(0.2, 0.82, 0.22).translate(0, -0.41, 0),
  boot: box(0.22, 0.14, 0.32).translate(0, -0.8, 0.04),
  hips: box(0.46, 0.2, 0.26),
  torso: box(0.5, 0.56, 0.28).translate(0, 0.28, 0),
  vest: box(0.54, 0.4, 0.34).translate(0, 0.3, 0),
  pack: box(0.36, 0.38, 0.14).translate(0, 0.3, 0.2),
  head: box(0.26, 0.28, 0.26),
  helmet: box(0.32, 0.14, 0.34).translate(0, 0.14, 0.01),
  visor: box(0.22, 0.06, 0.02),
  arm: box(0.14, 0.5, 0.14).translate(0, -0.25, 0),
  gun: box(0.08, 0.12, 0.72).translate(0, 0, -0.3),
  mag: box(0.06, 0.18, 0.08).translate(0, -0.14, -0.2),
};

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

let flashTex = null;
export function glowTexture() {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.3, 'rgba(255,210,90,0.9)');
  g.addColorStop(1, 'rgba(255,140,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
}

function nameSprite(name, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(name, 128, 32);
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 10;
  return s;
}

export class Soldier {
  // uniform: main color; accent: helmet/arm band color
  constructor(uniform, accent) {
    this.root = new THREE.Group();
    const body = (this.body = new THREE.Group());
    this.root.add(body);
    const pants = mat(shade(uniform, 0.55));
    const shirt = mat(uniform);
    const vest = mat(shade(uniform, 0.4));
    const skin = mat('#c99872');
    const dark = mat('#26282c');
    const helm = mat(accent);

    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    body.add(this.hips);
    this.hips.add(new THREE.Mesh(GEO.hips, pants));
    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    for (const [leg, x] of [[this.legL, -0.12], [this.legR, 0.12]]) {
      leg.position.set(x, -0.04, 0);
      leg.add(new THREE.Mesh(GEO.leg, pants));
      leg.add(new THREE.Mesh(GEO.boot, dark));
      this.hips.add(leg);
    }
    // Upper body pivots at the waist and leans with the aim.
    this.upper = new THREE.Group();
    this.upper.position.y = 0.06;
    this.hips.add(this.upper);
    this.upper.add(new THREE.Mesh(GEO.torso, shirt));
    this.upper.add(new THREE.Mesh(GEO.vest, vest));
    this.upper.add(new THREE.Mesh(GEO.pack, vest));
    this.headG = new THREE.Group();
    this.headG.position.y = 0.72;
    this.upper.add(this.headG);
    this.headG.add(new THREE.Mesh(GEO.head, skin));
    this.headG.add(new THREE.Mesh(GEO.helmet, helm));
    const visor = new THREE.Mesh(GEO.visor, dark);
    visor.position.set(0, 0.02, -0.135);
    this.headG.add(visor);
    // Arms holding the rifle out front.
    this.arms = new THREE.Group();
    this.arms.position.y = 0.5;
    this.upper.add(this.arms);
    const armR = new THREE.Mesh(GEO.arm, shirt);
    armR.position.set(0.24, 0, 0);
    armR.rotation.x = 1.2;
    const armL = new THREE.Mesh(GEO.arm, shirt);
    armL.position.set(-0.22, 0, -0.05);
    armL.rotation.set(1.35, 0, 0.5);
    this.arms.add(armR, armL);
    this.gun = new THREE.Group();
    this.gun.position.set(0.12, -0.12, -0.3);
    this.gun.add(new THREE.Mesh(GEO.gun, dark), new THREE.Mesh(GEO.mag, dark));
    this.arms.add(this.gun);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.6, 0.6, 1);
    this.flash.position.set(0, 0.02, -0.75);
    this.flash.visible = false;
    this.gun.add(this.flash);

    this.walk = 0;
    this.flashT = 0;
    this.deadT = -1;
    this.label = null;
  }

  setLabel(name, color) {
    if (this.label) {
      this.root.remove(this.label);
      this.label.material.map.dispose();
      this.label.material.dispose();
      this.label = null;
    }
    if (!name) return;
    this.label = nameSprite(name, color);
    this.label.position.y = 2.25;
    this.root.add(this.label);
  }

  muzzle() {
    this.flashT = 0.06;
  }

  muzzleWorld(out) {
    return this.flash.getWorldPosition(out);
  }

  die() {
    this.deadT = 0;
  }

  revive() {
    this.deadT = -1;
    this.root.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.root.visible = true;
  }

  // v: { x, y, z, yaw, pitch, cr, mv, gr }
  pose(v, dt) {
    const r = this.root;
    r.position.set(v.x, v.y, v.z);
    r.rotation.y = v.yaw;
    if (this.deadT >= 0) {
      // Topple over, then sink out of sight.
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.45);
      this.body.rotation.x = (t * t * Math.PI) / 2;
      this.body.position.y = this.deadT > 2 ? -(this.deadT - 2) * 0.6 : 0;
      this.root.visible = this.deadT < 3.5;
      this.flash.visible = false;
      return;
    }
    const cr = v.cr || 0;
    const speed = v.mv || 0;
    this.walk += dt * (2 + speed * 1.9) * (speed > 0.3 ? 1 : 0);
    const swing = Math.sin(this.walk) * Math.min(1, speed / 5) * 0.7;
    const air = v.gr === 0 ? 0.5 : 0;
    this.legL.rotation.x = swing + air - cr * 1.2;
    this.legR.rotation.x = -swing + air * 0.3 - cr * 0.3;
    this.hips.position.y = 0.92 - cr * 0.42 + Math.abs(Math.cos(this.walk)) * Math.min(1, speed / 5) * 0.05;
    this.upper.rotation.x = (v.pitch || 0) * 0.2 - cr * 0.2;
    this.arms.rotation.x = (v.pitch || 0) * 0.8 + cr * 0.2;
    this.headG.rotation.x = (v.pitch || 0) * 0.5;
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      this.flash.material.rotation = Math.random() * 6;
    } else this.flash.visible = false;
  }

  dispose(scene) {
    scene.remove(this.root);
    this.setLabel(null);
  }
}
