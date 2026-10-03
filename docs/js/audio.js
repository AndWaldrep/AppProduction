// Sound effects and music, all synthesized with Web Audio, so there are no
// audio files to download. The music is a small step sequencer: drums, bass,
// chord arpeggios and a lead melody, written as scale degrees below.

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};

// Melodies: 16 steps per bar. Numbers are scale degrees (1 = root, 8 = an
// octave up, 0 = the note below the root), '-' holds the note, '.' is a rest.
export const SONGS = {
  menu: {
    bpm: 112, root: 65, scale: 'major', lead: 'soft',
    chords: [1, 6, 4, 5],
    melody: [
      '3 . . 5 . . 8 . 7 . 5 . 3 . . .',
      '1 . . 3 . . 6 . 5 . 3 . 1 . . .',
      '4 . . 6 . . 8 . 9 . 8 . 6 . . .',
      '5 . . 7 . . 9 . 7 . 5 . 2 . . .',
      '3 . 5 . 8 . 10 - - . 9 . 8 . 7 .',
      '6 . 8 . 6 . 5 - - . 3 . 1 . 3 .',
      '4 . 6 . 8 . 11 - - . 10 . 9 . 8 .',
      '7 - - . 5 . 7 . 9 - - - . . . .',
    ],
    bass: 'r..r..f.r..r..o.',
    drums: { k: 'x.....x...x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  },
  sunny: {
    bpm: 150, root: 60, scale: 'major', lead: 'square',
    chords: [1, 5, 6, 4, 1, 5, 4, 5],
    melody: [
      '5 . 5 . 6 . 5 . 3 . 1 . 3 - 5 .',
      '5 . 4 . 3 . 2 . 5 - - . 2 . 0 .',
      '6 . 6 . 8 . 6 . 5 . 3 . 6 - - .',
      '4 . 4 . 6 . 4 . 3 . 2 . 1 - - .',
      '8 . 7 . 8 . 5 . 6 . 5 . 3 . 5 .',
      '9 . 8 . 7 . 5 . 7 - 9 - 8 . 7 .',
      '6 . 8 . 6 . 4 . 6 . 5 . 4 . 3 .',
      '2 . 3 . 4 . 5 . 7 . 8 . 9 - - .',
    ],
    bass: 'r.r.f.r.r.r.f.o.',
    drums: { k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.xo' },
  },
  desert: {
    bpm: 136, root: 57, scale: 'harmonic', lead: 'saw',
    chords: [1, 6, 4, 5, 1, 6, 5, 5],
    melody: [
      '1 . 2 3 . 5 . 3 2 . 1 . 0 . 1 .',
      '3 . 4 6 . 8 . 6 5 . 4 . 3 - - .',
      '4 . 6 8 . 6 . 4 3 . 2 . 1 - 2 .',
      '0 . 2 5 . 4 . 3 2 . 0 . -2 - - .',
      '8 . 7 8 . 5 . 6 5 . 3 . 4 . 5 .',
      '6 . 5 6 . 8 . 10 8 . 6 . 5 - - .',
      '5 . 4 5 . 7 . 5 4 . 3 . 2 . 0 .',
      '0 - 2 - 4 - 7 - 8 - - - . . . .',
    ],
    bass: 'r..r..f.r..r.f.o',
    drums: { k: 'x..x..x.x..x..x.', s: '....x.......x...', h: '..x...x...x...xx' },
  },
  frosty: {
    bpm: 144, root: 52, scale: 'minor', lead: 'bell',
    chords: [1, 6, 3, 7, 1, 6, 4, 5],
    melody: [
      '8 . 7 8 . 5 . . 3 . 5 . 8 . 7 .',
      '6 . 5 6 . 3 . . 1 . 3 . 6 . 5 .',
      '5 . 4 5 . 3 . . 5 . 7 . 10 - - .',
      '9 . 7 . 5 . 4 . 2 - - . 4 . 5 .',
      '8 . 10 . 12 . 10 . 8 . 7 . 8 . 10 .',
      '11 . 10 . 8 . 6 . 8 - - . 6 . 5 .',
      '4 . 6 . 8 . 6 . 11 . 10 . 8 . 6 .',
      '7 . 5 . 2 . 5 . 7 - - - . . . .',
    ],
    bass: 'r.rr.r.fr.rr.f.o',
    drums: { k: 'x...x...x...x...', s: '....x.......x..x', h: 'xxx.xxx.xxx.xxx.' },
  },
  star: {
    bpm: 184, root: 60, scale: 'major', lead: 'square',
    chords: [1, 4, 1, 5],
    melody: [
      '8 . 8 . 8 . 6 8 . 10 . 8 . . 5 .',
      '8 . 8 . 8 . 6 8 . 10 . 12 - 10 . 8',
      '8 . 8 . 8 . 6 8 . 10 . 8 . . 5 .',
      '9 . 9 . 9 . 7 9 . 11 . 9 . 7 . 5',
    ],
    bass: 'r.o.r.o.r.o.r.o.',
    drums: { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
  },
};

for (const song of Object.values(SONGS)) {
  song.bars = song.melody.map((bar) => bar.trim().split(/\s+/));
}

function degree(scale, d) {
  const i = d - 1;
  const o = Math.floor(i / 7);
  const k = ((i % 7) + 7) % 7;
  return scale[k] + 12 * o;
}

const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = this.load('kc-sfx', true);
    this.musicOn = this.load('kc-music', true);
    this.songId = null;
    this.tempo = 1;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.visibilityState === 'hidden') this.ctx.suspend();
        else this.ctx.resume();
      });
    }
  }

  load(key, dflt) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? dflt : v === '1';
    } catch {
      return dflt;
    }
  }

  save(key, v) {
    try {
      localStorage.setItem(key, v ? '1' : '0');
    } catch {}
  }

  // Must be called from a tap (phones only allow audio after a user gesture).
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // Play even when the iPhone's silent switch is on (there are mute buttons in game).
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {}
    const ctx = (this.ctx = new AC());

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxOn ? 1 : 0;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
    this.musicBus.connect(this.master);

    // Small room reverb for a bit of space.
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this.leadBus = ctx.createBiquadFilter();
    this.leadBus.type = 'lowpass';
    this.leadBus.frequency.value = 3800;
    this.leadBus.connect(this.musicBus);
    this.leadBus.connect(this.reverb);

    this.buildEngine();
    this.pumpTimer = setInterval(() => this.pump(), 25);
    if (this.pendingSong) this.music(this.pendingSong);
  }

  setSfx(on) {
    this.sfxOn = on;
    this.save('kc-sfx', on);
    if (this.sfxBus) this.sfxBus.gain.value = on ? 1 : 0;
  }

  setMusic(on) {
    this.musicOn = on;
    this.save('kc-music', on);
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------ engine & loops

  noiseLoop(filterType, f, q = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = f;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start();
    return { filter, gain };
  }

  buildEngine() {
    const ctx = this.ctx;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 500;
    this.engFilter.Q.value = 3;
    this.engOsc = [ctx.createOscillator(), ctx.createOscillator(), ctx.createOscillator()];
    this.engOsc[0].type = 'sawtooth';
    this.engOsc[1].type = 'sawtooth';
    this.engOsc[2].type = 'square';
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    for (const o of this.engOsc) {
      o.connect(mix);
      o.start();
    }
    // Putt-putt: wobble the volume like a small engine's cylinder firing.
    this.engLfo = ctx.createOscillator();
    this.engLfo.frequency.value = 20;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.35;
    const trem = ctx.createGain();
    trem.gain.value = 0.65;
    this.engLfo.connect(lfoDepth);
    lfoDepth.connect(trem.gain);
    this.engLfo.start();
    mix.connect(trem);
    trem.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.sfxBus);

    this.screech = this.noiseLoop('bandpass', 2400, 8);
    this.wind = this.noiseLoop('lowpass', 900);
    this.rumble = this.noiseLoop('lowpass', 160);
  }

  // Called every frame during a race with the player's kart state.
  kart({ on, speed = 0, boost = false, drift = 0, drifting = false, offroad = false, air = false }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1.4, Math.abs(speed));
    const f = 48 + s * 110 + (boost ? 35 : 0) + (air ? 25 : 0);
    this.engOsc[0].frequency.setTargetAtTime(f, t, 0.06);
    this.engOsc[1].frequency.setTargetAtTime(f * 1.012, t, 0.06);
    this.engOsc[2].frequency.setTargetAtTime(f * 0.5, t, 0.06);
    this.engLfo.frequency.setTargetAtTime(14 + s * 34, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(350 + s * 1700 + (boost ? 600 : 0), t, 0.08);
    this.engGain.gain.setTargetAtTime(on ? 0.11 : 0, t, 0.1);
    const sq = on && drifting && !air;
    this.screech.filter.frequency.setTargetAtTime([2000, 2600, 3300][drift] || 2000, t, 0.05);
    this.screech.gain.gain.setTargetAtTime(sq ? 0.05 + drift * 0.02 : 0, t, 0.05);
    this.wind.gain.gain.setTargetAtTime(on ? (air ? 0.12 : 0) + (boost ? 0.1 : 0) + s * 0.025 : 0, t, 0.1);
    this.wind.filter.frequency.setTargetAtTime(500 + s * 1200, t, 0.1);
    this.rumble.gain.gain.setTargetAtTime(on && offroad && !air ? 0.25 * s : 0, t, 0.05);
  }

  // ------------------------------------------------------------ building blocks

  tone(f, dur, { type = 'square', vol = 0.2, slide = null, delay = 0, attack = 0.005, verb = false } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfxBus);
    if (verb) g.connect(this.reverb);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, { vol = 0.2, type = 'bandpass', f = 1200, slide = null, q = 1, delay = 0, bus = null } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f, t);
    if (slide) filter.frequency.exponentialRampToValueAtTime(slide, t + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(bus || this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  notes(list, { type = 'square', vol = 0.15, gap = 0.1, dur = 0.14, verb = true } = {}) {
    list.forEach((f, i) => f && this.tone(f, dur, { type, vol, delay: i * gap, verb }));
  }

  // ------------------------------------------------------------ sound effects

  count() {
    this.tone(440, 0.22, { vol: 0.2 });
    this.tone(880, 0.22, { type: 'triangle', vol: 0.1 });
  }
  go() {
    this.tone(880, 0.7, { vol: 0.22, verb: true });
    this.tone(1320, 0.7, { type: 'triangle', vol: 0.12 });
  }
  pickup() {
    this.notes([1046, 1318, 1568, 2093], { type: 'triangle', vol: 0.18, gap: 0.045, dur: 0.12 });
  }
  roulette() {
    this.tone(1400 + Math.random() * 400, 0.03, { vol: 0.05 });
  }
  itemReady() {
    this.tone(1568, 0.3, { type: 'sine', vol: 0.2, verb: true });
    this.tone(2093, 0.4, { type: 'sine', vol: 0.15, delay: 0.06, verb: true });
  }
  useItem(kind) {
    if (kind === 'mushroom' || kind === 'mushroom3') {
      this.noise(0.6, { vol: 0.35, f: 400, slide: 3000, q: 2 });
      this.tone(220, 0.45, { type: 'sawtooth', vol: 0.1, slide: 880 });
    } else if (kind === 'banana') {
      this.tone(420, 0.12, { type: 'sine', vol: 0.3, slide: 900 });
      this.tone(900, 0.18, { type: 'sine', vol: 0.25, slide: 380, delay: 0.12 });
    } else if (kind === 'shell') {
      this.tone(1100, 0.2, { vol: 0.16, slide: 180 });
      this.noise(0.12, { vol: 0.25, f: 3000 });
    } else if (kind === 'star') {
      this.notes([523, 659, 784, 1046, 1318, 1568, 2093], { vol: 0.12, gap: 0.05, dur: 0.12 });
    }
  }
  boost() {
    this.noise(0.5, { vol: 0.3, f: 500, slide: 2500, q: 1.5 });
  }
  miniturbo(tier = 1) {
    this.tone(tier === 2 ? 520 : 400, 0.25, { type: 'sawtooth', vol: 0.12, slide: tier === 2 ? 1400 : 1000 });
    this.noise(0.35, { vol: 0.3, f: 800, slide: 3000 });
  }
  hit() {
    this.tone(900, 0.7, { vol: 0.16, slide: 120 });
    this.tone(1200, 0.7, { type: 'triangle', vol: 0.1, slide: 200, delay: 0.05 });
    this.noise(0.25, { vol: 0.35, f: 600 });
  }
  bump() {
    this.tone(130, 0.18, { type: 'sine', vol: 0.45, slide: 45 });
    this.noise(0.12, { vol: 0.3, type: 'lowpass', f: 500 });
  }
  jump() {
    this.noise(0.4, { vol: 0.3, f: 500, slide: 2600, q: 1.5 });
    this.tone(300, 0.3, { type: 'triangle', vol: 0.15, slide: 750 });
  }
  land() {
    this.tone(110, 0.22, { type: 'sine', vol: 0.55, slide: 40 });
    this.noise(0.18, { vol: 0.35, type: 'lowpass', f: 700 });
  }
  trick() {
    this.notes([1318, 1760], { vol: 0.14, gap: 0.07, dur: 0.12 });
    this.noise(0.3, { vol: 0.2, f: 1500, slide: 4000 });
  }
  fall() {
    this.tone(1500, 1.1, { type: 'sine', vol: 0.25, slide: 180 });
  }
  respawn() {
    this.notes([784, 988, 1175, 1568], { type: 'triangle', vol: 0.18, gap: 0.08, dur: 0.18 });
  }
  roller() {
    this.tone(90, 0.35, { type: 'sine', vol: 0.5, slide: 35 });
    this.noise(0.3, { vol: 0.4, type: 'lowpass', f: 400 });
  }
  lap() {
    this.notes([523, 659, 784, 1046], { type: 'triangle', vol: 0.2, gap: 0.09, dur: 0.16 });
  }
  finalLap() {
    this.notes([784, 0, 784, 784, 0, 1046, 0, 1318], { vol: 0.16, gap: 0.09, dur: 0.12 });
  }
  finish() {
    this.notes([523, 659, 784, 1046, 0, 784, 1046, 1318], { vol: 0.17, gap: 0.12, dur: 0.2 });
    this.tone(1046, 1.4, { vol: 0.12, delay: 1.0, verb: true });
    this.tone(1318, 1.4, { vol: 0.1, delay: 1.0, verb: true });
    this.tone(1568, 1.4, { vol: 0.1, delay: 1.0, verb: true });
  }
  click() {
    this.tone(1200, 0.04, { type: 'triangle', vol: 0.12 });
  }

  // ------------------------------------------------------------ music

  music(id, tempo = 1) {
    this.tempo = tempo;
    if (!this.ctx) {
      this.pendingSong = id;
      return;
    }
    if (this.songId === id) return;
    this.songId = id;
    this.song = SONGS[id] || null;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
  }

  stopMusic() {
    this.songId = null;
    this.song = null;
    this.pendingSong = null;
  }

  setTempo(x) {
    this.tempo = x;
  }

  pump() {
    const ctx = this.ctx;
    if (!ctx || !this.song) return;
    if (this.nextTime < ctx.currentTime - 0.3) this.nextTime = ctx.currentTime + 0.05; // after a pause
    const stepDur = 60 / (this.song.bpm * this.tempo) / 4;
    while (this.nextTime < ctx.currentTime + 0.15) {
      if (this.musicOn) this.playStep(this.song, this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  playStep(song, step, t, stepDur) {
    const scale = SCALES[song.scale];
    const barIdx = Math.floor(step / 16) % song.bars.length;
    const s = step % 16;
    const bar = song.bars[barIdx];
    const chord = song.chords[barIdx % song.chords.length];
    const lastBar = barIdx === song.bars.length - 1;

    // Lead melody
    const tok = bar[s];
    if (tok !== '.' && tok !== '-') {
      let len = 1;
      for (let k = s + 1; k < 16 && bar[k] === '-'; k++) len++;
      this.voice(song.lead, freq(song.root + 12 + degree(scale, Number(tok))), t, len * stepDur);
    }
    // Bass
    const b = song.bass[s];
    if (b !== '.') {
      const off = { r: 0, f: 4, o: 7, 3: 2 }[b] ?? 0;
      this.voice('bass', freq(song.root - 12 + degree(scale, chord + off)), t, stepDur * 1.6);
    }
    // Chord arpeggio on eighth notes
    if (s % 2 === 0) {
      const tones = [0, 2, 4, 7];
      this.voice('arp', freq(song.root + degree(scale, chord + tones[(s / 2) % 4])), t, stepDur * 1.5);
    }
    // Drums (with a fill on the last bar of the loop)
    const d = song.drums;
    if (d.k[s] === 'x') this.kick(t);
    if (d.s[s] === 'x' || (lastBar && s >= 12)) this.snare(t, lastBar && s >= 12 ? 0.6 : 1);
    if (d.h[s] === 'x') this.hat(t, 0.04);
    if (d.h[s] === 'o') this.hat(t, 0.18);
  }

  voice(kind, f, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const out = kind === 'bass' || kind === 'arp' ? this.musicBus : this.leadBus;
    g.connect(out);
    const osc = (type, fr, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = fr;
      o.detune.value = detune;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.25);
      return o;
    };
    let vol;
    let release = 0.06;
    if (kind === 'bass') {
      osc('triangle', f);
      osc('sawtooth', f, 4);
      vol = 0.32;
    } else if (kind === 'arp') {
      osc('triangle', f);
      vol = 0.07;
    } else if (kind === 'bell') {
      osc('sine', f);
      osc('triangle', f * 2, 3);
      vol = 0.22;
      release = 0.35;
    } else if (kind === 'saw') {
      osc('sawtooth', f, -6);
      osc('sawtooth', f, 6);
      vol = 0.1;
    } else if (kind === 'soft') {
      osc('triangle', f);
      osc('sine', f * 2);
      vol = 0.2;
      release = 0.2;
    } else {
      osc('square', f);
      osc('square', f, 8);
      vol = 0.08;
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(vol * 0.6, t + Math.min(dur, 0.12));
    g.gain.setValueAtTime(vol * 0.6, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  }

  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g);
    g.connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.3);
  }

  snare(t, vol = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.45 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverb);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.2);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 190;
    og.gain.setValueAtTime(0.25 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og);
    og.connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.1);
  }

  hat(t, len) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.02);
  }
}

export const sfx = new Sound();
