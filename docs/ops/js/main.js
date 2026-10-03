import * as THREE from 'three';
import { MAPS, MAP_IDS, getGrid } from './maps.js';
import { buildWorld } from './world.js';
import { Match } from './match.js';
import { Soldier } from './soldier.js';
import { ViewModel } from './viewmodel.js';
import { Fx } from './fx.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { sfx } from './audio.js';
import { Bot } from './bot.js';
import { WEAPONS, WEAPON_IDS } from './weapons.js';
import { LIMITS, COLORS, RESPAWN_MS } from './room.js';
import { hpAt, MAX_HP, wrapAngle } from './player.js';
import { aimTarget } from './combat.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AUTOPILOT = params.has('autopilot'); // test hook: a bot plays for you
const DEBUG = params.has('debug');
const FRIEND = '#3d8bff';
const ENEMY = '#ff4436';
const UNIFORM = { friend: '#3e5f8c', enemy: '#8c3e35', ffa: '#5e6a48' };

// ------------------------------------------------------------------ renderer

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200);
camera.rotation.order = 'YXZ';
const hemi = new THREE.HemisphereLight('#ffffff', '#888888', 1.5);
const sun = new THREE.DirectionalLight('#ffffff', 1.8);
scene.add(hemi, sun);
const viewModel = new ViewModel();
const fx = new Fx(scene);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  viewModel.resize(w / h);
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ app state

const net = new Net();
const input = new Input();
const app = {
  myId: null,
  room: null,
  mapId: null,
  world: null,
  match: null,
  soldiers: new Map(),
  profile: loadProfile(),
  settings: loadSettings(),
  boardOpen: false,
};

function loadProfile() {
  let p = {};
  try {
    p = JSON.parse(localStorage.getItem('po-profile') || '{}');
  } catch {}
  return {
    name: p.name || '',
    color: COLORS.includes(p.color) ? p.color : COLORS[Math.floor(Math.random() * COLORS.length)],
    weapon: WEAPON_IDS.includes(p.weapon) ? p.weapon : 'ar',
  };
}

function saveProfile() {
  app.profile.name = $('nameInput').value.trim().slice(0, 12) || 'Soldier';
  try {
    localStorage.setItem('po-profile', JSON.stringify(app.profile));
  } catch {}
}

function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem('po-settings') || '{}');
  } catch {}
  return { sens: typeof s.sens === 'number' ? s.sens : 1, autoFire: s.autoFire ?? true, assist: s.assist ?? true, invert: !!s.invert };
}

function saveSettings() {
  try {
    localStorage.setItem('po-settings', JSON.stringify(app.settings));
  } catch {}
}

function loadMap(id) {
  if (app.mapId === id) return;
  if (app.world) {
    scene.remove(app.world.group);
    app.world.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
  const def = MAPS[id];
  app.mapId = id;
  app.world = buildWorld(getGrid(id), def);
  scene.add(app.world.group);
  const th = def.theme;
  scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
  hemi.color.set(th.hemiSky);
  hemi.groundColor.set(th.hemiGround);
  hemi.intensity = th.hemi;
  sun.color.set(th.sun);
  sun.intensity = th.sunI;
  sun.position.set(...th.sunDir).multiplyScalar(100);
  buildMinimap(id);
}

// ------------------------------------------------------------------ screens & UI

const SCREENS = ['home', 'lobby', 'results'];
function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  $('hud').hidden = name !== 'match';
  document.body.classList.toggle('playing', name === 'match');
  input.setEnabled(name === 'match' && !app.boardOpen);
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
  el.innerHTML = text;
  el.className = 'show ' + cls;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => (el.className = ''), ms);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Home screen
const inviteCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
$('nameInput').value = app.profile.name;
const picker = $('colorPicker');
for (const c of COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = c;
  b.setAttribute('aria-label', 'Helmet color');
  b.onclick = () => {
    app.profile.color = c;
    renderPicker();
    saveProfile();
    if (app.room) net.send({ t: 'profile', color: c });
  };
  picker.appendChild(b);
}
function renderPicker() {
  [...picker.children].forEach((b, i) => b.classList.toggle('selected', COLORS[i] === app.profile.color));
}
renderPicker();

// Loadout pickers (home, lobby, and between lives)
function renderLoadouts() {
  for (const id of ['loadout', 'lobbyLoadout', 'deathLoadout']) {
    const el = $(id);
    const compact = el.classList.contains('compact');
    el.innerHTML = WEAPON_IDS.map((w) => {
      const W = WEAPONS[w];
      return `<button data-weapon="${w}" class="${w === app.profile.weapon ? 'selected' : ''}">
        <span class="wicon">${W.icon}</span><span class="wname">${W.name}</span>${compact ? '' : `<small>${W.blurb}</small>`}</button>`;
    }).join('');
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-weapon]');
  if (!b) return;
  app.profile.weapon = b.dataset.weapon;
  saveProfile();
  renderLoadouts();
  if (app.room) net.send({ t: 'loadout', weapon: app.profile.weapon });
  if (app.match) toast(`${WEAPONS[app.profile.weapon].name} next life`);
});
renderLoadouts();

// Control settings (on the home screen and in the in-match menu)
function bindSettings(suffix) {
  const sens = $('sensInput' + suffix);
  const auto = $('autoFireInput' + suffix);
  const assist = $('assistInput' + suffix);
  const inv = $('invertInput' + suffix);
  const sync = () => {
    sens.value = app.settings.sens;
    $('sensVal' + suffix).textContent = Number(app.settings.sens).toFixed(1);
    auto.checked = app.settings.autoFire;
    assist.checked = app.settings.assist;
    if (inv) inv.checked = app.settings.invert;
  };
  sens.oninput = () => {
    app.settings.sens = Number(sens.value);
    $('sensVal' + suffix).textContent = app.settings.sens.toFixed(1);
    saveSettings();
  };
  auto.onchange = () => ((app.settings.autoFire = auto.checked), saveSettings());
  assist.onchange = () => ((app.settings.assist = assist.checked), saveSettings());
  if (inv) inv.onchange = () => ((app.settings.invert = inv.checked), saveSettings());
  return sync;
}
const syncSettings = [bindSettings(''), bindSettings('2')];
syncSettings.forEach((f) => f());

if (inviteCode) {
  $('inviteNote').hidden = false;
  $('inviteCode').textContent = inviteCode;
  $('joinInviteBtn').hidden = false;
  $('createBtn').classList.remove('primary');
  $('createBtn').textContent = 'Create my own match';
  $('joinRow').hidden = true;
}

function connecting() {
  for (const id of ['createBtn', 'joinBtn', 'joinInviteBtn']) $(id).disabled = true;
  setTimeout(() => {
    for (const id of ['createBtn', 'joinBtn', 'joinInviteBtn']) $(id).disabled = false;
  }, 4000);
}

function joinMsg(t, code) {
  return { t, code, name: app.profile.name, color: app.profile.color, weapon: app.profile.weapon };
}

$('createBtn').onclick = () => {
  sfx.unlock();
  saveProfile();
  connecting();
  net.connect(joinMsg('create'));
};
function joinCode(code) {
  sfx.unlock();
  saveProfile();
  if (!/^[A-Z]{4}$/.test(code)) {
    toast('Enter the 4-letter match code');
    return;
  }
  connecting();
  net.connect(joinMsg('join', code));
}
$('joinInviteBtn').onclick = () => joinCode(inviteCode);
$('joinBtn').onclick = () => joinCode($('codeInput').value.toUpperCase().trim());
$('codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('joinBtn').click());

// Lobby
function pageUrl(code) {
  const q = new URLSearchParams();
  if (code) q.set('room', code);
  for (const keep of ['peerserver', 'autopilot', 'debug']) if (params.has(keep)) q.set(keep, params.get(keep));
  const search = q.toString().replace(/=(&|$)/g, '$1');
  return location.origin + location.pathname + (search ? '?' + search : '');
}
const inviteUrl = () => pageUrl(app.room.code);
const inviteText = () => `🎯 Squad up in Pocket Ops! Tap to join my match (${app.room.code}):`;
$('inviteBtn').onclick = async () => {
  sfx.unlock();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Pocket Ops', text: inviteText(), url: inviteUrl() });
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
$('resultsLeave').onclick = leaveRoom;
$('startBtn').onclick = () => {
  sfx.unlock();
  net.send({ t: 'startMatch' });
};
$('againBtn').onclick = () => net.send({ t: 'toLobby' });

document.querySelectorAll('[data-setting]').forEach((btn) => bindSettingBtn(btn));
function bindSettingBtn(btn) {
  btn.onclick = () => {
    const s = app.room.settings;
    const key = btn.dataset.setting;
    if (btn.dataset.delta) net.send({ t: 'settings', [key]: s[key] + Number(btn.dataset.delta) });
    else {
      const v = btn.dataset.value;
      net.send({ t: 'settings', [key]: /^\d+$/.test(v) ? Number(v) : v });
    }
  };
}

// Map cards with a little top-down preview of each map.
const mapPicker = $('mapPicker');
for (const id of MAP_IDS) {
  const b = document.createElement('button');
  b.className = 'mapCard';
  b.dataset.setting = 'map';
  b.dataset.value = id;
  const prev = document.createElement('canvas');
  drawMapImage(prev, getGrid(id), MAPS[id], 2);
  b.appendChild(prev);
  const t = document.createElement('div');
  t.innerHTML = `<b>${MAPS[id].name}</b><small>${MAPS[id].blurb}</small>`;
  b.appendChild(t);
  mapPicker.appendChild(b);
  bindSettingBtn(b);
}

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
        <span class="wtag">${WEAPONS[p.weapon]?.icon || ''}</span>
        ${p.id === room.hostId ? '<span class="badge">👑 host</span>' : ''}
        ${p.connected ? '' : '<span class="badge off">reconnecting…</span>'}
      </li>`
    )
    .join('');
  const s = room.settings;
  $('hostSettings').hidden = !isHost;
  $('guestSettings').hidden = isHost;
  $('botsVal').textContent = s.bots;
  $('limitSeg').innerHTML = LIMITS[s.mode].map((l) => `<button data-setting="limit" data-value="${l}">${l}</button>`).join('');
  $('limitSeg').querySelectorAll('button').forEach(bindSettingBtn);
  document.querySelectorAll('#lobby [data-setting][data-value]').forEach((b) => b.classList.toggle('selected', String(s[b.dataset.setting]) === b.dataset.value));
  const skill = ['', 'Recruit', 'Regular', 'Veteran'][s.skill];
  $('guestSettings').textContent = `${MAPS[s.map].name} · ${s.mode === 'tdm' ? 'Team Deathmatch' : 'Free-for-all'} · ${s.limit} to win · ${s.time} min · ${s.bots} ${skill} bot${s.bots === 1 ? '' : 's'}`;
  $('startBtn').hidden = !isHost;
  $('waitHost').hidden = isHost;
  $('soloHint').hidden = !(isHost && room.players.length === 1);
  loadMap(s.map);
}

function leaveRoom() {
  net.leave();
  endMatchLocal();
  app.room = null;
  app.myId = null;
  history.replaceState(null, '', pageUrl());
  show('home');
  $('inviteNote').hidden = true;
  $('joinInviteBtn').hidden = true;
  $('joinRow').hidden = false;
  $('createBtn').classList.add('primary');
  $('createBtn').textContent = 'Create match';
}

$('muteBtn').onclick = () => {
  sfx.unlock();
  sfx.setMuted(!sfx.muted);
  $('muteBtn').textContent = sfx.muted ? '🔇' : '🔊';
};
$('muteBtn').textContent = sfx.muted ? '🔇' : '🔊';
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

// Scoreboard / menu
function openBoard(menu) {
  app.boardOpen = true;
  $('board').hidden = false;
  $('menuExtras').hidden = !menu;
  $('endBtn').hidden = !(app.room && app.room.hostId === app.myId);
  syncSettings.forEach((f) => f());
  renderBoard();
  input.setEnabled(false);
}
function closeBoard() {
  app.boardOpen = false;
  $('board').hidden = true;
  if (app.match) input.setEnabled(true);
}
$('menuBtn').onclick = () => openBoard(true);
$('scoreTop').onclick = () => openBoard(false);
$('board').onclick = (e) => {
  if (e.target === $('board') || ($('menuExtras').hidden && !e.target.closest('button,input,label'))) closeBoard();
};
$('resumeBtn').onclick = closeBoard;
$('quitBtn').onclick = () => {
  closeBoard();
  leaveRoom();
};
$('endBtn').onclick = () => {
  closeBoard();
  net.send({ t: 'endMatch' });
};
window.addEventListener('keydown', (e) => {
  if (!app.match) return;
  if (e.key === 'Tab') {
    e.preventDefault();
    if (!app.boardOpen) openBoard(false);
  }
  if (e.key === 'Escape') (app.boardOpen ? closeBoard() : openBoard(true));
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Tab' && app.boardOpen && $('menuExtras').hidden) closeBoard();
});

function teamColor(e) {
  const m = app.match;
  if (!m || m.mode !== 'tdm') return e.color;
  return e.team === m.me?.team ? FRIEND : ENEMY;
}

function renderBoard() {
  const m = app.match;
  if (!m) return;
  const rows = m.list().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const groups = m.mode === 'tdm' ? [rows.filter((e) => e.team === m.me?.team), rows.filter((e) => e.team !== m.me?.team)] : [rows];
  $('boardTitle').textContent = m.mode === 'tdm' ? `Your team ${m.teamScore[m.me?.team ?? 0]} – ${m.teamScore[1 - (m.me?.team ?? 0)]} Enemy` : `First to ${m.limit} kills`;
  $('boardTable').innerHTML =
    '<tr><th></th><th>Name</th><th>K</th><th>D</th></tr>' +
    groups
      .map((g) =>
        g
          .map(
            (e) => `<tr class="${e.id === app.myId ? 'me' : ''}">
          <td><span class="dot" style="background:${teamColor(e)}"></span></td>
          <td>${escapeHtml(e.name)}${e.bot ? ' <em>BOT</em>' : ''}${e.away ? ' <em>away</em>' : ''}</td><td>${e.kills}</td><td>${e.deaths}</td></tr>`
          )
          .join('')
      )
      .join('<tr class="gap"><td colspan="4"></td></tr>');
}

// ------------------------------------------------------------------ network events

net.on('status', (s) => {
  $('conn').hidden = s === 'online' || !net.active;
  $('conn').textContent = s === 'searching' ? 'Looking for the match… (your friend needs the game open)' : 'Reconnecting…';
});

net.on('welcome', (msg) => {
  app.myId = msg.id;
  history.replaceState(null, '', pageUrl(msg.code));
});

net.on('error', (msg) => {
  if (msg.code === 'norejoin' && net.session) {
    const code = net.session.code;
    net.connect(joinMsg('join', code));
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
    if (app.match) endMatchLocal();
    show('lobby');
    renderLobby();
  }
  if (room.state === 'results') {
    $('againBtn').hidden = room.hostId !== app.myId;
    $('resultsWait').hidden = room.hostId === app.myId;
  }
});

net.on('start', (msg) => beginMatch(msg));
for (const t of ['s', 'fire', 'nade', 'dmg', 'kill', 'spawn', 'roster']) {
  net.on(t, (msg) => {
    if (!app.match) return;
    app.match.handle(msg);
    handleEvents();
  });
}

net.on('results', (msg) => {
  const m = app.match;
  const me = msg.board.find((b) => b.id === app.myId);
  let title = 'Match over';
  let sub = '';
  let won = false;
  if (msg.mode === 'tdm') {
    const my = me ? me.team : 0;
    if (msg.winner === -1) title = 'Draw';
    else won = msg.winner === my;
    if (msg.winner !== -1) title = won ? 'Victory!' : 'Defeat';
    sub = `Your team ${msg.teamScore[my]} – ${msg.teamScore[1 - my]} Enemy`;
  } else {
    const place = msg.board.findIndex((b) => b.id === app.myId) + 1;
    won = msg.winner === app.myId;
    title = won ? 'You win!' : place ? `You placed #${place}` : 'Match over';
    sub = msg.board[0] ? `${escapeHtml(msg.board[0].name)} led with ${msg.board[0].kills} kills` : '';
  }
  if (won) sfx.win();
  else sfx.lose();
  $('resultTitle').textContent = title;
  $('resultSub').innerHTML = sub;
  const myTeam = me ? me.team : 0;
  $('resultTable').innerHTML =
    '<tr><th>#</th><th>Name</th><th>K</th><th>D</th></tr>' +
    msg.board
      .map((b, i) => {
        const color = msg.mode === 'tdm' ? (b.team === myTeam ? FRIEND : ENEMY) : b.color;
        return `<tr class="${b.id === app.myId ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${color}"></span>${escapeHtml(b.name)}${b.bot ? ' <em>BOT</em>' : ''}</td><td>${b.kills}</td><td>${b.deaths}</td></tr>`;
      })
      .join('');
  const isHost = app.room && app.room.hostId === app.myId;
  $('againBtn').hidden = !isHost;
  $('resultsWait').hidden = isHost;
  if (m) m.over = true;
  closeBoard();
  show('results');
});

// ------------------------------------------------------------------ match setup

const hud = {
  feed: [],
  hitT: 0,
  hitKill: false,
  shake: 0,
  camY: null,
  lastCount: null,
  goShown: false,
  stepT: 0,
  heartT: 0,
  uavUntil: 0,
  prevYaw: 0,
  prevPitch: 0,
  prevAds: false,
  dryT: 0,
};

function beginMatch(msg) {
  endMatchLocal();
  loadMap(msg.map);
  const isHost = app.room ? app.room.hostId === app.myId : false;
  const m = new Match(msg, { myId: app.myId, isHost, send: (x) => net.send(x), now: () => net.serverNow() });
  app.match = m;
  for (const e of m.list()) addSoldier(e);
  const me = m.me;
  if (me) {
    if (AUTOPILOT) me.ai = new Bot(m.grid, me.id, 2, 99);
    viewModel.setWeapon(me.weapon, me.team === undefined || m.mode !== 'tdm' ? UNIFORM.ffa : UNIFORM.friend);
  }
  Object.assign(hud, { feed: [], hitT: 0, shake: 0, camY: null, lastCount: null, goShown: false, uavUntil: 0 });
  $('killfeed').innerHTML = '';
  $('dmgDirs').innerHTML = '';
  $('deathScreen').hidden = !me || me.alive;
  $('scoreTop').classList.toggle('ffa', m.mode === 'ffa');
  input.read(0); // drop any queued presses
  show('match');
  requestWakeLock();
}

function addSoldier(e) {
  if (e.id === app.myId || app.soldiers.has(e.id)) return;
  const m = app.match;
  const friendly = m.mode === 'tdm' && e.team === m.me?.team;
  const uniform = m.mode === 'tdm' ? (friendly ? UNIFORM.friend : UNIFORM.enemy) : UNIFORM.ffa;
  const s = new Soldier(uniform, e.color);
  if (friendly) s.setLabel(e.name, '#9cc7ff');
  scene.add(s.root);
  s.root.visible = e.alive;
  if (!e.alive) s.deadT = 99;
  app.soldiers.set(e.id, s);
}

function removeSoldier(id) {
  const s = app.soldiers.get(id);
  if (!s) return;
  s.dispose(scene);
  app.soldiers.delete(id);
}

function endMatchLocal() {
  if (!app.match) return;
  for (const id of [...app.soldiers.keys()]) removeSoldier(id);
  fx.clear();
  app.match = null;
  closeBoard();
  $('deathScreen').hidden = true;
  $('scope').hidden = true;
  releaseWakeLock();
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {}
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.match && (!wakeLock || wakeLock.released)) requestWakeLock();
});

// ------------------------------------------------------------------ match events → effects, sounds, HUD

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function distTo(x, y, z) {
  return camera.position.distanceTo(tmpB.set(x, y, z));
}

// Where your own bullets appear to leave the gun.
function myMuzzle(out) {
  out.set(0.18, -0.16, -0.7).applyQuaternion(camera.quaternion).add(camera.position);
  if ((app.match?.me?.wpn?.adsT || 0) > 0.5) out.set(0, -0.08, -0.7).applyQuaternion(camera.quaternion).add(camera.position);
  return out;
}

function impactFor(r) {
  if (r.ent) fx.blood(r.x, r.y, r.z);
  else if (r.t < 150) fx.impact(r.x, r.y, r.z, r.nx, r.ny, r.nz);
}

function handleEvents() {
  const m = app.match;
  if (!m) return;
  const now = net.serverNow();
  for (const ev of m.events) {
    switch (ev.type) {
      case 'shot': {
        const mine = ev.ent.id === app.myId;
        const sol = app.soldiers.get(ev.ent.id);
        if (mine) {
          viewModel.fire();
          sfx.gun(ev.w.id, 0);
          hud.shake = Math.max(hud.shake, ev.w.recoil * 2);
          myMuzzle(tmpA);
        } else {
          sol?.muzzle();
          if (sol) sol.muzzleWorld(tmpA);
          else tmpA.set(ev.ent.view.x, ev.ent.view.y + 1.4, ev.ent.view.z);
          sfx.gun(ev.w.id, distTo(tmpA.x, tmpA.y, tmpA.z));
        }
        ev.rays.forEach((r, i) => {
          if (i < 3) fx.tracer(tmpA, tmpB.set(r.x, r.y, r.z));
          impactFor(r);
        });
        break;
      }
      case 'remoteShot': {
        const sol = app.soldiers.get(ev.ent.id);
        sol?.muzzle();
        if (sol) sol.muzzleWorld(tmpA);
        else tmpA.set(ev.ent.view.x, ev.ent.view.y + 1.4, ev.ent.view.z);
        sfx.gun(ev.w, distTo(tmpA.x, tmpA.y, tmpA.z));
        tmpB.set(ev.hx, ev.hy, ev.hz);
        fx.tracer(tmpA, tmpB);
        const back = tmpA.clone().sub(tmpB).normalize();
        if (ev.hit) fx.blood(ev.hx, ev.hy, ev.hz);
        else if (tmpA.distanceTo(tmpB) < 150) fx.impact(ev.hx, ev.hy, ev.hz, back.x, back.y, back.z);
        break;
      }
      case 'hitmarker':
        hud.hitT = 0.25;
        hud.hitKill = false;
        $('hitmarker').classList.toggle('head', !!ev.head);
        sfx.hitmarker(ev.head);
        break;
      case 'hurt': {
        sfx.hurt();
        navigator.vibrate?.(60);
        $('hurtFlash').classList.remove('on');
        void $('hurtFlash').offsetWidth;
        $('hurtFlash').classList.add('on');
        if (ev.by && ev.by.id !== app.myId) damageIndicator(ev.by);
        break;
      }
      case 'kill':
        onKill(ev, now);
        break;
      case 'spawn': {
        if (ev.ent.id === app.myId) {
          $('deathScreen').hidden = true;
          viewModel.setWeapon(ev.ent.weapon, m.mode === 'tdm' ? UNIFORM.friend : UNIFORM.ffa);
          hud.camY = null;
          input.crouch = false;
          input.ads = false;
          sfx.spawn();
        } else {
          app.soldiers.get(ev.ent.id)?.revive();
        }
        break;
      }
      case 'nade':
        fx.addNade(ev.g);
        if (ev.mine) sfx.pin();
        break;
      case 'bounce':
        sfx.bounce(distTo(ev.g.x, ev.g.y, ev.g.z));
        break;
      case 'boom': {
        const d = distTo(ev.g.x, ev.g.y, ev.g.z);
        fx.explosion(ev.g.x, ev.g.y, ev.g.z);
        sfx.boom(d);
        hud.shake = Math.max(hud.shake, Math.max(0, 0.12 - d * 0.006));
        break;
      }
      case 'reload':
        if (ev.mine) sfx.reload();
        break;
      case 'reloaded':
        sfx.reloaded();
        break;
      case 'dry':
        if (now - hud.dryT > 250) {
          hud.dryT = now;
          sfx.dry();
        }
        break;
      case 'jump':
        sfx.jump();
        break;
      case 'land':
        sfx.land();
        break;
      case 'joined':
        addSoldier(ev.ent);
        if (!ev.ent.bot) toast(`${ev.ent.name} joined the fight`);
        break;
      case 'left':
        removeSoldier(ev.ent.id);
        if (!ev.ent.bot) toast(`${ev.ent.name} left`);
        break;
    }
  }
  m.events.length = 0;
  if (app.boardOpen) renderBoard();
}

function onKill(ev, now) {
  const m = app.match;
  const { killer, victim } = ev;
  // Kill feed
  const row = document.createElement('div');
  const name = (e) => (e ? `<b style="color:${e.id === app.myId ? '#ffe066' : teamColor(e)}">${escapeHtml(e.name)}</b>` : '?');
  const icon = ev.w === 'nade' ? '💣' : WEAPONS[ev.w]?.icon || '🔫';
  row.innerHTML = killer === victim ? `${name(victim)} <span>💀</span>` : `${name(killer)} <span>${icon}${ev.head ? '🎯' : ''}</span> ${name(victim)}`;
  $('killfeed').prepend(row);
  hud.feed.push({ el: row, t: now });
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();

  if (victim) {
    const s = app.soldiers.get(victim.id);
    s?.die();
  }
  if (killer && killer.id === app.myId && victim && victim.id !== app.myId) {
    hud.hitT = 0.35;
    hud.hitKill = true;
    sfx.killConfirm();
    banner(`<small>${ev.head ? 'HEADSHOT' : 'ELIMINATED'}</small>${escapeHtml(victim.name)}`, 1300, 'kill');
  }
  // Kill streak rewards: a UAV shows every enemy on the radar for a while.
  if (killer && ev.streak === 3 && (killer.id === app.myId || (m.mode === 'tdm' && killer.team === m.me?.team))) {
    hud.uavUntil = now + 20000;
    if (killer.id === app.myId) {
      banner('<small>3 KILL STREAK</small>UAV ONLINE', 2000, 'streak');
      sfx.streak();
    } else toast(`${killer.name}'s UAV is online`);
  } else if (killer && killer.id === app.myId && ev.streak >= 5 && ev.streak % 5 === 0) {
    banner(`<small>KILL STREAK</small>${ev.streak} IN A ROW`, 2000, 'streak');
    sfx.streak();
  }
  if (victim && victim.id === app.myId) {
    sfx.die();
    navigator.vibrate?.(200);
    input.release();
    $('deathScreen').hidden = false;
    $('killedBy').innerHTML = killer && killer !== victim ? `Killed by ${name(killer)} ${ev.head ? '🎯' : ''}` : 'You blew yourself up 💣';
    renderLoadouts();
    hud.deathAt = now;
  }
}

function damageIndicator(from) {
  const el = document.createElement('div');
  el.className = 'dmgDir';
  el.dataset.x = from.view.x;
  el.dataset.z = from.view.z;
  $('dmgDirs').appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// ------------------------------------------------------------------ minimap

let mapImage = null;
let mapScale = 4;
function drawMapImage(cv, grid, def, scale) {
  cv.width = grid.w * scale;
  cv.height = grid.d * scale;
  const ctx = cv.getContext('2d');
  for (let z = 0; z < grid.d; z++) {
    for (let x = 0; x < grid.w; x++) {
      const i = z * grid.w + x;
      const h = grid.vis[i];
      let c;
      if (h < -0.1) c = '#2c5d7a';
      else if (h <= 0.01) c = '#c9c2b0';
      else if (h < 1.3) c = '#8d867a';
      else if (h <= 3.1) c = '#6b655c';
      else c = '#3a3631';
      ctx.fillStyle = c;
      ctx.fillRect(x * scale, z * scale, scale, scale);
    }
  }
  return cv;
}
function buildMinimap(id) {
  mapImage = drawMapImage(document.createElement('canvas'), getGrid(id), MAPS[id], mapScale);
}

function drawMinimap(m, me, now) {
  const cv = $('minimap');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const S = 2.6; // pixels per meter
  ctx.clearRect(0, 0, W, W);
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(20,24,28,0.75)';
  ctx.fillRect(0, 0, W, W);
  const v = me.alive && me.sim ? me.sim : me.view;
  const yaw = me.alive && me.sim ? me.sim.yaw : 0;
  ctx.translate(W / 2, W / 2);
  ctx.rotate(yaw);
  ctx.translate(-v.x * S, -v.z * S);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(mapImage, 0, 0, mapImage.width * (S / mapScale), mapImage.height * (S / mapScale));
  ctx.globalAlpha = 1;
  const uav = now < hud.uavUntil;
  for (const e of m.list()) {
    if (e.id === app.myId || !e.alive) continue;
    const friendly = m.mode === 'tdm' && e.team === me.team;
    const loud = now - e.lastFired < 1800;
    if (!friendly && !loud && !uav) continue;
    ctx.beginPath();
    ctx.arc(e.view.x * S, e.view.z * S, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = friendly ? FRIEND : ENEMY;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
  }
  ctx.restore();
  // You, always pointing up
  ctx.save();
  ctx.translate(W / 2, W / 2);
  ctx.fillStyle = '#ffe066';
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(6, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = uav ? '#ff4436' : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
  ctx.stroke();
}

// ------------------------------------------------------------------ the match loop

function updateMatch(dt, now) {
  const m = app.match;
  const sNow = net.serverNow();
  const me = m.me;
  const started = sNow >= m.startAt;

  // Countdown
  if (!started) {
    const n = Math.ceil((m.startAt - sNow) / 1000);
    if (n <= 3 && n !== hud.lastCount) {
      hud.lastCount = n;
      banner(String(n), 0, 'count');
      sfx.count();
    }
  } else if (!hud.goShown) {
    hud.goShown = true;
    banner(m.mode === 'tdm' ? 'TEAM DEATHMATCH' : 'FREE-FOR-ALL', 1400, 'go');
    sfx.go();
  }

  const w = me?.wpn?.w;
  const zoom = me?.wpn ? 1 - (1 - w.adsFov) * me.wpn.adsT : 1;
  const inp = input.read(dt, app.settings.sens, zoom);
  let ctl = {};
  if (me && me.alive && me.sim) {
    const sim = me.sim;
    let tx = inp.turnX;
    let ty = inp.turnY * (app.settings.invert ? -1 : 1);
    const useAssist = app.settings.assist && input.usedTouch && started;
    const assist = useAssist ? m.assistTarget(me, 0.16) : null;
    // Aim assist: aim slows down over enemies, and aiming down sights pulls toward a nearby one.
    if (assist) {
      const close = 1 - assist.angle / 0.16;
      tx *= 1 - 0.4 * close;
      ty *= 1 - 0.4 * close;
    }
    sim.yaw = wrapAngle(sim.yaw - tx);
    sim.pitch = Math.max(-1.45, Math.min(1.45, sim.pitch - ty));
    if (inp.ads && !hud.prevAds && useAssist) {
      const t = m.assistTarget(me, 0.3);
      if (t) {
        sim.yaw += wrapAngle(t.yaw - sim.yaw) * 0.7;
        sim.pitch += (t.pitch - sim.pitch) * 0.7;
      }
    }
    hud.prevAds = inp.ads;

    // What's under the crosshair: show the enemy's name, and fire automatically if enabled.
    const eye = [sim.x, sim.eye(), sim.z];
    const under = aimTarget(m.grid, m.list(), me, m.mode, eye, sim.yaw, sim.pitch, 120);
    const inRange = under && under.t <= w.autoRange && (!w.adsOnlyAuto || me.wpn.adsT > 0.85);
    const auto = app.settings.autoFire && input.usedTouch && inRange && started && sNow > (me.protectUntil || 0) - 1000;
    $('aimName').textContent = under ? under.ent.name : '';
    $('crosshair').classList.toggle('enemy', !!under);
    const fire = inp.fire || !!auto;
    ctl = { ...inp, fire, sprint: inp.sprint && !fire };
    if (AUTOPILOT && me.ai) {
      ctl = me.ai.think(dt, sim, me.wpn, { ents: m.list(), mode: m.mode, team: me.team });
    }
  } else {
    $('aimName').textContent = '';
  }
  m.update(dt, ctl);
  handleEvents();

  // Others
  const time = now / 1000;
  for (const [id, s] of app.soldiers) {
    const e = m.ents.get(id);
    if (!e) continue;
    if (e.alive && s.deadT >= 0 && s.deadT > 50) s.revive();
    s.pose(e.view, dt);
    // Footsteps of nearby soldiers
    if (e.alive && e.view.mv > 2.5 && e.view.gr) {
      e.stepT = (e.stepT || 0) + dt;
      if (e.stepT > 0.4) {
        e.stepT = 0;
        const d = distTo(e.view.x, e.view.y, e.view.z);
        if (d < 16) sfx.footstep(0.1 * (1 - d / 16));
      }
    }
  }
  fx.update(dt);
  app.world.update(dt, time);

  updateCamera(me, dt, sNow);
  updateHud(me, dt, sNow);
}

function updateCamera(me, dt, sNow) {
  const m = app.match;
  const portrait = camera.aspect < 1;
  const baseFov = portrait ? 88 : 72;
  if (me && me.alive && me.sim) {
    const sim = me.sim;
    const target = sim.eye();
    if (hud.camY === null || Math.abs(target - hud.camY) > 0.8) hud.camY = target;
    hud.camY += (target - hud.camY) * Math.min(1, dt * 18);
    camera.position.set(sim.x, hud.camY, sim.z);
    const shake = hud.shake;
    hud.shake = Math.max(0, hud.shake - dt * 0.6);
    camera.rotation.set(sim.pitch + (Math.random() - 0.5) * shake, sim.yaw + (Math.random() - 0.5) * shake, 0);
    const wpn = me.wpn;
    const fov = baseFov * (1 - (1 - wpn.w.adsFov) * wpn.adsT);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    const dyaw = wrapAngle(sim.yaw - hud.prevYaw) / Math.max(dt, 0.001);
    const dpitch = (sim.pitch - hud.prevPitch) / Math.max(dt, 0.001);
    hud.prevYaw = sim.yaw;
    hud.prevPitch = sim.pitch;
    const scoped = wpn.w.scope && wpn.adsT > 0.85;
    viewModel.update(dt, {
      ads: wpn.adsT,
      kick: wpn.kick,
      reload: wpn.reloading > 0 ? 1 - wpn.reloading / wpn.w.reload : -1,
      sprint: sim.sprinting,
      speed: sim.ground ? sim.speed : 0,
      dyaw: Math.max(-3, Math.min(3, dyaw * 0.1)),
      dpitch: Math.max(-3, Math.min(3, dpitch * 0.1)),
      scoped,
    });
    $('scope').hidden = !scoped;
    // My footsteps
    if (sim.ground && sim.speed > 1.5) {
      hud.stepT += dt;
      if (hud.stepT > (sim.sprinting ? 0.29 : 0.4)) {
        hud.stepT = 0;
        sfx.footstep(sim.crouch > 0.5 ? 0.04 : 0.09);
      }
    }
  } else if (me) {
    // Death cam: rise up and look at whoever got you.
    const v = me.view;
    const killer = m.ents.get(me.killedBy);
    const look = killer && killer !== me ? killer.view : v;
    const t = Math.min(1, (sNow - (me.diedAt || sNow)) / 1200);
    tmpA.set(v.x, v.y + 1.6 + t * 2.5, v.z);
    camera.position.lerp(tmpA, Math.min(1, dt * 3));
    camera.lookAt(look.x, look.y + 1.2, look.z);
    if (camera.fov !== baseFov) {
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
    }
    $('scope').hidden = true;
  }
}

function updateHud(me, dt, sNow) {
  const m = app.match;
  // Score and clock
  if (m.mode === 'tdm') {
    const my = me ? me.team : 0;
    $('scoreA').textContent = m.teamScore[my];
    $('scoreB').textContent = m.teamScore[1 - my];
  } else {
    const sorted = m.list().sort((a, b) => b.kills - a.kills);
    const mine = me ? me.kills : 0;
    const best = sorted.find((e) => e.id !== app.myId);
    $('scoreA').textContent = mine;
    $('scoreB').textContent = best ? best.kills : 0;
  }
  $('clock').textContent = fmtClock(sNow < m.startAt ? m.endAt - m.startAt : m.endAt - sNow);

  if (!me) return;
  if (hud.dead !== !me.alive) {
    hud.dead = !me.alive;
    $('controls').classList.toggle('dead', hud.dead);
  }
  const hp = me.alive ? hpAt(me.hp ?? MAX_HP, me.lastHit ?? 0, sNow) : 0;
  $('hpBar').style.width = `${hp}%`;
  $('hpBar').classList.toggle('low', hp < 40);
  $('vignette').style.opacity = me.alive ? Math.pow(1 - hp / MAX_HP, 1.6) * 0.95 : 0;
  if (me.alive && hp < 35) {
    hud.heartT -= dt;
    if (hud.heartT <= 0) {
      hud.heartT = 0.9;
      sfx.heartbeat();
    }
  }
  const wpn = me.wpn;
  if (wpn) {
    $('ammoNow').textContent = wpn.reloading > 0 ? '…' : wpn.ammo;
    $('ammoMax').textContent = '/' + wpn.w.mag;
    $('wpnName').textContent = wpn.w.name;
    $('ammo').classList.toggle('low', wpn.ammo <= Math.ceil(wpn.w.mag * 0.25));
    $('nadeCount').textContent = wpn.nades;
    $('btnNade').classList.toggle('empty', wpn.nades <= 0);
    const hint = $('hintCenter');
    const text = !me.alive ? '' : wpn.reloading > 0 ? 'Reloading…' : wpn.ammo === 0 ? 'Tap ↻ to reload' : sNow < (me.protectUntil || 0) ? 'Spawn protection' : '';
    if (hint.textContent !== text) hint.textContent = text;
    // Crosshair spreads with inaccuracy and hides when aiming down sights.
    const spreadPx = (Math.tan(wpn.spread()) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (window.innerHeight / 2);
    const ch = $('crosshair');
    ch.style.setProperty('--gap', `${Math.max(5, Math.min(70, spreadPx))}px`);
    ch.style.opacity = me.alive ? Math.max(0, 1 - wpn.adsT * 1.6) : 0;
  }
  hud.hitT = Math.max(0, hud.hitT - dt);
  const hm = $('hitmarker');
  hm.style.opacity = hud.hitT > 0 ? Math.min(1, hud.hitT * 6) : 0;
  hm.classList.toggle('kill', hud.hitKill);

  // Damage direction arrows point at whoever is shooting you.
  const yaw = me.sim ? me.sim.yaw : 0;
  for (const el of $('dmgDirs').children) {
    const dx = Number(el.dataset.x) - me.view.x;
    const dz = Number(el.dataset.z) - me.view.z;
    const ang = wrapAngle(Math.atan2(-dx, -dz) - yaw);
    el.style.transform = `translate(-50%, -50%) rotate(${-ang}rad)`;
  }
  // Kill feed fades
  hud.feed = hud.feed.filter((f) => {
    if (sNow - f.t > 6000) {
      f.el.remove();
      return false;
    }
    return true;
  });

  if (!me.alive && !$('deathScreen').hidden) {
    const left = (me.diedAt || sNow) + RESPAWN_MS - sNow;
    $('respawnIn').textContent = me.away ? 'Rejoining…' : left > 0 ? `Respawning in ${Math.ceil(left / 1000)}…` : 'Respawning…';
  }
  drawMinimap(m, me, sNow);
  if (DEBUG) {
    debugFrames++;
    if (sNow - debugT > 500) {
      const fps = (debugFrames * 1000) / (sNow - debugT);
      const ping = net.samples.length ? Math.min(...net.samples.map((s) => s.rtt)) : 0;
      const v = me.sim || me.view;
      $('debug').textContent = `${fps.toFixed(0)} fps · ${ping.toFixed(0)} ms · ${renderer.info.render.calls} draws · ${m.ents.size} soldiers · ${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)} · px ${pixelRatio}`;
      debugFrames = 0;
      debugT = sNow;
    }
  }
}
let debugFrames = 0;
let debugT = 0;
$('debug').hidden = !DEBUG;

// Slow orbit around the map behind the menus.
let idleT = 0;
function updateIdleCamera(dt) {
  if (!app.world) return;
  idleT += dt * 0.08;
  const g = getGrid(app.mapId);
  const cx = g.w / 2;
  const cz = g.d / 2;
  const r = Math.max(g.w, g.d) * 0.75;
  camera.position.set(cx + Math.cos(idleT) * r, 26, cz + Math.sin(idleT) * r);
  camera.lookAt(cx, 0, cz);
  if (camera.fov !== 60) {
    camera.fov = 60;
    camera.updateProjectionMatrix();
  }
  app.world.update(dt, performance.now() / 1000);
}

// ------------------------------------------------------------------ main loop

let last = performance.now();
let slowFrames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  // Drop resolution on phones that struggle to keep up.
  if (app.match && now - last > 24) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 0.5);
  if (slowFrames > 80 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio);
    resize();
    slowFrames = 0;
  }
  last = now;
  if (app.match && !app.match.over) {
    // Long frames are split into small steps so movement and bots behave the same at any frame rate.
    const steps = Math.ceil(dt / 0.034);
    for (let i = 0; i < steps && app.match; i++) updateMatch(dt / steps, now);
  } else if (!app.match) {
    updateIdleCamera(dt);
  }
  renderer.clear();
  renderer.render(scene, camera);
  if (app.match && app.match.me?.alive && !app.match.over) {
    renderer.clearDepth();
    renderer.render(viewModel.scene, viewModel.camera);
  }
}

// ------------------------------------------------------------------ boot

loadMap('dust');
show('home');
let saved = null;
try {
  saved = JSON.parse(sessionStorage.getItem('po-session') || 'null');
} catch {}
if (saved && inviteCode && saved.code === inviteCode) {
  // Page was reloaded while in a match: take our seat back.
  net.resume(saved);
}
requestAnimationFrame(frame);

// Handy for debugging from the browser console.
window.pocketOps = { app, net, input, scene, camera, renderer };
