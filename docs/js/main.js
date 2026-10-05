import * as THREE from 'three';
import { Track, ROLLER_RADIUS } from './track.js';
import { TRACKS } from './tracks.js';
import { KartSim, BotDriver, buildKartMesh, poseKartMesh, MAX_SPEED } from './kart.js';
import { ItemBoxes, Hazards, rollItem, ITEM_ICONS, ITEM_TIPS, ROULETTE, THROWABLE } from './items.js';

const ITEM_LIST = Object.keys(ITEM_ICONS); // item numbers sent over the network
import { Input } from './input.js';
import { Net } from './net.js';
import { sfx } from './audio.js';
import { packKart, unpackKart } from './proto.js';
import { RESULTS_TIMEOUT_MS } from './room.js';
import qrcode from '../vendor/qrcode.js';

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
  // 'phone': everyone plays on their own phone (the main way to play).
  // 'tv': this screen is a TV that also shows every player's view, split screen.
  mode: 'phone',
};

function setMode(mode) {
  app.mode = mode;
  document.body.classList.toggle('tv', mode === 'tv');
}

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
$('tvBtn').onclick = () => {
  sfx.unlock();
  connecting();
  setMode('tv');
  net.connect({ t: 'create', tv: true, name: 'TV', color: '#ffffff' });
};
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

function renderQr(url) {
  if (renderQr.url === url) return;
  renderQr.url = url;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  $('qrUrl').textContent = url;
}

function renderLobby() {
  const room = app.room;
  const isHost = room.hostId === app.myId;
  const canControl = isHost || room.tv; // in TV mode anyone on the couch can start
  const racers = room.tv ? room.players.filter((p) => p.id !== room.hostId) : room.players;
  $('roomCode').textContent = room.code;
  $('smsLink').href = `sms:?&body=${encodeURIComponent(inviteText() + ' ' + inviteUrl())}`;
  $('qrBox').hidden = app.mode !== 'tv';
  if (app.mode === 'tv') renderQr(inviteUrl());
  $('padNote').hidden = !(room.tv && app.mode !== 'tv');
  $('playerList').innerHTML = racers
    .map(
      (p) => `<li>
        <span class="dot" style="background:${p.color}"></span>
        <span class="pname">${escapeHtml(p.name)}${p.id === app.myId ? ' <em>(you)</em>' : ''}</span>
        ${p.id === room.hostId && !room.tv ? '<span class="badge">👑 host</span>' : ''}
        ${p.connected ? '' : '<span class="badge off">reconnecting…</span>'}
      </li>`
    )
    .join('');
  const s = room.settings;
  if (room.tv && racers.length === 0) $('playerList').innerHTML = '<li class="empty">No controllers yet: scan the code!</li>';
  $('hostSettings').hidden = !canControl;
  $('guestSettings').hidden = canControl;
  $('lapsVal').textContent = s.laps;
  $('botsVal').textContent = s.bots;
  document.querySelectorAll('[data-setting="track"]').forEach((b) => b.classList.toggle('selected', b.dataset.value === s.track));
  $('guestSettings').textContent = `${TRACKS[s.track].name} · ${s.laps} lap${s.laps > 1 ? 's' : ''} · ${s.bots} CPU racer${s.bots === 1 ? '' : 's'}`;
  $('startBtn').hidden = !canControl || racers.length === 0;
  $('waitHost').hidden = canControl;
  $('soloHint').hidden = !(isHost && !room.tv && room.players.length === 1);
  loadTrack(s.track);
}

function leaveRoom() {
  net.leave();
  $('netInfo').hidden = true;
  releaseWakeLock();
  setMode('phone');
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
  // Mid-race, announce players dropping out and coming back.
  if (app.race && app.room) {
    for (const p of room.players) {
      const before = app.room.players.find((x) => x.id === p.id);
      if (before && before.connected && !p.connected && app.race.karts.has(p.id)) feed(`📵 ${feedName(p.id)} lost connection`);
      if (before && !before.connected && p.connected && app.race.karts.has(p.id)) feed(`✅ ${feedName(p.id)} is back`);
    }
  }
  app.room = room;
  const mode = room.tv && room.hostId === app.myId ? 'tv' : 'phone';
  if (mode !== app.mode) setMode(mode);
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
    const canControl = room.hostId === app.myId || room.tv;
    $('againBtn').hidden = !canControl;
    $('resultsWait').hidden = canControl;
  }
});

net.on('start', (msg) => beginRace(msg));

net.on('s', (msg) => {
  const race = app.race;
  if (!race) return;
  for (const a of msg.k) {
    const k = unpackKart(a);
    if (!k) continue;
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
  else if (msg.type === 'spawn') {
    race.hazards.add({ ...msg, idx: -1 }, now);
    if (msg.kind === 'blueshell') race.lastBlueAt = now;
  } else if (msg.type === 'ko') feed(koText(msg));
  else if (msg.type === 'hit') race.hazards.remove(msg.hid);
  else if (msg.type === 'boom') race.hazards.explode(msg.hid);
});

net.on('fin', (msg) => {
  const race = app.race;
  if (!race) return;
  race.finished.set(msg.id, msg);
  const ent = race.karts.get(msg.id);
  if (ent) feed(`🏁 ${feedName(msg.id)} finished ${msg.place}${ordinal(msg.place)}`);
  if (ent && !ent.bot && !race.firstHumanDone) {
    race.firstHumanDone = true;
    if (!race.finished.has(app.myId) && race.karts.has(app.myId)) feed(`⏱️ ${RESULTS_TIMEOUT_MS / 1000} seconds left to finish!`);
  }
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
  const canControl = app.room && (app.room.hostId === app.myId || app.room.tv);
  $('againBtn').hidden = !canControl;
  $('resultsWait').hidden = canControl;
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
    // We drive our own kart, and the CPU karts if we're hosting (the TV hosts in TV mode).
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
  setupViewers(race, msg);
  show('race');
  $('itemIcon').textContent = '';
  $('posOf').textContent = '/' + race.karts.size;
  requestWakeLock();
  if (track.jumps.length) setTimeout(() => app.race === race && toast('Tip: tap DRIFT in mid-air for a trick boost!', 3500), 600);
  if (app.mode !== 'tv' && !race.karts.has(app.myId)) {
    endRaceLocal();
    show('waiting');
  }
}

// Who is watching on this screen. A phone shows its own kart full screen; the TV
// splits the screen between every player, each with their own camera and display.
// Split-screen grid for n players: [columns, rows].
function tvGrid(n) {
  return n <= 1 ? [1, 1] : n === 2 ? [2, 1] : n <= 4 ? [2, 2] : n <= 6 ? [3, 2] : [4, 2];
}
function setupViewers(race, msg) {
  race.viewers = [];
  race.viewerOf = new Map();
  const tvHud = $('tvHud');
  tvHud.innerHTML = '';
  if (app.mode !== 'tv') {
    const me = race.karts.get(app.myId);
    if (!me) return;
    const hud = { pos: $('pos'), posSuffix: $('posSuffix'), posOf: $('posOf'), lap: $('lap'), time: $('time'), itemIcon: $('itemIcon'), itemBox: $('itemBox') };
    const view = { ent: me, cam: camera, hud, camPos: null, camY: null };
    race.viewers.push(view);
    race.viewerOf.set(me.id, view);
    return;
  }
  const humans = msg.karts.filter((k) => !k.bot).map((k) => race.karts.get(k.id)).slice(0, 8);
  const [cols, rows] = tvGrid(humans.length);
  const cell = (i) => [(i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows];
  tvHud.className = humans.length > 4 ? 'small' : '';
  humans.forEach((ent, i) => {
    const [x, y, w, h] = cell(i);
    const el = document.createElement('div');
    el.className = 'tvView';
    Object.assign(el.style, { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: h * 100 + '%' });
    el.innerHTML = `
      <div class="tvTop">
        <div><div class="tvPos"><span>1</span><sup>st</sup></div><span class="tvName" style="background:${ent.color}">${escapeHtml(ent.name)}</span></div>
        <div class="tvItem"><span></span></div>
        <div class="tvLap"><div>Lap 1</div><div class="tvTime">0:00.00</div></div>
      </div>
      <div class="tvBanner"></div>`;
    tvHud.appendChild(el);
    const q = (sel) => el.querySelector(sel);
    const hud = { pos: q('.tvPos span'), posSuffix: q('.tvPos sup'), lap: q('.tvLap div'), time: q('.tvTime'), itemIcon: q('.tvItem span'), itemBox: q('.tvItem'), banner: q('.tvBanner') };
    const view = { ent, cam: new THREE.PerspectiveCamera(70, w / h, 0.5, 2000), rect: cell(i), hud, camPos: null, camY: null };
    race.viewers.push(view);
    race.viewerOf.set(ent.id, view);
  });
  // A spare square in the grid shows a fly-over of the track.
  race.overview = humans.length < cols * rows ? cell(humans.length) : null;
  if (race.overview) {
    const [x, y, w, h] = race.overview;
    const el = document.createElement('div');
    el.className = 'tvView overview';
    Object.assign(el.style, { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: h * 100 + '%' });
    tvHud.appendChild(el);
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
  $('tvHud').innerHTML = '';
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

function spawnHazard(ent, kind, x, z, vx, vz, extra = {}) {
  const race = app.race;
  const hid = `${app.myId}-${++race.hidCounter}`;
  const h = { hid, kind, x, z, vx, vz, owner: ent.id, ...extra };
  race.hazards.add({ ...h, idx: ent.sim.idx }, performance.now());
  net.send({ t: 'e', type: 'spawn', ...h });
  if (kind === 'blueshell') race.lastBlueAt = performance.now();
}

// Whoever is in 1st (and still racing), other than the thrower: the blue turtle's target.
function leaderFor(ent) {
  for (const r of rankings(app.race)) if (!r.fin && !r.e.finished && r.e !== ent) return r.e;
  return null;
}

// Blue turtles are rare: never two in the air, and a cool-down after each one.
function blueAllowed(race, now) {
  return ![...race.hazards.list.values()].some((h) => h.kind === 'blueshell') && now - (race.lastBlueAt ?? -1e9) > 25000;
}

// dir: 'tap' (the item's usual direction), 'fwd' (swiped up) or 'back' (swiped down).
function useItem(ent, dir = 'tap') {
  const sim = ent.sim;
  const fx = Math.sin(sim.h);
  const fz = Math.cos(sim.h);
  const back = dir === 'back';
  const s = back ? -1 : 1;
  switch (ent.item) {
    case 'mushroom':
    case 'mushroom3':
      sim.boost(1.3);
      break;
    case 'star':
      sim.star();
      break;
    case 'banana':
      // Dropped behind, unless swiped up to toss it ahead.
      if (dir === 'fwd') spawnHazard(ent, 'banana', sim.x + fx * 14, sim.z + fz * 14, 0, 0);
      else spawnHazard(ent, 'banana', sim.x - fx * 2.8, sim.z - fz * 2.8, 0, 0);
      break;
    case 'shell': {
      const sp = back ? 28 : Math.max(0, sim.speed) + 30;
      spawnHazard(ent, 'shell', sim.x + s * fx * 2.8, sim.z + s * fz * 2.8, s * fx * sp, s * fz * sp);
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
      spawnHazard(ent, 'tornado', sim.x + s * fx * 5, sim.z + s * fz * 5, 0, 0, { dir: s });
      break;
    case 'bomb': {
      const sp = back ? 10 : Math.max(0, sim.speed) * 0.5 + 18;
      spawnHazard(ent, 'bomb', sim.x + s * fx * 3, sim.z + s * fz * 3, s * fx * sp, s * fz * sp);
      break;
    }
    case 'boomerang': {
      const sp = 42 + (back ? 0 : Math.max(0, sim.speed) * 0.4);
      spawnHazard(ent, 'boomerang', sim.x + s * fx * 2.8, sim.z + s * fz * 2.8, s * fx * sp, s * fz * sp);
      break;
    }
    case 'blueshell': {
      const target = leaderFor(ent);
      if (target) spawnHazard(ent, 'blueshell', sim.x, sim.z, 0, 0, { tg: target.id });
      break;
    }
  }
  if (ent.id === app.myId) sfx.useItem(ent.item);
  ent.uses--;
  if (ent.uses <= 0) ent.item = null;
  ent.itemAge = 0;
}

// Is there a kart close ahead of / behind this one?
function kartNear(ent, race, behind) {
  const sim = ent.sim;
  const fx = Math.sin(sim.h);
  const fz = Math.cos(sim.h);
  for (const o of race.karts.values()) {
    if (o === ent) continue;
    const dx = o.view.x - sim.x;
    const dz = o.view.z - sim.z;
    const d = Math.hypot(dx, dz);
    const cos = (dx * fx + dz * fz) / (d || 1);
    if (!behind && d > 4 && d < 40 && cos > 0.97) return true;
    if (behind && d > 3 && d < 25 && cos < -0.9) return true;
  }
  return false;
}

// CPU racers: whether to use their item now, and which way ('tap', 'fwd', 'back').
function botWantsItem(ent, dt, corner, race) {
  ent.itemAge += dt;
  const a = ent.itemAge;
  switch (ent.item) {
    case 'star':
    case 'rocket':
      return a > 0.6 && 'tap';
    case 'glider':
      return a > 1 && corner < 0.2 && 'tap';
    case 'ghost':
      return a > 1.5 && 'tap';
    case 'tornado':
    case 'blueshell':
      return a > 1 && 'tap';
    case 'mushroom':
    case 'mushroom3':
      return a > 1 && corner < 0.15 && 'tap';
    case 'banana':
      if (a > 0.8 && kartNear(ent, race, true)) return 'back';
      return a > 2.5 + (ent.seed % 3) && 'tap';
    case 'shell':
    case 'bomb':
    case 'boomerang':
      if (a > 0.5 && kartNear(ent, race, false)) return 'fwd';
      if (a > 0.8 && kartNear(ent, race, true)) return 'back';
      return a > 7 && 'tap';
  }
  return false;
}

// ---- Live announcements: who hit whom with what, falls, finishes, connections

const FEED_ICONS = { banana: '🍌', shell: '🐢', blueshell: '<span class="blue">🐢</span>', bomb: '💣', tornado: '🌪️', boomerang: '🪃', star: '⭐', rocket: '🚀' };
function feedName(id) {
  const e = app.race?.karts.get(id);
  const p = e ? null : app.room?.players.find((x) => x.id === id);
  const name = e ? e.name : p ? p.name : '?';
  const color = e ? e.color : p ? p.color : '#fff';
  return `<b style="color:${color}">${escapeHtml(name)}</b>`;
}
function feed(html) {
  const box = $('feed');
  const line = document.createElement('div');
  line.className = 'feedLine';
  line.innerHTML = html;
  box.appendChild(line);
  while (box.children.length > 5) box.firstChild.remove();
  setTimeout(() => line.classList.add('gone'), 5000);
  setTimeout(() => line.remove(), 5600);
}
function koText({ v, a, w }) {
  const V = feedName(v);
  if (w === 'fall') return `${V} fell in 💦`;
  if (w === 'roller') return `${V} got flattened ${app.track?.def.theme === 'snow' ? '☃️' : '🪨'}`;
  const icon = FEED_ICONS[w] || '💥';
  if (!a || a === v) return `${V} ${icon} oops!`;
  return `${feedName(a)} ${icon} ${V}`;
}
// One of our karts got knocked out: tell everyone.
function reportKo(v, a, w) {
  const ko = { v, a: a || '', w };
  feed(koText(ko));
  net.send({ t: 'e', type: 'ko', ...ko });
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

// Which input drives this kart right now, or null to let the CPU drive it.
function humanControl(ent, inp) {
  if (ent.bot || ent.finished || AUTOPILOT) return null;
  return ent.id === app.myId ? inp : null;
}

// Big text for one player: the whole screen on a phone, their quarter on the TV.
function viewerSay(view, text, ms, cls) {
  if (app.mode !== 'tv') {
    banner(text, ms, cls);
    return;
  }
  const el = view.hud.banner;
  el.textContent = text;
  el.className = 'tvBanner show ' + cls;
  clearTimeout(view.bannerTimer);
  if (ms) view.bannerTimer = setTimeout(() => (el.className = 'tvBanner'), ms);
}

function viewerBuzz(view, ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function itemIcon(ent, now) {
  if (ent.rolling > 0) return ROULETTE[Math.floor(now / 90) % ROULETTE.length];
  if (ent.item) return ent.item === 'mushroom3' ? '🍄×' + ent.uses : ITEM_ICONS[ent.item];
  return '';
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
  track.animate(dt, Math.max(0, tRace), race.viewers[0]?.cam || camera);

  const inp = app.mode === 'tv' ? null : input.read();
  const ranks = rankings(race);
  let bestHuman = -Infinity;
  for (const r of ranks) if (!r.e.bot) bestHuman = Math.max(bestHuman, r.p);

  // Simulate the karts this device is responsible for.
  for (const ent of race.karts.values()) {
    const sim = ent.sim;
    if (!sim) continue;
    const view = race.viewerOf.get(ent.id); // someone is watching this kart on this screen
    const human = started ? humanControl(ent, inp) : null;
    let ctl;
    let corner = 0;
    if (!started) {
      ctl = { steer: 0, throttle: false, brake: false, drift: false };
    } else if (human) {
      ctl = human;
    } else {
      if (!ent.ai) ent.ai = new BotDriver(track, ent.seed);
      ctl = ent.ai.drive(sim, dt, ent.bot ? sim.progress - bestHuman : 0);
      corner = ctl.corner;
    }
    const others = [];
    for (const o of race.karts.values()) {
      if (o !== ent) others.push({ id: o.id, x: o.view.x, y: o.view.y || 0, z: o.view.z, star: !!o.view.st || ((o.view.md || 0) & 1) !== 0, rocket: ((o.view.md || 0) & 1) !== 0, ghost: ((o.view.md || 0) & 4) !== 0 });
    }
    sim.update(dt, ctl, others);

    if (view) {
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
    for (const ev of sim.events) {
      if (ev === 'fall') reportKo(ent.id, '', 'fall');
      else if (ev === 'hit' && sim.lastHitBy) {
        reportKo(ent.id, sim.lastHitBy, sim.lastHitWith);
        sim.lastHitBy = null;
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
          if (sim.starTime <= 0 && sim.hit()) {
            reportKo(ent.id, '', 'roller');
            if (view) {
              sfx.roller();
              sfx.hit();
              viewerBuzz(view, 120);
            }
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
          ent.pending = rollItem(ent.rank || race.karts.size, race.karts.size, !blueAllowed(race, now));
          if (view) sfx.pickup();
        }
      }
      if (ent.rolling > 0) {
        ent.rolling -= dt;
        if (ent.rolling <= 0) {
          ent.item = ent.pending;
          ent.uses = ent.item === 'mushroom3' || ent.item === 'boomerang' ? 3 : 1;
          ent.itemAge = 0;
          if (view) {
            sfx.itemReady();
            if (ITEM_TIPS[ent.item] && !tipsShown.has(ent.item)) showItemTip(ent.item);
            else if (THROWABLE.has(ent.item)) showItemTip('throw');
          }
        } else if (view && now - race.lastTick > 90) {
          race.lastTick = now;
          sfx.roulette();
        }
      }
      const wants = human ? human.useItem : ent.item && botWantsItem(ent, dt, corner, race);
      if (wants && ent.item && sim.spinTime <= 0 && (!sim.falling || ent.item === 'rocket')) useItem(ent, wants);

      // Bananas, shells, tornadoes and bombs
      const hz = sim.ghostTime > 0 ? null : race.hazards.collide(ent.id, sim.x, sim.y, sim.z, now);
      if (hz) {
        let hurt = false;
        if (hz.effect === 'spin') {
          if (!hz.keep) net.send({ t: 'e', type: 'hit', hid: hz.h.hid }); // boomerangs keep flying
          hurt = sim.hit();
        } else if (hz.effect === 'boom') {
          net.send({ t: 'e', type: 'boom', hid: hz.h.hid });
          race.hazards.explode(hz.h.hid);
        } else if (hz.effect === 'launch') {
          hurt = sim.blast(14);
          if (hurt && view) sfx.tornado();
        }
        if (hurt) reportKo(ent.id, hz.h.owner, hz.h.kind);
        if (hurt && view) {
          sfx.hit();
          viewerBuzz(view, 120);
        }
      }

      // Laps & finish
      if (!ent.finished) {
        const lap = lapOf(sim.progress, race.laps);
        if (view && lap > ent.lastLap) {
          viewerSay(view, lap === race.laps ? 'FINAL LAP!' : `LAP ${lap}`, 1600, 'lap');
          if (lap === race.laps) {
            if (!race.finalLapPlayed) sfx.finalLap();
            race.finalLapPlayed = true;
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
          if (view) {
            const place = ranks.findIndex((r) => r.e === ent) + 1;
            ent.place = place;
            viewerSay(view, `FINISH! ${place}${ordinal(place)}`, 0, 'finish');
            sfx.finish();
            if (race.viewers.every((v) => v.ent.finished)) sfx.stopMusic();
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
      k.push(packKart({
        ...ent.view,
        id: ent.id,
        ts: sNow,
        it: ent.rolling > 0 ? 99 : ent.item ? ITEM_LIST.indexOf(ent.item) + 1 : 0, // shown to others and on the TV
        u: ent.uses,
      }));
    }
    if (k.length) net.sendState({ t: 's', k });
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

  const booms = race.hazards.update(dt, now, (id) => {
    const e = race.karts.get(id);
    return e ? { x: e.view.x, y: e.view.y || 0, z: e.view.z, p: e.progress } : null;
  });
  for (const b of booms) {
    let d = 999;
    for (const v of race.viewers) d = Math.min(d, Math.hypot(v.ent.view.x - b.x, v.ent.view.z - b.z));
    sfx.boom(Math.max(0.15, 1 - d / 80));
    for (const ent of race.karts.values()) {
      const k = ent.sim;
      if (!k || !started) continue;
      const view = race.viewerOf.get(ent.id);
      if (Math.hypot(k.x - b.x, k.z - b.z, (k.y - b.y) * 0.5) < b.radius && k.blast(13)) {
        reportKo(ent.id, b.owner, b.kind);
        if (view) {
          sfx.hit();
          viewerBuzz(view, 200);
        }
      }
    }
  }
  race.boxes.update(dt, now);

  const time = now / 1000;
  for (const ent of race.karts.values()) poseKartMesh(ent.mesh, ent.view, time, dt);

  // HUDs and cameras for everyone watched on this screen
  for (const view of race.viewers) {
    const me = view.ent;
    const fin = race.finished.get(me.id);
    const lap = lapOf(me.progress, race.laps);
    const shown = me.finished ? me.finishTime : fin ? fin.time : Math.max(0, tRace);
    const icon = me.sim ? itemIcon(me, now) : remoteItemIcon(me.view, now);
    const rolling = me.sim ? me.rolling > 0 : me.view.it === 99;
    const h = view.hud;
    h.pos.textContent = me.rank;
    h.posSuffix.textContent = ordinal(me.rank);
    if (h.posOf) h.posOf.textContent = '/' + race.karts.size;
    h.lap.textContent = `Lap ${lap}/${race.laps}`;
    h.time.textContent = fmtTime(shown);
    if (h.itemIcon.textContent !== icon) h.itemIcon.textContent = icon;
    const kind = rolling ? null : me.sim ? me.item : ITEM_LIST[(me.view.it || 0) - 1];
    h.itemIcon.classList.toggle('blue', kind === 'blueshell');
    h.itemBox.classList.toggle('ready', !!icon && !rolling);
    if (app.mode === 'tv') tvAnnounce(view, lap, fin);
    updateChaseCamera(view, dt);
  }
  drawMinimap(race);
  const lead = race.viewers[0]?.ent;
  if (lead && lead.sim) {
    const k = lead.sim;
    sfx.kart({ on: true, speed: k.speed / MAX_SPEED, boost: k.boostTime > 0 || k.rocketTime > 0, drift: k.driftTier, drifting: !!k.driftDir, offroad: k.offroad, air: k.air });
  }
  // Power-up music while anyone on this screen has a star or rocket
  const done = (e) => e.finished || race.finished.has(e.id);
  const star = started && race.viewers.some((v) => !done(v.ent) && (v.ent.view.st || ((v.ent.view.md || 0) & 1)));
  if (star !== race.starMusic && !race.viewers.every((v) => done(v.ent))) {
    race.starMusic = star;
    sfx.music(star ? 'star' : race.song);
  }
}

// TV: each player's laps and finish come from their phone, so announce them here.
function tvAnnounce(view, lap, fin) {
  const race = app.race;
  if (lap > (view.lastLap || 1)) {
    view.lastLap = lap;
    viewerSay(view, lap === race.laps ? 'FINAL LAP!' : `LAP ${lap}`, 1600, 'lap');
    if (lap === race.laps) {
      if (!race.finalLapPlayed) sfx.finalLap();
      race.finalLapPlayed = true;
      sfx.setTempo(1.12);
    } else {
      sfx.lap();
    }
  }
  if (fin && !view.finShown) {
    view.finShown = true;
    viewerSay(view, `FINISH! ${fin.place}${ordinal(fin.place)}`, 0, 'finish');
    sfx.finish();
    if (race.viewers.every((v) => race.finished.has(v.ent.id))) sfx.stopMusic();
  }
}

function remoteItemIcon(v, now) {
  if (!v || !v.it) return '';
  if (v.it === 99) return ROULETTE[Math.floor(now / 90) % ROULETTE.length];
  const item = ITEM_LIST[v.it - 1];
  if (!item) return '';
  return item === 'mushroom3' ? '🍄×' + (v.u || 1) : ITEM_ICONS[item];
}

function updateChaseCamera(view, dt) {
  const v = view.ent.view;
  const cam = view.cam;
  const portrait = cam.aspect < 1;
  const fx = Math.sin(v.h);
  const fz = Math.cos(v.h);
  const md = v.md || 0;
  // Pull back for the rocket ride and the glider so you can see where you're going.
  const back = (portrait ? 8.5 : 7) + (md & 1 ? 1.5 : 0) + (md & 2 ? 2 : 0);
  const up = (portrait ? 4 : 3.2) + (md & 1 ? 1.2 : 0) + (md & 2 ? 1.5 : 0);
  // Follow height loosely, but don't dive into a gap after a falling kart.
  const ky = Math.max(v.y || 0, (v.gy ?? v.y ?? 0) - 1, -4);
  if (view.camY === null) view.camY = ky;
  view.camY += (ky - view.camY) * (1 - Math.exp(-dt * 5));
  const target = new THREE.Vector3(v.x - fx * back, view.camY + up + (v.hop || 0) * 0.4, v.z - fz * back);
  if (!view.camPos) view.camPos = target.clone();
  view.camPos.lerp(target, 1 - Math.exp(-dt * (md & 1 ? 16 : 7)));
  cam.position.copy(view.camPos);
  cam.lookAt(v.x + fx * 5, view.camY + 1.3, v.z + fz * 5);
  const baseFov = portrait ? 80 : 65;
  const speedFov = Math.min(16, Math.max(0, (v.s || 0) - MAX_SPEED * 0.8) * 0.6);
  const fov = baseFov + speedFov;
  if (Math.abs(cam.fov - fov) > 0.05) {
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
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
  const mine = (e) => race.viewerOf.has(e.id);
  const order = [...race.karts.values()].sort((a, b) => mine(a) - mine(b));
  for (const ent of order) {
    const [x, y] = miniMap(ent.view.x, ent.view.z);
    const me = mine(ent);
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
  if (app.race && app.mode === 'tv') {
    renderSplit(dt);
  } else {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    if (Math.abs(camera.aspect - aspect) > 0.001) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  }
}

// TV mode: draw the scene once per player into their part of the screen.
function renderSplit(dt) {
  const race = app.race;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  renderer.setScissorTest(true);
  const draw = (rect, cam) => {
    const [x, y, w, h] = rect;
    const px = Math.round(x * W);
    const py = Math.round((1 - y - h) * H); // WebGL counts from the bottom
    const pw = Math.round(w * W);
    const ph = Math.round(h * H);
    renderer.setViewport(px, py, pw, ph);
    renderer.setScissor(px, py, pw, ph);
    if (Math.abs(cam.aspect - pw / ph) > 0.001) {
      cam.aspect = pw / ph;
      cam.updateProjectionMatrix();
    }
    renderer.render(scene, cam);
  };
  for (const view of race.viewers) draw(view.rect, view.cam);
  if (race.overview) {
    updateIdleCamera(dt);
    draw(race.overview, camera);
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
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
