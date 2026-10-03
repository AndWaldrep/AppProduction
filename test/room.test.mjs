import test from 'node:test';
import assert from 'node:assert';
import { Room, makeCode } from '../docs/js/room.js';

// A fake connection that records what the room sends it.
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
    take(t, pred = () => true) {
      const i = c.inbox.findIndex((m) => m.t === t && pred(m));
      assert.ok(i >= 0, `expected a '${t}' message`);
      return c.inbox.splice(i, 1)[0];
    },
    last(t) {
      return [...c.inbox].reverse().find((m) => m.t === t);
    },
  };
  room.attach(c);
  return c;
}

test('room codes are 4 easy-to-read letters', () => {
  for (let i = 0; i < 50; i++) assert.match(makeCode(), /^[A-HJ-NP-Z]{4}$/);
});

test('create, invite, race, finish and results', () => {
  const room = new Room('ABCD');
  const host = conn(room);
  const guest = conn(room);

  host.say({ t: 'create', name: 'Andrew', color: '#1e88e5' });
  const hw = host.take('welcome');
  assert.strictEqual(hw.code, 'ABCD');

  guest.say({ t: 'join', code: 'abcd', name: '<b>Sam</b>', color: '#1e88e5' });
  const gw = guest.take('welcome');
  const info = host.last('room');
  assert.strictEqual(info.players.length, 2);
  const sam = info.players.find((p) => p.id === gw.id);
  assert.strictEqual(sam.name, 'bSamb', 'names are sanitized');
  assert.notStrictEqual(sam.color, '#1e88e5', 'duplicate colors are reassigned');
  assert.strictEqual(info.hostId, hw.id);

  // Only the host may change settings or start.
  guest.say({ t: 'settings', laps: 5 });
  guest.say({ t: 'startRace' });
  assert.strictEqual(room.state, 'lobby');
  host.say({ t: 'settings', laps: 1, bots: 2, track: 'desert' });
  assert.deepStrictEqual(guest.last('room').settings, { laps: 1, bots: 2, track: 'desert' });

  host.say({ t: 'startRace' });
  const start = guest.take('start');
  assert.strictEqual(start.karts.length, 4);
  assert.strictEqual(start.karts.filter((k) => k.bot).length, 2);
  assert.ok(start.startAt > Date.now());

  // State relay: host may send its own kart and the bots, but not the guest's kart.
  host.say({ t: 's', k: [{ id: hw.id, ts: 1, x: 1, z: 2, h: 0, p: 5, md: 5 }, { id: 'bot0', ts: 1, x: 3, z: 4, p: 7, md: 99 }, { id: gw.id, x: 99 }] });
  const relayed = guest.take('s').k;
  assert.deepStrictEqual(relayed.map((k) => k.id), [hw.id, 'bot0']);
  assert.deepStrictEqual(relayed.map((k) => k.md), [5, 3], 'power-up flags are relayed (and kept to known bits)');
  guest.say({ t: 's', k: [{ id: 'bot1', x: 5 }] });
  assert.ok(!host.inbox.some((m) => m.t === 's'), 'guests cannot move CPU karts');

  // Item events are relayed to everyone else, with only known fields.
  guest.say({ t: 'e', type: 'box', i: 3, evil: 'x' });
  const ev = host.take('e');
  assert.strictEqual(ev.i, 3);
  assert.strictEqual(ev.from, gw.id);
  assert.strictEqual(ev.evil, undefined);

  host.say({ t: 'finish', id: 'bot1', time: 50 });
  guest.say({ t: 'finish', id: gw.id, time: 61.5 });
  assert.strictEqual(host.take('fin', (m) => m.id === gw.id).place, 2);
  host.say({ t: 'finish', id: hw.id, time: 62 });
  const results = guest.take('results');
  assert.deepStrictEqual(results.standings.map((s) => s.id), ['bot1', gw.id, hw.id, 'bot0']);
  assert.strictEqual(results.standings[3].time, null);

  host.say({ t: 'toLobby' });
  assert.strictEqual(guest.last('room').state, 'lobby');
  room.close();
});

test('a dropped phone can take its seat back, even mid-race', () => {
  const room = new Room('WXYZ');
  const host = conn(room);
  host.say({ t: 'create', name: 'A' });
  const guest = conn(room);
  guest.say({ t: 'join', code: 'WXYZ', name: 'B' });
  const gw = guest.take('welcome');
  host.say({ t: 'startRace' });
  guest.say({ t: 's', k: [{ id: gw.id, x: 10, z: 20, h: 1, p: 33 }] });

  room.detach(guest);
  assert.strictEqual(host.last('room').players.find((p) => p.id === gw.id).connected, false);

  const wrong = conn(room);
  wrong.say({ t: 'rejoin', code: 'WXYZ', id: gw.id, token: 'nope' });
  assert.strictEqual(wrong.take('error').code, 'norejoin');

  const back = conn(room);
  back.say({ t: 'rejoin', code: 'WXYZ', id: gw.id, token: gw.token });
  assert.strictEqual(back.take('welcome').id, gw.id);
  const start = back.take('start');
  assert.strictEqual(start.kstate[gw.id].p, 33, 'race position is restored');
  assert.strictEqual(host.last('room').players.find((p) => p.id === gw.id).connected, true);
  room.close();
});

test('the race ends for everyone when the host leaves', () => {
  const room = new Room('QQQQ');
  const host = conn(room);
  host.say({ t: 'create', name: 'A' });
  const guest = conn(room);
  guest.say({ t: 'join', code: 'QQQQ', name: 'B' });
  host.say({ t: 'leave' });
  assert.strictEqual(guest.take('error').code, 'hostleft');
  assert.ok(room.closed);
});

test('a reloaded host keeps its player id', () => {
  const room = new Room('RRRR');
  const host = conn(room);
  host.say({ t: 'create', name: 'A', id: 'p12345678', token: 'secret' });
  const w = host.take('welcome');
  assert.strictEqual(w.id, 'p12345678');
  assert.strictEqual(room.hostId, 'p12345678');
  room.close();
});

test('guests that go silent are disconnected', () => {
  let now = 1000;
  const room = new Room('SSSS', { now: () => now });
  const host = conn(room);
  host.local = true;
  host.say({ t: 'create', name: 'A' });
  const guest = conn(room);
  guest.say({ t: 'join', code: 'SSSS', name: 'B' });
  now += 3000;
  room.checkSilent();
  now += 3000;
  room.checkSilent();
  assert.ok(!guest.closed);
  for (let i = 0; i < 4; i++) {
    now += 3000;
    room.checkSilent();
  }
  assert.ok(!guest.closed, 'a short hiccup is not a disconnect');
  for (let i = 0; i < 4; i++) {
    now += 3000;
    room.checkSilent();
  }
  assert.ok(guest.closed);
  assert.strictEqual(host.last('room').players.find((p) => p.name === 'B').connected, false);
  room.close();
});
