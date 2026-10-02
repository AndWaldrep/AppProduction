// Tiny synthesized sound effects so there are no audio files to download.

class Sfx {
  constructor() {
    this.ctx = null;
    try {
      this.muted = localStorage.getItem('kc-muted') === '1';
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
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('kc-muted', m ? '1' : '0');
    } catch {}
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  engine(on, speedNorm, boosting) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 55 + Math.abs(speedNorm) * 110 + (boosting ? 40 : 0);
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engineGain.gain.setTargetAtTime(on ? 0.07 : 0, t, 0.1);
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

  noise(dur, vol = 0.2, freq = 1200) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  count() { this.tone(440, 0.25, 'square', 0.18); }
  go() { this.tone(880, 0.5, 'square', 0.2); }
  pickup() { this.tone(660, 0.08, 'triangle', 0.2); this.tone(990, 0.12, 'triangle', 0.2, null, 0.08); }
  item() { this.tone(520, 0.12, 'triangle', 0.2, 1040); }
  boost() { this.noise(0.5, 0.25, 900); this.tone(300, 0.4, 'sawtooth', 0.08, 900); }
  hit() { this.tone(600, 0.5, 'square', 0.18, 120); }
  bump() { this.noise(0.12, 0.25, 300); }
  lap() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.15, 'square', 0.15, null, i * 0.1)); }
  finish() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'square', 0.15, null, i * 0.13)); }
}

export const sfx = new Sfx();
