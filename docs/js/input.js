// Touch controls (floating steering stick on the left, buttons on the right)
// plus keyboard for testing on a computer. The kart accelerates automatically.

export class Input {
  constructor() {
    this.steer = 0;
    this.brake = false;
    this.drift = false;
    this.itemQueued = false;
    this.keys = new Set();
    this.stickId = null;
    this.stickOrigin = 0;
    this.touchSteer = 0;

    const zone = document.getElementById('steerZone');
    const base = document.getElementById('stickBase');
    const knob = document.getElementById('stickKnob');
    const RANGE = 55;

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.stickOrigin = e.clientX;
      base.style.left = e.clientX + 'px';
      base.style.top = e.clientY + 'px';
      base.classList.add('active');
      knob.style.transform = 'translate(-50%, -50%)';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      const dx = Math.max(-RANGE, Math.min(RANGE, e.clientX - this.stickOrigin));
      let v = dx / RANGE;
      if (Math.abs(v) < 0.08) v = 0;
      this.touchSteer = v;
      knob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
    });
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.touchSteer = 0;
      base.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const hold = (id, on, off) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('pressed');
        on();
      });
      const up = (e) => {
        el.classList.remove('pressed');
        off && off();
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    hold('btnDrift', () => (this.touchDrift = true), () => (this.touchDrift = false));
    hold('btnBrake', () => (this.touchBrake = true), () => (this.touchBrake = false));
    // ITEM: tap to use; swipe down to throw behind you, swipe up to throw ahead.
    const item = document.getElementById('btnItem');
    let press = null;
    item.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      item.setPointerCapture(e.pointerId);
      item.classList.add('pressed');
      press = { id: e.pointerId, y: e.clientY, done: false };
    });
    item.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.id || press.done) return;
      const dy = e.clientY - press.y;
      if (Math.abs(dy) > 26) {
        press.done = true;
        this.itemQueued = dy > 0 ? 'back' : 'fwd';
        item.classList.add(dy > 0 ? 'swipe-back' : 'swipe-fwd');
      }
    });
    const release = (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (!press.done && e.type === 'pointerup') this.itemQueued = 'tap';
      press = null;
      item.classList.remove('pressed', 'swipe-back', 'swipe-fwd');
    };
    item.addEventListener('pointerup', release);
    item.addEventListener('pointercancel', release);

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
      if (!e.repeat && ['shift', 'e', 'x', 'enter'].includes(k)) this.itemQueued = this.keys.has('arrowdown') || this.keys.has('s') ? 'back' : this.keys.has('arrowup') || this.keys.has('w') ? 'fwd' : 'tap';
      if (!e.repeat && ['q', 'z'].includes(k)) this.itemQueued = 'back';
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touchDrift = this.touchBrake = false;
      this.touchSteer = 0;
    });
  }

  read() {
    const k = this.keys;
    let keySteer = 0;
    if (k.has('arrowleft') || k.has('a')) keySteer -= 1;
    if (k.has('arrowright') || k.has('d')) keySteer += 1;
    const useItem = this.itemQueued; // false, 'tap', 'fwd' or 'back'
    this.itemQueued = false;
    return {
      steer: keySteer || this.touchSteer,
      throttle: true,
      brake: this.touchBrake || k.has('arrowdown') || k.has('s'),
      drift: this.touchDrift || k.has(' ') || k.has('c'),
      useItem,
    };
  }
}
