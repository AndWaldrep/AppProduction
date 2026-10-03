// Twin-stick touch controls: the left thumb moves, the right thumb aims.
// Both sticks float: they appear wherever your thumb lands on that side.
// The aim stick turns faster the further you push it, and also follows small
// thumb movements directly for fine aim. Dragging on a FIRE button aims too.
// Keyboard + mouse work as well, for playing or testing on a computer.

const MOVE_R = 58;
const LOOK_R = 60;

export class Input {
  constructor() {
    this.keys = new Set();
    this.move = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.look = { id: null, ox: 0, oy: 0, x: 0, y: 0, lx: 0, ly: 0 };
    this.swipeX = 0; // pixels of aim drag since the last read
    this.swipeY = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.fireIds = new Map(); // pointerId -> last position, for each finger on a fire button
    this.mouseFire = false;
    this.mouseAds = false;
    this.ads = false;
    this.crouch = false;
    this.queued = { jump: false, reload: false, nade: false };
    this.usedTouch = false;
    this.enabled = false;

    const $ = (id) => document.getElementById(id);
    this.moveBase = $('moveBase');
    this.moveKnob = $('moveKnob');
    this.lookBase = $('lookBase');
    this.lookKnob = $('lookKnob');
    this.sprintTag = $('sprintTag');

    const zone = (el, stick, base, knob, R, follow) => {
      el.addEventListener('pointerdown', (e) => {
        if (stick.id !== null || !this.enabled) return;
        e.preventDefault();
        this.usedTouch = this.usedTouch || e.pointerType === 'touch';
        stick.id = e.pointerId;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {}
        stick.ox = stick.lx = e.clientX;
        stick.oy = stick.ly = e.clientY;
        stick.x = stick.y = 0;
        base.style.left = e.clientX + 'px';
        base.style.top = e.clientY + 'px';
        base.classList.add('active');
        knob.style.transform = 'translate(-50%, -50%)';
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId !== stick.id) return;
        e.preventDefault();
        if (stick === this.look) {
          this.swipeX += e.clientX - stick.lx;
          this.swipeY += e.clientY - stick.ly;
        }
        stick.lx = e.clientX;
        stick.ly = e.clientY;
        let dx = e.clientX - stick.ox;
        let dy = e.clientY - stick.oy;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          if (follow) {
            // Drag the stick along with the thumb so it never runs out of room.
            stick.ox = e.clientX - (dx / d) * R;
            stick.oy = e.clientY - (dy / d) * R;
            base.style.left = stick.ox + 'px';
            base.style.top = stick.oy + 'px';
          }
          dx = (dx / d) * R;
          dy = (dy / d) * R;
        }
        stick.x = dx / R;
        stick.y = dy / R;
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      });
      const end = (e) => {
        if (e.pointerId !== stick.id) return;
        stick.id = null;
        stick.x = stick.y = 0;
        base.classList.remove('active');
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
    };
    zone($('moveZone'), this.move, this.moveBase, this.moveKnob, MOVE_R, true);
    zone($('lookZone'), this.look, this.lookBase, this.lookKnob, LOOK_R, true);

    // Fire buttons: hold to shoot, and drag to aim at the same time.
    for (const id of ['btnFire', 'btnFireL']) {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.enabled) return;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {}
        this.fireIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
        el.classList.add('pressed');
      });
      el.addEventListener('pointermove', (e) => {
        const p = this.fireIds.get(e.pointerId);
        if (!p) return;
        e.preventDefault();
        this.swipeX += e.clientX - p.x;
        this.swipeY += e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
      });
      const up = (e) => {
        if (!this.fireIds.delete(e.pointerId)) return;
        el.classList.remove('pressed');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }

    const tap = (id, fn) => {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.enabled) return;
        el.classList.add('pressed');
        fn();
      });
      const up = () => el.classList.remove('pressed');
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    };
    tap('btnAds', () => (this.ads = !this.ads));
    tap('btnJump', () => {
      this.queued.jump = true;
      this.crouch = false;
    });
    tap('btnCrouch', () => (this.crouch = !this.crouch));
    tap('btnReload', () => (this.queued.reload = true));
    tap('btnNade', () => (this.queued.nade = true));

    // Keyboard and mouse
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if ([' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (!e.repeat) {
        if (k === ' ') this.queued.jump = true;
        if (k === 'r') this.queued.reload = true;
        if (k === 'g' || k === 'q') this.queued.nade = true;
        if (k === 'c' || k === 'control') this.crouch = !this.crouch;
      }
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    const canvas = $('game');
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.mouseAds = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.mouseAds = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.mouseX += e.movementX;
      this.mouseY += e.movementY;
    });
    window.addEventListener('blur', () => this.release());
  }

  release() {
    this.keys.clear();
    this.mouseFire = this.mouseAds = false;
    this.fireIds.clear();
    for (const s of [this.move, this.look]) {
      s.id = null;
      s.x = s.y = 0;
    }
    this.moveBase?.classList.remove('active');
    this.lookBase?.classList.remove('active');
    document.querySelectorAll('.ctl.pressed').forEach((b) => b.classList.remove('pressed'));
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.release();
      this.ads = false;
      this.crouch = false;
      if (document.pointerLockElement) document.exitPointerLock?.();
    }
  }

  // Returns movement/buttons, plus how far to turn (radians) this frame.
  // sens: sensitivity multiplier; zoom: 1 at hip, smaller when aiming down sights.
  read(dt, sens = 1, zoom = 1) {
    const k = this.keys;
    let mx = this.move.x;
    let mz = this.move.y;
    const kx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const kz = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (kx || kz) {
      mx = kx;
      mz = kz;
    }
    const mlen = Math.hypot(mx, mz);
    if (mlen < 0.12) mx = mz = 0;
    // Push the left stick all the way forward to sprint.
    const sprint = k.has('shift') || (this.move.id !== null && mz < -0.86 && Math.abs(mx) < 0.5);
    if (this.sprintTag) this.sprintTag.classList.toggle('on', sprint && this.move.id !== null);

    // Aim stick: rate grows with how far it's pushed (squared for fine control near the middle).
    const lx = this.look.x;
    const ly = this.look.y;
    const ll = Math.hypot(lx, ly);
    let rateX = 0;
    let rateY = 0;
    if (ll > 0.08) {
      const curve = Math.pow((ll - 0.08) / 0.92, 1.8);
      rateX = (lx / ll) * curve * 3.0;
      rateY = (ly / ll) * curve * 2.0;
    }
    const swipe = 0.0042;
    let turnX = (rateX * dt + this.swipeX * swipe) * sens * zoom;
    let turnY = (rateY * dt + this.swipeY * swipe) * sens * zoom;
    turnX += this.mouseX * 0.0024 * sens * zoom;
    turnY += this.mouseY * 0.0024 * sens * zoom;
    this.swipeX = this.swipeY = this.mouseX = this.mouseY = 0;
    // Arrow-free keyboard aim for testing without a mouse: J/L/I/K.
    turnX += ((k.has('l') ? 1 : 0) - (k.has('j') ? 1 : 0)) * 2.2 * dt * zoom;
    turnY += ((k.has('k') ? 1 : 0) - (k.has('i') ? 1 : 0)) * 1.6 * dt * zoom;

    const q = this.queued;
    const out = {
      mx,
      mz,
      sprint,
      jump: q.jump,
      crouch: this.crouch,
      ads: this.ads || this.mouseAds,
      fire: this.fireIds.size > 0 || this.mouseFire,
      reload: q.reload,
      nade: q.nade,
      turnX,
      turnY,
      aiming: ll > 0.08 || this.fireIds.size > 0,
    };
    q.jump = q.reload = q.nade = false;
    return out;
  }
}
