import * as THREE from 'three';
import { Track, ROLLER_RADIUS } from './track.js';
import { TRACKS } from './tracks.js';
import { KartSim, BotDriver, buildKartMesh, poseKartMesh, MAX_SPEED } from './kart.js';
import { ItemBoxes, Hazards, rollItem, ITEM_ICONS, ITEM_TIPS, ROULETTE, BLAST_RADIUS } from './items.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { sfx } from './audio.js';

const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292'];
const SEND_INTERVAL = 1000 / 15;
const INTERP_DELAY = 120;
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ renderer

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 1, 0.5, 2000);
const hemi = new THREE.HemisphereLight('#ffffff', '#6b8e4e', 1.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 1.8);
sun.position.set(120, 220, 60);
scene.add(sun);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ app state

const net = new Net();
const input = new Input();
const app = {
  myId: null,
  room: null,
  track: null,
  trackGroup: null,
  race: null,
  profile: loadProfile(),
};

function loadProfile() {
  let p = {};
  try {
    p = JSON.parse(localStorage.getItem('kc-profile') || '{}');
  } catch {}
  return { name: p.name || '', color: COLORS.includes(p.color) ? p.color : COLORS[Math.floor(Math.random() * COLORS.length)] };
}

function saveProfile() {
  app.profile.name = $('nameInput').value.trim().slice(0, 12) || 'Racer';
  try {
    localStorage.setItem('kc-profile', JSON.stringify(app.profile));
  } catch {}
}

function loadTrack(id) {
  if (app.track && app.track.id === id) return;
  if (app.trackGroup) scene.remove(app.trackGroup);
  app.track = new Track(id);
  app.trackGroup = app.track.build();
  scene.add(app.trackGroup);
  const th = app.track.theme;
  scene.fog = new THREE.Fog(th.fog, 160, 750);
  hemi.groundColor.set(th.ground);
  buildMinimap();
}

// ------------------------------------------------------------------ screens & UI

const SCREENS = ['home', 'lobby', 'waiting', 'results'];
function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  $('hud').hidden = name !== 'race' && name !== 'results';
  $('controls').hidden = name !== 'race';
  document.body.classList.toggle('racing', name === 'race' || name === 'results');
}

let toastTimer;
function toast(text, ms = 2500) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

let bannerTimer;
function banner(text, ms = 1500, cls = '') {
  const el = $('banner');
  el.textContent = text;
  el.className = 'show ' + cls;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => (el.className = ''), ms);
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function fmtTime(t) {
  if (t == null) return 'DNF';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Home screen
const params = new URLSearchParams(location.search);
const AUTOPILOT = params.has('autopilot'); // test hook: the CPU drives your kart
const inviteCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
$('nameInput').value = app.profile.name;
const picker = $('colorPicker');
for (const c of COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = c;
  b.setAttribute('aria-label', 'Kart color');
  b.onclick = () => {
    app.profile.color = c;
    renderPicker();
    if (app.room) net.send({ t: 'profile', color: c });
  };
  picker.appendChild(b);
}
function renderPicker() {
  [...picker.children].forEach((b, i) => b.classList.toggle('selected', COLORS[i] === app.profile.color));
}
renderPicker();

if (inviteCode) {
  $('inviteNote').hidden = false;
  $('inviteCode').textContent = inviteCode;
  $('joinInviteBtn').hidden = false;
  $('createBtn').classList.remove('primary');
  $('createBtn').textContent = 'Create my own race';
  $('joinRow').hidden = true;
}

function connecting() {
  for (const id of ['createBtn', 'joinBtn', 'joinInviteBtn']) $(id).disabled = true;
  setTimeout(() => {
    for (const id of ['createBtn', 'joinBtn', 'joinInviteBtn']) $(id).disabled = false;
  }, 4000);
}

$('createBtn').onclick = () => {
  sfx.unlock();
  requestWakeLock();
  saveProfile();
  connecting();
  net.connect({ t: 'create', name: app.profile.name, color: app.profile.color });
};
function joinCode(code) {
  sfx.unlock();
  requestWakeLock();
  saveProfile();
  if (!/^[A-Z]{4}$/.test(code)) {
    toast('Enter the 4-letter room code');
    return;
  }
  connecting();
  net.connect({ t: 'join', code, name: app.profile.name, color: app.profile.color });
}
$('joinInviteBtn').onclick = () => joinCode(inviteCode);
$('joinBtn').onclick = () => joinCode($('codeInput').value.toUpperCase().trim());
$('codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('joinBtn').click());

// Lobby
// Link to this page, optionally for a room. Works wherever the game is hosted (e.g. /AppProduction/).
function pageUrl(code) {
  const q = new URLSearchParams();
  if (code) q.set('room', code);
  for (const keep of ['peerserver', 'autopilot']) if (params.has(keep)) q.set(keep, params.get(keep));
  const search = q.toString().replace(/=(&|$)/g, '$1');
  return location.origin + location.pathname + (search ? '?' + search : '');
}
function inviteUrl() {
  return pageUrl(app.room.code);
}
function inviteText() {
  return `🏁 Race me in Kart Clash! Tap to join my room (${app.room.code}):`;
}
$('inviteBtn').onclick = async () => {
  sfx.unlock();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Kart Clash', text: inviteText(), url: inviteUrl() });
    } catch {}
  } else {
    location.href = $('smsLink').href;
  }
};
$('copyBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText(inviteUrl());
    toast('Link copied! Paste it in a text.');
  } catch {
    prompt('Copy this link:', inviteUrl());
  }
};
$('leaveBtn').onclick = leaveRoom;
$('waitingLeave').onclick = leaveRoom;
$('resultsLeave').onclick = leaveRoom;
$('startBtn').onclick = () => {
  sfx.unlock();
  net.send({ t: 'startRace' });
};
$('againBtn').onclick = () => net.send({ t: 'toLobby' });

document.querySelectorAll('[data-setting]').forEach((btn) => {
  btn.onclick = () => {
    const s = app.room.settings;
    const key = btn.dataset.setting;
    const d = Number(btn.dataset.delta);
    if (key === 'track') net.send({ t: 'settings', track: btn.dataset.value });
    else net.send({ t: 'settings', [key]: s[key] + d });
  };
});

function renderLobby() {
  const room = app.room;
  const isHost = room.hostId === app.myId;
  $('roomCode').textContent = room.code;
  $('smsLink').href = `sms:?&body=${encodeURIComponent(inviteText() + ' ' + inviteUrl())}`;
  $('playerList').innerHTML = room.players
    .map(
      (p) => `<li>
        <span class="dot" style="background:${p.color}"></span>
        <span class="pname">${escapeHtml(p.name)}${p.id === app.myId ? ' <em>(you)</em>' : ''}</span>
        ${p.id === room.hostId ? '<span class="badge">👑 host</span>' : ''}
        ${p.connected ? '' : '<span class="badge off">reconnecting…</span>'}
      </li>`
    )
    .join('');
  const s = room.settings;
  $('hostSettings').hidden = !isHost;
  $('guestSettings').hidden = isHost;
  $('lapsVal').textContent = s.laps;
  $('botsVal').textContent = s.bots;
  document.querySelectorAll('[data-setting="track"]').forEach((b) => b.classList.toggle('selected', b.dataset.value === s.track));
  $('guestSettings').textContent = `${TRACKS[s.track].name} · ${s.laps} lap${s.laps > 1 ? 's' : ''} · ${s.bots} CPU racer${s.bots === 1 ? '' : 's'}`;
  $('startBtn').hidden = !isHost;
  $('waitHost').hidden = isHost;
  $('soloHint').hidden = !(isHost && room.players.length === 1);
  loadTrack(s.track);
}

function leaveRoom() {
  net.leave();
  $('netInfo').hidden = true;
  releaseWakeLock();
  endRaceLocal();
  app.room = null;
  app.myId = null;
  history.replaceState(null, '', pageUrl());
  show('home');
  $('inviteNote').hidden = true;
  $('joinInviteBtn').hidden = true;
  $('joinRow').hidden = false;
  $('createBtn').classList.add('primary');
  $('createBtn').textContent = 'Create race';
}

function renderAudioBtns() {
  $('musicBtn').classList.toggle('off', !sfx.musicOn);
  $('sfxBtn').classList.toggle('off', !sfx.sfxOn);
  $('sfxBtn').textContent = sfx.sfxOn ? '🔊' : '🔇';
}
$('musicBtn').onclick = () => {
  sfx.unlock();
  sfx.setMusic(!sfx.musicOn);
  renderAudioBtns();
};
$('sfxBtn').onclick = () => {
  sfx.unlock();
  sfx.setSfx(!sfx.sfxOn);
  renderAudioBtns();
};
renderAudioBtns();
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
sfx.music('menu'); // starts after the first tap

// ------------------------------------------------------------------ network events

net.on('status', (s) => {
  $('conn').hidden = s === 'online' || !net.active;
  $('conn').textContent = s === 'searching' ? 'Looking for the race… (your friend needs the game open)' : 'Reconnecting…';
});

// How this phone reaches the host: direct is best; a relay server works but can be shakier.
net.on('link', (type) => {
  $('netInfo').hidden = false;
  $('netInfo').textContent = type === 'relay' ? '📶 Connected through a relay server (on the same Wi-Fi is steadier)' : '📶 Connected directly to the host';
});

net.on('welcome', (msg) => {
  app.myId = msg.id;
  // Keep the screen on while in a room: a locked phone drops everyone connected to it.
  requestWakeLock();
  history.replaceState(null, '', pageUrl(msg.code));
});

net.on('error', (msg) => {
  if (msg.code === 'norejoin' && net.session) {
    // Our seat expired while we were away; join again as a new racer.
    const code = net.session.code;
    net.connect({ t: 'join', code, name: app.profile.name || 'Racer', color: app.profile.color });
    return;
  }
  toast(msg.msg || 'Something went wrong', 5000);
  if (!app.room || ['noroom', 'hostleft', 'hostgone', 'full', 'network'].includes(msg.code)) {
    $('conn').hidden = true;
    leaveRoom();
  }
});

net.on('room', (room) => {
  app.room = room;
  if (room.state === 'lobby') {
    if (app.race) endRaceLocal();
    show('lobby');
    renderLobby();
    sfx.setTempo(1);
    sfx.music('menu');
  } else if (room.state === 'racing') {
    if (app.race) syncBotOwnership();
    else show('waiting');
  } else if (room.state === 'results' && !app.race) {
    show('waiting');
  }
  if (app.race && room.state === 'results') {
    $('againBtn').hidden = room.hostId !== app.myId;
    $('resultsWait').hidden = room.hostId === app.myId;
  }
});

net.on('start', (msg) => beginRace(msg));

net.on('s', (msg) => {
  const race = app.race;
  if (!race) return;
  for (const k of msg.k) {
    const ent = race.karts.get(k.id);
    if (!ent || ent.sim) continue;
    const last = ent.snaps[ent.snaps.length - 1];
    if (last && k.ts <= last.ts) continue;
    ent.snaps.push(k);
    if (ent.snaps.length > 30) ent.snaps.shift();
    ent.progress = k.p;
  }
});

net.on('e', (msg) => {
  const race = app.race;
  if (!race) return;
  const now = performance.now();
  if (msg.type === 'box') race.boxes.take(msg.i, now);
  else if (msg.type === 'spawn') race.hazards.add({ ...msg, idx: -1 }, now);
  else if (msg.type === 'hit') race.hazards.remove(msg.hid);
  else if (msg.type === 'boom') race.hazards.explode(msg.hid);
});

net.on('fin', (msg) => {
  const race = app.race;
  if (!race) return;
  race.finished.set(msg.id, msg);
  const ent = race.karts.get(msg.id);
  if (ent && msg.id !== app.myId && !ent.bot) toast(`${ent.name} finished ${msg.place}${ordinal(msg.place)}!`);
});

net.on('results', (msg) => {
  const race = app.race;
  const list = $('resultList');
  list.innerHTML = msg.standings
    .map(
      (k, i) => `<li class="${k.id === app.myId ? 'me' : ''}">
        <span class="place">${i + 1}${ordinal(i + 1)}</span>
        <span class="dot" style="background:${k.color}"></span>
        <span class="pname">${escapeHtml(k.name)}${k.bot ? ' <em>CPU</em>' : ''}</span>
        <span class="rtime">${k.time == null && k.bot ? '—' : fmtTime(k.time)}</span>
      </li>`
    )
    .join('');
  const isHost = app.room && app.room.hostId === app.myId;
  $('againBtn').hidden = !isHost;
  $('resultsWait').hidden = isHost;
  setTimeout(() => sfx.music('menu'), 2500);
  if (race) {
    race.over = true;
    show('results');
  } else {
    show('waiting');
  }
});

// ------------------------------------------------------------------ race setup

function beginRace(msg) {
  const cur = app.race;
  if (cur && cur.startAt === msg.startAt && cur.track === msg.track) {
    // We just reconnected to the race we're already in: keep going as we were.
    for (const [i, f] of (msg.finished || []).entries()) if (!cur.finished.has(f.id)) cur.finished.set(f.id, { ...f, place: i + 1 });
    return;
  }
  endRaceLocal();
  loadTrack(msg.track);
  const track = app.track;
  const amHost = app.room ? app.room.hostId === app.myId : false;
  const now = performance.now();
  const race = {
    laps: msg.laps,
    startAt: msg.startAt,
    track: msg.track,
    karts: new Map(),
    finished: new Map((msg.finished || []).map((f, i) => [f.id, { ...f, place: i + 1 }])),
    boxes: new ItemBoxes(track, scene),
    hazards: new Hazards(track, scene),
    hidCounter: 0,
    lastSend: 0,
    lastCount: null,
    goShown: false,
    over: false,
    camPos: null,
    camY: null,
    lastTick: 0,
    starMusic: false,
    song: TRACKS[msg.track]?.music || 'sunny',
  };
  sfx.stopMusic();
  sfx.setTempo(1);
  msg.karts.forEach((k, i) => {
    const pose = track.gridPose(k.grid);
    const mine = k.id === app.myId;
    const ent = {
      id: k.id,
      name: k.name,
      color: k.color,
      bot: k.bot,
      mesh: buildKartMesh(k.color, mine ? null : k.name),
      sim: null,
      ai: null,
      snaps: [],
      view: { x: pose.x, z: pose.z, h: pose.h, s: 0 },
      progress: 0,
      item: null,
      uses: 0,
      rolling: 0,
      itemAge: 0,
      lastLap: 1,
      finished: race.finished.has(k.id),
      seed: i + 1,
    };
    const startSim = new KartSim(track, pose);
    ent.progress = startSim.progress;
    if (mine || (k.bot && amHost)) {
      ent.sim = startSim;
      if (k.bot || ent.finished || AUTOPILOT) ent.ai = new BotDriver(track, ent.seed);
      const ks = msg.kstate && msg.kstate[k.id];
      if (ks) restoreSim(ent.sim, ks);
      ent.lastLap = lapOf(ent.sim.progress, race.laps);
    } else if (msg.kstate && msg.kstate[k.id]) {
      const ks = msg.kstate[k.id];
      ent.view = { ...ks };
      ent.progress = ks.p;
    }
    scene.add(ent.mesh);
    race.karts.set(k.id, ent);
  });
  app.race = race;
  input.read(); // drop any queued button presses
  show('race');
  $('itemIcon').textContent = '';
  $('posOf').textContent = '/' + race.karts.size;
  requestWakeLock();
  if (track.jumps.length) setTimeout(() => app.race === race && toast('Tip: tap DRIFT in mid-air for a trick boost!', 3500), 600);
  if (!race.karts.has(app.myId)) {
    endRaceLocal();
    show('waiting');
  }
}

function restoreSim(sim, ks) {
  sim.x = ks.x;
  sim.z = ks.z;
  sim.h = ks.h;
  const n = app.track.nearest(ks.x, ks.z);
  sim.idx = n.idx;
  sim.lastFrac = n.frac;
  sim.lastSafeIdx = n.idx;
  sim.y = app.track.heightAt(n.frac);
  sim.progress = ks.p;
}

function lapOf(progress, laps) {
  return Math.max(1, Math.min(laps, Math.floor(progress / app.track.N) + 1));
}

// The host drives the CPU karts. If the host changes mid-race, hand them over.
function syncBotOwnership() {
  const race = app.race;
  const amHost = app.room.hostId === app.myId;
  for (const ent of race.karts.values()) {
    if (!ent.bot) continue;
    if (amHost && !ent.sim) {
      const v = ent.snaps[ent.snaps.length - 1] || ent.view;
      ent.sim = new KartSim(app.track, { x: v.x, z: v.z, h: v.h });
      restoreSim(ent.sim, { x: v.x, z: v.z, h: v.h, p: v.p ?? ent.progress });
      ent.ai = new BotDriver(app.track, ent.seed);
      ent.snaps = [];
    } else if (!amHost && ent.sim) {
      ent.sim = null;
      ent.ai = null;
      ent.snaps = [];
    }
  }
}

function endRaceLocal() {
  const race = app.race;
  if (!race) return;
  for (const ent of race.karts.values()) scene.remove(ent.mesh);
  race.boxes.dispose(scene);
  race.hazards.clear();
  app.race = null;
  sfx.kart({ on: false });
}

// Keep the screen on while in a room. If a phone auto-locks (iPhones do after 30s
// without a new touch, e.g. after finishing while a friend is still racing) its
// connection drops, and if it's hosting, everyone's does. iPhones only grant this
// right after a tap, so we ask again on every tap until we have it.
let wakeLock = null;
let wakeLockPending = false;
async function requestWakeLock() {
  if ((wakeLock && !wakeLock.released) || wakeLockPending || !navigator.wakeLock) return;
  wakeLockPending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    // Not allowed right now (no recent tap, or the page is hidden): the next tap tries again.
  } finally {
    wakeLockPending = false;
  }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.room) requestWakeLock();
});
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(type, () => app.room && requestWakeLock(), { capture: true, passive: true });
}

// ------------------------------------------------------------------ race loop

function rankings(race) {
  const N = app.track.N;
  const list = [...race.karts.values()].map((e) => {
    const fin = race.finished.get(e.id);
    return { e, fin, p: e.sim ? e.sim.progress : e.progress };
  });
  list.sort((a, b) => {
    if (a.fin && b.fin) return a.fin.place - b.fin.place;
    if (a.fin) return -1;
    if (b.fin) return 1;
    const pa = a.e.finished ? race.laps * N + 1e6 : a.p;
    const pb = b.e.finished ? race.laps * N + 1e6 : b.p;
    return pb - pa;
  });
  list.forEach((r, i) => (r.e.rank = i + 1));
  return list;
}

// The first time you get one of the newer items, say what it does.
const tipsShown = new Set();
function showItemTip(item) {
  if (!ITEM_TIPS[item] || tipsShown.has(item)) return;
  tipsShown.add(item);
  toast(ITEM_TIPS[item], 3500);
}

function spawnHazard(ent, kind, x, z, vx, vz) {
  const race = app.race;
  const hid = `${app.myId}-${++race.hidCounter}`;
  const h = { hid, kind, x, z, vx, vz, owner: ent.id };
  race.hazards.add({ ...h, idx: ent.sim.idx }, performance.now());
  net.send({ t: 'e', type: 'spawn', ...h });
}

function useItem(ent) {
  const sim = ent.sim;
  const fx = Math.sin(sim.h);
  const fz = Math.cos(sim.h);
  switch (ent.item) {
    case 'mushroom':
    case 'mushroom3':
      sim.boost(1.3);
      break;
    case 'star':
      sim.star();
      break;
    case 'banana':
      spawnHazard(ent, 'banana', sim.x - fx * 2.8, sim.z - fz * 2.8, 0, 0);
      break;
    case 'shell': {
      const sp = Math.max(0, sim.speed) + 30;
      spawnHazard(ent, 'shell', sim.x + fx * 2.8, sim.z + fz * 2.8, fx * sp, fz * sp);
      break;
    }
    case 'rocket':
      sim.rocket();
      break;
    case 'glider':
      sim.glide();
      break;
    case 'ghost':
      sim.ghost();
      break;
    case 'tornado':
      spawnHazard(ent, 'tornado', sim.x + fx * 5, sim.z + fz * 5, 0, 0);
      break;
    case 'bomb': {
      const sp = Math.max(0, sim.speed) * 0.5 + 18;
      spawnHazard(ent, 'bomb', sim.x + fx * 3, sim.z + fz * 3, fx * sp, fz * sp);
      break;
    }
  }
  if (ent.id === app.myId) sfx.useItem(ent.item);
  ent.uses--;
  if (ent.uses <= 0) ent.item = null;
  ent.itemAge = 0;
}

function botWantsItem(ent, dt, corner, race) {
  ent.itemAge += dt;
  const a = ent.itemAge;
  switch (ent.item) {
    case 'star':
    case 'rocket':
      return a > 0.6;
    case 'glider':
      return a > 1 && corner < 0.2;
    case 'ghost':
      return a > 1.5;
    case 'tornado':
      return a > 1;
    case 'bomb':
    case 'mushroom':
    case 'mushroom3':
      return a > 1 && corner < 0.15;
    case 'banana':
      return a > 2.5 + (ent.seed % 3);
    case 'shell': {
      if (a > 7) return true;
      const sim = ent.sim;
      const fx = Math.sin(sim.h);
      const fz = Math.cos(sim.h);
      for (const o of race.karts.values()) {
        if (o === ent) continue;
        const v = o.view;
        const dx = v.x - sim.x;
        const dz = v.z - sim.z;
        const d = Math.hypot(dx, dz);
        if (d > 4 && d < 40 && (dx * fx + dz * fz) / d > 0.97) return a > 0.5;
      }
      return false;
    }
  }
  return false;
}

function remoteView(ent, renderT) {
  const s = ent.snaps;
  if (!s.length) return ent.view;
  while (s.length > 2 && s[1].ts <= renderT) s.shift();
  const a = s[0];
  const b = s[1];
  let base;
  let extra;
  if (!b || renderT <= a.ts) {
    base = b || a;
    extra = b ? 0 : Math.max(0, Math.min(0.25, (renderT - a.ts) / 1000));
    if (renderT <= a.ts) {
      base = a;
      extra = 0;
    }
  } else if (renderT >= b.ts) {
    base = b;
    extra = Math.min(0.25, (renderT - b.ts) / 1000);
  } else {
    const f = (renderT - a.ts) / (b.ts - a.ts);
    let dh = b.h - a.h;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return {
      ...b,
      x: a.x + (b.x - a.x) * f,
      z: a.z + (b.z - a.z) * f,
      h: a.h + dh * f,
      y: a.y + (b.y - a.y) * f,
      pt: a.pt + (b.pt - a.pt) * f,
      s: a.s + (b.s - a.s) * f,
      hop: a.hop + (b.hop - a.hop) * f,
    };
  }
  return {
    ...base,
    x: base.x + Math.sin(base.h) * base.s * extra,
    z: base.z + Math.cos(base.h) * base.s * extra,
  };
}

function updateRace(dt, now) {
  const race = app.race;
  const track = app.track;
  const sNow = net.serverNow();
  const tRace = (sNow - race.startAt) / 1000;
  const started = tRace >= 0;

  // Countdown
  if (!started) {
    const n = Math.ceil(-tRace);
    if (n <= 3 && n !== race.lastCount) {
      race.lastCount = n;
      banner(String(n), 0, 'count');
      sfx.count();
    }
  } else if (!race.goShown) {
    race.goShown = true;
    banner('GO!', 900, 'go');
    sfx.go();
    sfx.music(race.song);
  }
  track.animate(dt, Math.max(0, tRace), camera);

  const inp = input.read();
  const ranks = rankings(race);
  let bestHuman = -Infinity;
  for (const r of ranks) if (!r.e.bot) bestHuman = Math.max(bestHuman, r.p);

  // Simulate karts this phone is responsible for.
  for (const ent of race.karts.values()) {
    const sim = ent.sim;
    if (!sim) continue;
    const isMe = ent.id === app.myId;
    let ctl;
    let corner = 0;
    if (!started) {
      ctl = { steer: 0, throttle: false, brake: false, drift: false };
    } else if (isMe && !ent.finished && !AUTOPILOT) {
      ctl = inp;
    } else {
      ctl = ent.ai.drive(sim, dt, ent.bot ? sim.progress - bestHuman : 0);
      corner = ctl.corner;
    }
    const others = [];
    for (const o of race.karts.values()) {
      if (o !== ent) others.push({ x: o.view.x, y: o.view.y || 0, z: o.view.z, star: !!o.view.st || ((o.view.md || 0) & 1) !== 0, ghost: ((o.view.md || 0) & 4) !== 0 });
    }
    sim.update(dt, ctl, others);

    if (isMe) {
      const evs = sim.events;
      for (const ev of evs) {
        if (ev === 'boost' && !evs.includes('miniturbo') && !evs.includes('trickboost')) sfx.boost();
        else if (ev === 'miniturbo') sfx.miniturbo(sim.boostTime > 1 ? 2 : 1);
        else if (ev === 'trickboost') sfx.miniturbo(2);
        else if (ev === 'wall' || ev === 'bump') sfx.bump();
        else if (ev === 'hit') sfx.hit();
        else if (ev === 'jump') sfx.jump();
        else if (ev === 'land') sfx.land();
        else if (ev === 'trick') sfx.trick();
        else if (ev === 'fall') sfx.fall();
        else if (ev === 'respawn') sfx.respawn();
        else if (ev === 'rocket') sfx.rocket();
        else if (ev === 'rocketEnd') sfx.rocketEnd();
        else if (ev === 'glide') sfx.glide();
        else if (ev === 'ghost') sfx.ghost();
      }
    }
    sim.events.length = 0;

    // Rolling boulders / snowballs (positions come from the shared race clock)
    if (started && !sim.falling && sim.rocketTime <= 0 && sim.ghostTime <= 0) {
      for (const r of track.rollers) {
        const p = track.rollerAt(r, tRace);
        const dx = sim.x - p.x;
        const dz = sim.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < ROLLER_RADIUS + 1.1 && Math.abs(sim.y + 0.6 - p.y) < ROLLER_RADIUS + 0.8 && d > 0.01) {
          sim.kx += (dx / d) * 14;
          sim.kz += (dz / d) * 14;
          if (sim.starTime <= 0 && sim.hit() && isMe) {
            sfx.roller();
            sfx.hit();
            if (navigator.vibrate) navigator.vibrate(120);
          }
        }
      }
    }

    if (started) {
      // Item boxes
      const box = sim.falling ? -1 : race.boxes.touch(sim.x, sim.y, sim.z, now);
      if (box >= 0) {
        net.send({ t: 'e', type: 'box', i: box });
        if (!ent.item && ent.rolling <= 0) {
          ent.rolling = 1.1;
          ent.pending = rollItem(ent.rank || race.karts.size, race.karts.size);
          if (isMe) sfx.pickup();
        }
      }
      if (ent.rolling > 0) {
        ent.rolling -= dt;
        if (ent.rolling <= 0) {
          ent.item = ent.pending;
          ent.uses = ent.item === 'mushroom3' ? 3 : 1;
          ent.itemAge = 0;
          if (isMe) {
            sfx.itemReady();
            showItemTip(ent.item);
          }
        } else if (isMe && now - race.lastTick > 90) {
          race.lastTick = now;
          sfx.roulette();
        }
      }
      const wants = isMe && !ent.finished ? inp.useItem : ent.item && botWantsItem(ent, dt, corner, race);
      if (wants && ent.item && sim.spinTime <= 0 && (!sim.falling || ent.item === 'rocket')) useItem(ent);

      // Bananas and shells
      const hz = sim.ghostTime > 0 ? null : race.hazards.collide(ent.id, sim.x, sim.y, sim.z, now);
      if (hz) {
        let hurt = false;
        if (hz.effect === 'spin') {
          net.send({ t: 'e', type: 'hit', hid: hz.h.hid });
          hurt = sim.hit();
        } else if (hz.effect === 'boom') {
          net.send({ t: 'e', type: 'boom', hid: hz.h.hid });
          race.hazards.explode(hz.h.hid);
        } else if (hz.effect === 'launch') {
          hurt = sim.blast(14);
          if (hurt && isMe) sfx.tornado();
        }
        if (hurt && isMe) {
          sfx.hit();
          if (navigator.vibrate) navigator.vibrate(120);
        }
      }

      // Laps & finish
      if (!ent.finished) {
        const lap = lapOf(sim.progress, race.laps);
        if (isMe && lap > ent.lastLap) {
          banner(lap === race.laps ? 'FINAL LAP!' : `LAP ${lap}`, 1600, 'lap');
          if (lap === race.laps) {
            sfx.finalLap();
            sfx.setTempo(1.12);
          } else {
            sfx.lap();
          }
        }
        ent.lastLap = Math.max(ent.lastLap, lap);
        if (sim.progress >= race.laps * track.N) {
          ent.finished = true;
          ent.finishTime = tRace;
          net.send({ t: 'finish', id: ent.id, time: tRace });
          if (!ent.ai) ent.ai = new BotDriver(track, ent.seed);
          if (isMe) {
            const place = ranks.findIndex((r) => r.e === ent) + 1;
            banner(`FINISH! ${place}${ordinal(place)}`, 0, 'finish');
            sfx.stopMusic();
            sfx.finish();
          }
        }
      }
    }
    ent.view = sim.snapshot();
    ent.progress = sim.progress;
  }

  // Send our karts ~15 times a second.
  if (now - race.lastSend > SEND_INTERVAL) {
    race.lastSend = now;
    const k = [];
    for (const ent of race.karts.values()) {
      if (!ent.sim) continue;
      const v = ent.view;
      k.push({
        id: ent.id,
        ts: Math.round(sNow),
        x: +v.x.toFixed(2),
        z: +v.z.toFixed(2),
        h: +v.h.toFixed(3),
        y: +v.y.toFixed(2),
        pt: +v.pt.toFixed(2),
        tr: +v.tr.toFixed(2),
        md: v.md,
        s: +v.s.toFixed(1),
        p: +v.p.toFixed(1),
        sp: v.sp,
        st: v.st,
        b: v.b,
        dd: v.dd,
        dc: v.dc,
        hop: +v.hop.toFixed(2),
      });
    }
    if (k.length) net.send({ t: 's', k });
  }

  // Remote karts
  const renderT = sNow - INTERP_DELAY;
  for (const ent of race.karts.values()) {
    if (ent.sim) continue;
    ent.view = remoteView(ent, renderT);
    const n = track.nearest(ent.view.x, ent.view.z, ent.hint ?? -1);
    ent.hint = n.idx;
    ent.view.gy = track.isGap(n.frac) ? null : track.heightAt(n.frac);
    if (ent.view.y === undefined) ent.view.y = ent.view.gy ?? 0;
  }

  const booms = race.hazards.update(dt, now);
  for (const b of booms) {
    const meV = race.karts.get(app.myId)?.view;
    const d = meV ? Math.hypot(meV.x - b.x, meV.z - b.z) : 999;
    sfx.boom(Math.max(0.15, 1 - d / 80));
    for (const ent of race.karts.values()) {
      const k = ent.sim;
      if (!k || !started) continue;
      if (Math.hypot(k.x - b.x, k.z - b.z, (k.y - b.y) * 0.5) < BLAST_RADIUS && k.blast(13) && ent.id === app.myId) {
        sfx.hit();
        if (navigator.vibrate) navigator.vibrate(200);
      }
    }
  }
  race.boxes.update(dt, now);

  const time = now / 1000;
  for (const ent of race.karts.values()) poseKartMesh(ent.mesh, ent.view, time, dt);

  // HUD
  const me = race.karts.get(app.myId);
  if (me) {
    $('pos').textContent = me.rank;
    $('posSuffix').textContent = ordinal(me.rank);
    const lap = me.sim ? lapOf(me.sim.progress, race.laps) : 1;
    $('lap').textContent = `Lap ${lap}/${race.laps}`;
    const shown = me.finished ? me.finishTime : Math.max(0, tRace);
    $('time').textContent = fmtTime(shown);
    let icon = '';
    if (me.rolling > 0) icon = ROULETTE[Math.floor(now / 90) % ROULETTE.length];
    else if (me.item) icon = me.item === 'mushroom3' ? '🍄×' + me.uses : ITEM_ICONS[me.item];
    const el = $('itemIcon');
    if (el.textContent !== icon) el.textContent = icon;
    $('itemBox').classList.toggle('ready', !!me.item && me.rolling <= 0);
    drawMinimap(race);
    if (me.sim) {
      const k = me.sim;
      sfx.kart({ on: true, speed: k.speed / MAX_SPEED, boost: k.boostTime > 0 || k.rocketTime > 0, drift: k.driftTier, drifting: !!k.driftDir, offroad: k.offroad, air: k.air });
      const star = (k.starTime > 0 || k.rocketTime > 0) && !me.finished;
      if (star !== race.starMusic && started && !me.finished) {
        race.starMusic = star;
        sfx.music(star ? 'star' : race.song);
      }
    }
    updateChaseCamera(me, dt);
  }
}

function updateChaseCamera(me, dt) {
  const race = app.race;
  const v = me.view;
  const portrait = camera.aspect < 1;
  const fx = Math.sin(v.h);
  const fz = Math.cos(v.h);
  const md = v.md || 0;
  // Pull back for the rocket ride and the glider so you can see where you're going.
  const back = (portrait ? 8.5 : 7) + (md & 1 ? 1.5 : 0) + (md & 2 ? 2 : 0);
  const up = (portrait ? 4 : 3.2) + (md & 1 ? 1.2 : 0) + (md & 2 ? 1.5 : 0);
  // Follow height loosely, but don't dive into a gap after a falling kart.
  const ky = Math.max(v.y || 0, (v.gy ?? v.y ?? 0) - 1, -4);
  if (race.camY === null) race.camY = ky;
  race.camY += (ky - race.camY) * (1 - Math.exp(-dt * 5));
  const target = new THREE.Vector3(v.x - fx * back, race.camY + up + (v.hop || 0) * 0.4, v.z - fz * back);
  if (!race.camPos) race.camPos = target.clone();
  race.camPos.lerp(target, 1 - Math.exp(-dt * (md & 1 ? 16 : 7)));
  camera.position.copy(race.camPos);
  camera.lookAt(v.x + fx * 5, race.camY + 1.3, v.z + fz * 5);
  const baseFov = portrait ? 80 : 65;
  const speedFov = Math.min(16, Math.max(0, (v.s || 0) - MAX_SPEED * 0.8) * 0.6);
  const fov = baseFov + speedFov;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
}

// Slow fly-by behind the menus.
let idleT = 0;
function updateIdleCamera(dt) {
  const track = app.track;
  if (!track) return;
  idleT += dt * 9;
  const a = track.pointAt(idleT, 0);
  const b = track.pointAt(idleT + 30, 0);
  camera.position.set(a.x + 10, a.y + 14, a.z);
  camera.lookAt(b.x, b.y + 2, b.z);
  if (camera.fov !== 65) {
    camera.fov = 65;
    camera.updateProjectionMatrix();
  }
  track.animate(dt, performance.now() / 1000, camera);
}

// ------------------------------------------------------------------ minimap

const mini = $('minimap');
const miniCtx = mini.getContext('2d');
let miniPath = null;
let miniMap = null;
function buildMinimap() {
  const t = app.track;
  const b = t.bounds;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const pad = 12;
  const scale = (mini.width - pad * 2) / size;
  // Top-down view: world +x is screen right, world +z is screen down.
  miniMap = (x, z) => [pad + (x - b.minX) * scale + ((size - (b.maxX - b.minX)) * scale) / 2, pad + (z - b.minZ) * scale + ((size - (b.maxZ - b.minZ)) * scale) / 2];
  miniPath = new Path2D();
  for (let i = 0; i <= t.N; i += 2) {
    const [x, y] = miniMap(t.px[i % t.N], t.pz[i % t.N]);
    if (i === 0) miniPath.moveTo(x, y);
    else miniPath.lineTo(x, y);
  }
  miniPath.closePath();
}

function drawMinimap(race) {
  const ctx = miniCtx;
  ctx.clearRect(0, 0, mini.width, mini.height);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 9;
  ctx.stroke(miniPath);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 5;
  ctx.stroke(miniPath);
  const order = [...race.karts.values()].sort((a, b) => (a.id === app.myId) - (b.id === app.myId));
  for (const ent of order) {
    const [x, y] = miniMap(ent.view.x, ent.view.z);
    const me = ent.id === app.myId;
    ctx.beginPath();
    ctx.arc(x, y, me ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = ent.color;
    ctx.fill();
    ctx.lineWidth = me ? 3 : 1.5;
    ctx.strokeStyle = me ? '#fff' : 'rgba(0,0,0,0.6)';
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ main loop

let last = performance.now();
let slowFrames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  // Drop resolution on phones that struggle to keep up.
  if (app.race && now - last > 26) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 0.5);
  if (slowFrames > 90 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.5);
    renderer.setPixelRatio(pixelRatio);
    resize();
    slowFrames = 0;
  }
  last = now;
  if (app.race) {
    // Slow frames are split into small steps so the karts drive the same at any frame rate.
    const steps = Math.ceil(dt / 0.034);
    for (let i = 1; i <= steps && app.race; i++) updateRace(dt / steps, now - ((steps - i) * (dt * 1000)) / steps);
  } else {
    updateIdleCamera(dt);
  }
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot

loadTrack('sunny');
show('home');
let saved = null;
try {
  saved = JSON.parse(sessionStorage.getItem('kc-session') || 'null');
} catch {}
if (saved && inviteCode && saved.code === inviteCode) {
  // Page was reloaded while in a room: take our seat back.
  net.resume(saved);
}
requestAnimationFrame(frame);

// Handy for debugging from the browser console.
window.kartClash = { app, net, sfx };
