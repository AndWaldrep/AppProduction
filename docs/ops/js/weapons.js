// Weapon stats and the per-soldier weapon state (ammo, reload, recoil, spread).

export const WEAPONS = {
  ar: {
    id: 'ar',
    name: 'Ranger AR',
    icon: '🔫',
    blurb: 'All-rounder. Good at every range.',
    auto: true,
    rpm: 620,
    dmg: 28,
    dmgFar: 20,
    near: 28,
    far: 60,
    headMul: 1.5,
    pellets: 1,
    mag: 30,
    reload: 2.0,
    hip: 0.045,
    ads: 0.008,
    bloom: 0.012,
    maxBloom: 0.05,
    recoil: 0.012,
    adsFov: 0.68,
    move: 1,
    autoRange: 45,
    sound: 'ar',
  },
  smg: {
    id: 'smg',
    name: 'Viper SMG',
    icon: '⚡',
    blurb: 'Fast and mobile. Wins up close.',
    auto: true,
    rpm: 900,
    dmg: 22,
    dmgFar: 13,
    near: 12,
    far: 35,
    headMul: 1.4,
    pellets: 1,
    mag: 32,
    reload: 1.7,
    hip: 0.04,
    ads: 0.016,
    bloom: 0.01,
    maxBloom: 0.05,
    recoil: 0.01,
    adsFov: 0.78,
    move: 1.1,
    autoRange: 30,
    sound: 'smg',
  },
  shotgun: {
    id: 'shotgun',
    name: 'Breacher',
    icon: '💥',
    blurb: 'One pump up close. Useless at range.',
    auto: false,
    rpm: 75,
    dmg: 17,
    dmgFar: 3,
    near: 7,
    far: 22,
    headMul: 1.2,
    pellets: 8,
    mag: 6,
    reload: 2.6,
    hip: 0.085,
    ads: 0.06,
    bloom: 0,
    maxBloom: 0,
    recoil: 0.06,
    adsFov: 0.85,
    move: 1.05,
    autoRange: 14,
    sound: 'shotgun',
  },
  sniper: {
    id: 'sniper',
    name: 'Longbow',
    icon: '🎯',
    blurb: 'One shot, one kill. Scope in to aim.',
    auto: false,
    rpm: 48,
    dmg: 100,
    dmgFar: 100,
    near: 100,
    far: 200,
    headMul: 2,
    pellets: 1,
    mag: 5,
    reload: 2.8,
    hip: 0.11,
    ads: 0,
    bloom: 0,
    maxBloom: 0,
    recoil: 0.07,
    adsFov: 0.28,
    move: 0.92,
    autoRange: 120,
    adsOnlyAuto: true,
    sound: 'sniper',
    scope: true,
  },
};
export const WEAPON_IDS = Object.keys(WEAPONS);

export const NADE = { fuse: 2.2, radius: 6, dmg: 130, speed: 15, count: 2 };
export const MAX_HIT = 210; // most damage one message can do (sniper headshot)

export function damageAt(w, dist) {
  if (dist <= w.near) return w.dmg;
  if (dist >= w.far) return w.dmgFar;
  return w.dmg + ((w.dmgFar - w.dmg) * (dist - w.near)) / (w.far - w.near);
}

export class WeaponState {
  constructor(id) {
    this.set(id);
  }

  set(id) {
    this.w = WEAPONS[id] || WEAPONS.ar;
    this.ammo = this.w.mag;
    this.reloading = 0;
    this.cooldown = 0;
    this.bloomV = 0;
    this.adsT = 0; // 0 hip .. 1 aimed
    this.kick = 0; // visual recoil
    this.nades = NADE.count;
    this.sinceShot = 9;
  }

  get interval() {
    return 60 / this.w.rpm;
  }

  spread() {
    const w = this.w;
    return w.hip + (w.ads - w.hip) * this.adsT + this.bloomV;
  }

  update(dt, ads) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt;
    this.bloomV = Math.max(0, this.bloomV - dt * 0.12);
    this.kick = Math.max(0, this.kick - dt * 6);
    const target = ads && !this.reloading ? 1 : 0;
    this.adsT += (target - this.adsT) * Math.min(1, dt * 11);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo = this.w.mag;
        return 'reloaded';
      }
    }
    return null;
  }

  canFire() {
    return this.cooldown <= 0 && this.reloading <= 0 && this.ammo > 0;
  }

  // Call when the trigger is pulled. Returns true if a shot goes out.
  fire() {
    if (!this.canFire()) return false;
    this.ammo--;
    this.cooldown = this.interval;
    this.bloomV = Math.min(this.w.maxBloom, this.bloomV + this.w.bloom);
    this.kick = 1;
    this.sinceShot = 0;
    return true;
  }

  startReload() {
    if (this.reloading > 0 || this.ammo >= this.w.mag) return false;
    this.reloading = this.w.reload;
    return true;
  }
}
