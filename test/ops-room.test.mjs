// Pocket Ops: the match room that runs on the host's phone.
import test, { mock } from 'node:test';
import assert from 'node:assert';
import { Room, makeCode, PROTECT_MS } from '../docs/ops/js/room.js';

function conn(room) {
  const c = {
    inbox: [],
    send(m) {
      c.inbox.push(JSON.parse(JSON.stringify(m)));
    },
    close() {
      c.closed = true;
    },
    say(m) {
      room.handle(c, m);
    },
    all(t) {
      return c.inbox.filter((m) => m.t === t);
    },
    last(t) {
      return [...c.inbox].reverse().find((m) => m.t === t);
    },
  };
  room.attach(c);
  return c;
}

function setup(settings = {}) {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  const room = new Room('ABCD', { random: () => 0.3 });
  const host = conn(room);
  const guest = conn(room);
  host.say({ t: 'create', name: 'Andrew', color: '#e53935', weapon: 'smg' });
  guest.say({ t: 'join', code: 'abcd', name: 'Sam', color: '#e53935', weapon: 'nope' });
  host.say({ t: 'settings', bots: 0, ...settings });
  const hid = host.last('welcome').id;
  const gid = guest.last('welcome').id;
  return { room, host, guest, hid, gid };
}

test.afterEach(() => mock.timers.reset());

test('match codes are 4 easy-to-read letters', () => {
  for (let i = 0; i < 50; i++) assert.match(makeCode(), /^[A-HJ-NP-Z]{4}$/);
});

test('lobby: names, colors, loadouts and host-only settings', () => {
  const { room, host, guest, gid } = setup();
  const info = host.last('room');
  const sam = info.players.find((p) => p.id === gid);
  assert.notStrictEqual(sam.color, '#e53935', 'duplicate colors are reassigned');
  assert.strictEqual(sam.weapon, 'ar', 'unknown weapons fall back to the rifle');
  guest.say({ t: 'settings', map: 'docks' });
  guest.say({ t: 'startMatch' });
  assert.strictEqual(room.state, 'lobby');
  host.say({ t: 'settings', map: 'docks', mode: 'ffa' });
  assert.strictEqual(room.settings.limit, 20, 'switching mode resets the score limit');
  host.say({ t: 'settings', limit: 30, time: 3, skill: 9, bots: 40 });
  assert.deepStrictEqual(guest.last('room').settings, { map: 'docks', mode: 'ffa', bots: 9, skill: 3, limit: 30, time: 3 });
  host.say({ t: 'settings', limit: 55 });
  assert.strictEqual(room.settings.limit, 30, 'only listed limits are allowed');
  guest.say({ t: 'loadout', weapon: 'sniper' });
  assert.strictEqual(host.last('room').players.find((p) => p.id === gid).weapon, 'sniper');
});

test('team deathmatch: teams, damage, kills, respawns and winning', () => {
  const { room, host, guest, hid, gid } = setup({ mode: 'tdm', bots: 2 });
  host.say({ t: 'startMatch' });
  const start = guest.last('start');
  assert.strictEqual(start.ents.length, 4);
  const teams = start.ents.map((e) => e.team);
  assert.deepStrictEqual([teams.filter((t) => t === 0).length, teams.filter((t) => t === 1).length], [2, 2], 'teams are even');
  for (const e of start.ents) assert.ok(e.alive && Number.isFinite(e.x) && Number.isFinite(e.z));
  const me = start.ents.find((e) => e.id === hid);
  const sam = start.ents.find((e) => e.id === gid);
  const enemyOfHost = start.ents.find((e) => e.team !== me.team && !e.id.startsWith('p'));
  const mate = start.ents.find((e) => e.team === me.team && e.id !== hid);

  // Nothing counts before the countdown ends.
  host.say({ t: 'hit', id: hid, target: enemyOfHost.id, dmg: 50, head: false, w: 'ar' });
  assert.strictEqual(host.all('dmg').length, 0);
  mock.timers.tick(start.startAt - Date.now() + PROTECT_MS + 10);

  // Friendly fire is off, and you can't shoot for someone else.
  host.say({ t: 'hit', id: hid, target: mate.id, dmg: 50, w: 'ar' });
  guest.say({ t: 'hit', id: hid, target: enemyOfHost.id, dmg: 50, w: 'ar' });
  assert.strictEqual(host.all('dmg').length, 0);

  // The host's phone shoots for the bots too. Damage is capped per hit.
  host.say({ t: 'hit', id: hid, target: enemyOfHost.id, dmg: 60, w: 'ar' });
  assert.strictEqual(host.last('dmg').hp, 40);
  host.say({ t: 'hit', id: hid, target: enemyOfHost.id, dmg: 1e9, head: true, w: 'ar' });
  const kill = guest.last('kill');
  assert.strictEqual(kill.killer, hid);
  assert.strictEqual(kill.victim, enemyOfHost.id);
  assert.ok(kill.head);
  assert.strictEqual(kill.teamScore[me.team], 1);
  // Dead soldiers can't be hit again, and come back after the respawn delay.
  host.say({ t: 'hit', id: hid, target: enemyOfHost.id, dmg: 10, w: 'ar' });
  assert.strictEqual(guest.all('kill').length, 1);
  mock.timers.tick(3001);
  const sp = guest.last('spawn');
  assert.strictEqual(sp.id, enemyOfHost.id);
  assert.ok(sp.alive && sp.life === 2 && sp.hp === 100);

  // Health comes back after a few seconds without being hit.
  if (sam.team !== me.team) {
    host.say({ t: 'hit', id: hid, target: gid, dmg: 70, w: 'ar' });
    mock.timers.tick(6000);
    host.say({ t: 'hit', id: hid, target: gid, dmg: 70, w: 'ar' });
    assert.ok(guest.last('dmg').hp > 0, 'regenerated before the second hit');
  }

  // Grenades can hurt their thrower: that's a death but not a kill.
  host.say({ t: 'hit', id: hid, target: hid, dmg: 100, w: 'nade' });
  const self = guest.last('kill');
  assert.strictEqual(self.victim, hid);
  assert.strictEqual(self.killer, hid);
  assert.strictEqual(room.match.ents.get(hid).kills, 1);

  // First team to the limit wins.
  room.match.teamScore[me.team] = room.match.limit - 1;
  mock.timers.tick(5000);
  const victim = [...room.match.ents.values()].find((e) => e.team !== me.team && e.alive);
  mock.timers.tick(PROTECT_MS);
  room.match.ents.get(hid).alive = true;
  host.say({ t: 'hit', id: hid, target: victim.id, dmg: 200, w: 'sniper' });
  const res = host.last('results'); // (the quiet guest timed out by now)
  assert.ok(res, 'match ended');
  assert.strictEqual(res.winner, me.team);
  assert.strictEqual(room.state, 'results');
  host.say({ t: 'toLobby' });
  assert.strictEqual(room.state, 'lobby');
});

test('free-for-all: late joiners drop straight in, the clock ends the match', () => {
  const { room, host, guest, hid } = setup({ mode: 'ffa', time: 3 });
  host.say({ t: 'startMatch' });
  mock.timers.tick(5000);
  const late = conn(room);
  late.say({ t: 'join', code: 'ABCD', name: 'Late', color: '#43a047' });
  const st = late.last('start');
  assert.ok(st, 'late joiner gets the match');
  const lid = late.last('welcome').id;
  assert.ok(st.ents.find((e) => e.id === lid && e.alive));
  assert.ok(host.last('roster').ents.some((e) => e.id === lid));
  // Spawn protection
  host.say({ t: 'hit', id: hid, target: lid, dmg: 50, w: 'ar' });
  assert.ok(!host.all('dmg').some((d) => d.id === lid));
  // State relay: only your own soldier, only while alive, with the right life number.
  late.say({ t: 's', e: [{ id: lid, l: 1, ts: 1, x: 5, y: 0, z: 5, yaw: 0 }, { id: hid, l: 1, x: 0 }] });
  const relayed = guest.last('s');
  assert.deepStrictEqual(relayed.e.map((e) => e.id), [lid]);
  late.say({ t: 'leave' });
  assert.ok(!host.last('roster').ents.some((e) => e.id === lid), 'leavers are removed');
  mock.timers.tick(3 * 60 * 1000);
  assert.ok(guest.last('results'), 'time limit ends the match');
  assert.strictEqual(guest.last('results').mode, 'ffa');
});

test('a dropped player is marked away and respawns on return', () => {
  const { room, host, guest, gid } = setup({ mode: 'ffa' });
  host.say({ t: 'startMatch' });
  mock.timers.tick(4000);
  const token = guest.last('welcome').token;
  room.detach(guest);
  assert.ok(host.last('roster').ents.find((e) => e.id === gid).away);
  const back = conn(room);
  back.say({ t: 'rejoin', code: 'ABCD', id: gid, token });
  assert.ok(back.last('start'), 'gets the match back');
  mock.timers.tick(3100);
  assert.ok(back.last('spawn')?.id === gid || host.all('spawn').some((s) => s.id === gid));
});

test('the host leaving ends the match for everyone', () => {
  const { host, guest } = setup();
  host.say({ t: 'leave' });
  assert.strictEqual(guest.last('error').code, 'hostleft');
});
