// Your own gun and hands, drawn in their own little scene on top of the world
// so they never poke through walls.

import * as THREE from 'three';
import { glowTexture } from './soldier.js';

const m = (color) => new THREE.MeshLambertMaterial({ color });
const MAT = {
  gun: m('#2b2e33'),
  gun2: m('#454a52'),
  wood: m('#7a4b2a'),
  tan: m('#b49a6a'),
  glove: m('#2a2a2a'),
  lens: new THREE.MeshBasicMaterial({ color: '#7fd0ff' }),
  dot: new THREE.MeshBasicMaterial({ color: '#ff2a2a' }),
};

function part(g, w, h, d, x, y, z, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

// A red-dot sight: an open frame with the dot floating in the middle of it.
function sight(g, z) {
  part(g, 0.05, 0.012, 0.09, 0, -0.016, z, MAT.gun);
  part(g, 0.006, 0.035, 0.012, -0.022, 0, z - 0.04, MAT.gun);
  part(g, 0.006, 0.035, 0.012, 0.022, 0, z - 0.04, MAT.gun);
  part(g, 0.05, 0.006, 0.012, 0, 0.02, z - 0.04, MAT.gun);
  part(g, 0.006, 0.006, 0.004, 0, 0, z - 0.04, MAT.dot);
}

// Each gun is built pointing down -z, with its sight line at y = 0 so aiming lines up with the crosshair.
const BUILD = {
  ar(g) {
    part(g, 0.07, 0.09, 0.5, 0, -0.06, -0.05, MAT.gun);
    part(g, 0.04, 0.04, 0.32, 0, -0.04, -0.44, MAT.gun2);
    part(g, 0.06, 0.07, 0.22, 0, -0.07, -0.3, MAT.tan);
    part(g, 0.05, 0.16, 0.07, 0, -0.17, -0.08, MAT.gun2).rotation.x = 0.25;
    part(g, 0.05, 0.12, 0.05, 0, -0.14, 0.08, MAT.gun).rotation.x = -0.3;
    part(g, 0.06, 0.08, 0.2, 0, -0.07, 0.27, MAT.tan);
    sight(g, -0.02);
    return { muzzle: -0.62, mag: g.children[3] };
  },
  smg(g) {
    part(g, 0.07, 0.1, 0.36, 0, -0.06, 0, MAT.gun);
    part(g, 0.04, 0.04, 0.16, 0, -0.04, -0.25, MAT.gun2);
    part(g, 0.045, 0.2, 0.06, 0, -0.2, -0.06, MAT.gun2);
    part(g, 0.05, 0.12, 0.05, 0, -0.14, 0.1, MAT.gun).rotation.x = -0.3;
    part(g, 0.02, 0.02, 0.22, 0, -0.04, 0.26, MAT.gun2);
    sight(g, 0);
    return { muzzle: -0.36, mag: g.children[2] };
  },
  shotgun(g) {
    part(g, 0.07, 0.09, 0.3, 0, -0.06, 0.02, MAT.gun);
    part(g, 0.045, 0.045, 0.62, 0, -0.03, -0.42, MAT.gun2);
    part(g, 0.06, 0.05, 0.22, 0, -0.08, -0.36, MAT.wood);
    part(g, 0.06, 0.1, 0.28, 0, -0.1, 0.3, MAT.wood).rotation.x = 0.15;
    part(g, 0.02, 0.02, 0.02, 0, 0.0, -0.7, MAT.dot);
    return { muzzle: -0.74, mag: g.children[2] };
  },
  sniper(g) {
    part(g, 0.07, 0.09, 0.5, 0, -0.08, -0.02, MAT.gun);
    part(g, 0.035, 0.035, 0.5, 0, -0.06, -0.5, MAT.gun2);
    part(g, 0.06, 0.1, 0.32, 0, -0.1, 0.32, MAT.tan).rotation.x = 0.1;
    part(g, 0.05, 0.12, 0.06, 0, -0.18, -0.02, MAT.gun2);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 10), MAT.gun);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0, -0.05);
    g.add(scope);
    part(g, 0.05, 0.05, 0.005, 0, 0, 0.1, MAT.lens);
    return { muzzle: -0.76, mag: g.children[3] };
  },
};

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(1, 2, 1);
    this.scene.add(sun);
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.gun = null;
    this.id = null;
    this.bob = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.raise = 1;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.35, 0.35, 1);
    this.flashT = 0;
  }

  setWeapon(id, sleeve) {
    if (this.id === id && this.sleeve === sleeve) return;
    this.id = id;
    this.sleeve = sleeve;
    if (this.gun) this.rig.remove(this.gun);
    const g = new THREE.Group();
    const info = BUILD[id](g);
    this.muzzleZ = info.muzzle;
    this.mag = info.mag;
    this.magY = this.mag.position.y;
    // Hands and sleeves
    const sleeveMat = m(sleeve);
    const right = new THREE.Group();
    part(right, 0.075, 0.075, 0.3, 0, 0, 0.17, sleeveMat);
    part(right, 0.07, 0.07, 0.08, 0, 0, -0.01, MAT.glove);
    right.position.set(0.01, -0.13, 0.1);
    right.rotation.set(1.05, 0.25, 0);
    const left = new THREE.Group();
    part(left, 0.075, 0.075, 0.34, 0, 0, 0.19, sleeveMat);
    part(left, 0.07, 0.07, 0.08, 0, 0, -0.01, MAT.glove);
    left.position.set(-0.02, -0.11, id === 'smg' ? -0.2 : -0.3);
    left.rotation.set(0.95, -0.45, 0);
    g.add(right, left);
    this.flash.position.set(0, -0.03, this.muzzleZ - 0.05);
    g.add(this.flash);
    this.gun = g;
    this.rig.add(g);
    this.raise = 1;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    // An upright phone is narrow: widen the view a bit and hold the gun lower and closer to the middle.
    this.portrait = aspect < 1;
    this.camera.fov = this.portrait ? 74 : 58;
    this.camera.updateProjectionMatrix();
  }

  fire() {
    this.flashT = 0.05;
    this.flash.material.rotation = Math.random() * 6;
  }

  // s: { ads 0..1, kick 0..1, reload 0..1 (progress, -1 none), sprint, moving speed, dyaw, dpitch, scoped }
  update(dt, s) {
    if (!this.gun) return;
    const ads = s.ads;
    this.raise = Math.max(0, this.raise - dt * 3);
    const speed = Math.min(1, s.speed / 6);
    this.bob += dt * (4 + s.speed * 1.6) * (speed > 0.05 ? 1 : 0.3);
    const bobAmt = (s.sprint ? 0.035 : 0.014 * speed + 0.002) * (1 - ads * 0.85);
    this.swayX += (-s.dyaw * 0.6 - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (s.dpitch * 0.6 - this.swayY) * Math.min(1, dt * 8);
    const hip = this.portrait ? { x: 0.09, y: -0.21, z: -0.62 } : { x: 0.17, y: -0.16, z: -0.6 };
    const aim = { x: 0, y: 0, z: -0.55 };
    let x = hip.x + (aim.x - hip.x) * ads;
    let y = hip.y + (aim.y - hip.y) * ads;
    let z = hip.z + (aim.z - hip.z) * ads;
    x += Math.cos(this.bob * 0.5) * bobAmt + this.swayX * 0.04 * (1 - ads * 0.7);
    y += -Math.abs(Math.sin(this.bob * 0.5)) * bobAmt + this.swayY * 0.04 * (1 - ads * 0.7);
    z += s.kick * 0.07 * (1 - ads * 0.4);
    let rx = s.kick * 0.12;
    let ry = 0;
    let rz = 0;
    if (s.sprint) {
      x += 0.04;
      y -= 0.05;
      ry = 0.7;
      rz = 0.25;
      rx -= 0.25;
    }
    let reloadDip = 0;
    if (s.reload >= 0) {
      // Tip the gun down, swap the magazine, bring it back up.
      const p = s.reload;
      reloadDip = Math.sin(Math.min(1, p) * Math.PI);
      rx -= reloadDip * 0.6;
      rz += reloadDip * 0.5;
      y -= reloadDip * 0.08;
      if (this.mag) this.mag.position.y = this.magY - (p > 0.2 && p < 0.6 ? 0.3 : 0);
    } else if (this.mag) this.mag.position.y = this.magY;
    y -= this.raise * this.raise * 0.35;
    rx -= this.raise * 0.6;
    this.gun.position.set(x, y, z);
    this.gun.rotation.set(rx, ry, rz);
    this.gun.visible = !s.scoped;
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
    } else this.flash.visible = false;
  }
}
