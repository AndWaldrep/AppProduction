// Synthesized sound effects, so there are no audio files to download.
// Sounds from far away are quieter and duller.

const GUNS = {
  ar: { f: 1400, dur: 0.16, vol: 0.5, thump: 90 },
  smg: { f: 1900, dur: 0.11, vol: 0.4, thump: 120 },
  shotgun: { f: 900, dur: 0.32, vol: 0.7, thump: 60 },
  sniper: { f: 1100, dur: 0.5, vol: 0.75, thump: 50 },
};

class Sfx {
  constructor() {
    this.ctx = null;
    try {
      this.muted = localStorage.getItem('po-muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  // Must be called from a tap (iOS only allows audio after a user gesture).
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('po-muted', m ? '1' : '0');
    } catch {}
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  tone(freq, dur, type = 'square', vol = 0.2, slideTo = null, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol, freq, type = 'lowpass', delay = 0, q = 0.7) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // dist in meters (0 = your own gun)
  gun(id, dist = 0) {
    const s = GUNS[id] || GUNS.ar;
    const fall = 1 / (1 + dist * 0.06);
    if (fall < 0.04) return;
    const f = s.f * (dist > 0 ? Math.max(0.25, 1 - dist / 70) : 1);
    this.noise(s.dur * (dist > 0 ? 1.3 : 1), s.vol * fall, f);
    this.tone(s.thump * 2, s.dur * 0.6, 'sine', s.vol * 0.7 * fall, s.thump);
    if (dist === 0) this.noise(0.03, 0.25, 4000, 'highpass');
  }

  footstep(vol = 0.08) {
    this.noise(0.06, vol, 500 + Math.random() * 300, 'bandpass', 0, 1.5);
  }
  jump() { this.noise(0.08, 0.1, 400, 'bandpass'); }
  land() { this.noise(0.12, 0.2, 250); }
  dry() { this.tone(1800, 0.03, 'square', 0.08); }
  reload() {
    this.noise(0.05, 0.25, 2500, 'bandpass', 0, 3);
    this.noise(0.05, 0.25, 1800, 'bandpass', 0.45, 3);
    this.tone(900, 0.04, 'square', 0.1, null, 0.5);
  }
  reloaded() { this.noise(0.06, 0.3, 2200, 'bandpass', 0, 3); this.tone(1200, 0.04, 'square', 0.08, null, 0.05); }
  hitmarker(head) {
    this.tone(head ? 1700 : 1300, 0.06, 'triangle', 0.25);
    if (head) this.tone(2600, 0.12, 'sine', 0.18, null, 0.03);
  }
  killConfirm() { this.tone(880, 0.08, 'square', 0.15); this.tone(1320, 0.14, 'square', 0.15, null, 0.07); }
  hurt() { this.noise(0.15, 0.35, 300); this.tone(140, 0.15, 'sine', 0.3, 70); }
  die() { this.tone(300, 0.6, 'sawtooth', 0.15, 60); }
  spawn() { this.tone(520, 0.1, 'triangle', 0.15); this.tone(780, 0.16, 'triangle', 0.15, null, 0.09); }
  count() { this.tone(660, 0.18, 'square', 0.15); }
  go() { this.tone(990, 0.4, 'square', 0.18); }
  bounce(dist) { this.tone(1500, 0.05, 'triangle', 0.12 / (1 + dist * 0.1)); }
  pin() { this.tone(2400, 0.04, 'square', 0.08); this.noise(0.08, 0.15, 1500, 'bandpass', 0.06); }
  boom(dist) {
    const fall = 1 / (1 + dist * 0.04);
    this.noise(1.1, 0.9 * fall, 420 * Math.max(0.35, 1 - dist / 80));
    this.tone(70, 0.7, 'sine', 0.8 * fall, 30);
  }
  streak() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.12, 'square', 0.12, null, i * 0.09)); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'square', 0.15, null, i * 0.14)); }
  lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'square', 0.13, null, i * 0.2)); }
  heartbeat() { this.tone(60, 0.12, 'sine', 0.35); this.tone(55, 0.12, 'sine', 0.3, null, 0.18); }
}

export const sfx = new Sfx();
