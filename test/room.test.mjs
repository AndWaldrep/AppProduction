import test from 'node:test';
import assert from 'node:assert';
import { Room, makeCode } from '../docs/js/room.js';
import { packKart, unpackKart } from '../docs/js/proto.js';

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
  host.say({ t: 's', k: [packKart({ id: hw.id, ts: 1, x: 1, z: 2, h: 0, p: 5, md: 5 }), packKart({ id: 'bot0', ts: 1, x: 3, z: 4, p: 7, md: 99 }), packKart({ id: gw.id, x: 99 })] });
  room.flushStates();
  const relayed = guest.take('s').k.map(unpackKart);
  assert.deepStrictEqual(relayed.map((k) => k.id), [hw.id, 'bot0']);
  assert.deepStrictEqual(relayed.map((k) => k.md), [5, 3], 'power-up flags are relayed (and kept to known bits)');
  guest.say({ t: 's', k: [packKart({ id: 'bot1', x: 5 })] });
  room.flushStates();
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
  guest.say({ t: 's', k: [packKart({ id: gw.id, x: 10, z: 20, h: 1, p: 33 })] });

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

test('TV mode: the big screen hosts and shows everyone; phones still play', () => {
  const room = new Room('TVTV');
  const tv = conn(room);
  tv.say({ t: 'create', name: 'TV', tv: true });
  const tw = tv.take('welcome');
  assert.strictEqual(tv.last('room').tv, true);

  // Can't start before a phone has joined.
  tv.say({ t: 'startRace' });
  assert.strictEqual(room.state, 'lobby');

  const phones = [];
  for (const name of ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal']) {
    const c = conn(room);
    c.say({ t: 'join', code: 'TVTV', name });
    phones.push({ c, id: c.take('welcome').id });
  }
  const extra = conn(room);
  extra.say({ t: 'join', code: 'TVTV', name: 'Ivy' });
  assert.strictEqual(extra.take('error').code, 'full', 'split screen fits eight players');
  assert.ok(!tv.last('room').players.slice(1).some((p) => p.color === '#ffffff'), 'the TV does not use up a kart color');

  // Anyone on the couch can change settings and start.
  phones[0].c.say({ t: 'settings', bots: 1, laps: 1 });
  phones[1].c.say({ t: 'startRace' });
  const start = tv.take('start');
  assert.deepStrictEqual(start.karts.filter((k) => !k.bot).map((k) => k.id).sort(), phones.map((p) => p.id).sort(), 'the TV is not a racer');

  // Each phone drives its own kart and the TV sees it; the TV drives only the CPUs.
  phones[2].c.say({ t: 's', k: [packKart({ id: phones[2].id, x: 4, p: 3, it: 6, u: 1 })] });
  room.flushStates();
  const seen = unpackKart(tv.take('s').k[0]);
  assert.strictEqual(seen.id, phones[2].id);
  assert.strictEqual(seen.it, 6, 'item shown on the TV');
  tv.say({ t: 's', k: [packKart({ id: 'bot0', x: 1 }), packKart({ id: phones[0].id, x: 99 })] });
  room.flushStates();
  assert.deepStrictEqual(phones[1].c.take('s', (m) => m.k[0][0] === 'bot0').k.map((a) => a[0]), ['bot0'], 'the TV cannot move a phone player\'s kart');

  tv.say({ t: 's', k: phones.map((p, i) => packKart({ id: p.id, p: i })) });
  phones.forEach((p, i) => p.c.say({ t: 'finish', id: p.id, time: 40 + i }));
  const results = tv.take('results');
  assert.deepStrictEqual(results.standings.slice(0, 8).map((s) => s.id), phones.map((p) => p.id));
  room.close();
});

test('8 players: positions go out bundled, and a backed-up link skips a beat', () => {
  const room = new Room('EEEE');
  const host = conn(room);
  host.say({ t: 'create', name: 'H' });
  const guests = [];
  for (let i = 0; i < 7; i++) {
    const c = conn(room);
    c.say({ t: 'join', code: 'EEEE', name: 'G' + i });
    guests.push({ c, id: c.take('welcome').id });
  }
  host.say({ t: 'startRace' });
  for (const g of guests) g.c.inbox.length = 0;
  // Everyone reports a position (some twice) before the next bundle goes out.
  host.say({ t: 's', k: [packKart({ id: room.hostId, x: 1 })] });
  for (const g of guests) {
    g.c.say({ t: 's', k: [packKart({ id: g.id, x: 1 })] });
    g.c.say({ t: 's', k: [packKart({ id: g.id, x: 2 })] });
  }
  assert.ok(!guests[0].c.inbox.some((m) => m.t === 's'), 'nothing is forwarded one by one');
  // One guest's link is backed up.
  guests[3].c.dataChannel = { bufferedAmount: 200000 };
  room.flushStates();
  const got = guests[0].c.inbox.filter((m) => m.t === 's');
  assert.strictEqual(got.length, 1, 'one bundle per tick');
  assert.strictEqual(got[0].k.length, 7, 'everyone else: the host and 6 other guests');
  assert.ok(!got[0].k.some((a) => a[0] === guests[0].id), 'not your own kart');
  assert.strictEqual(unpackKart(got[0].k.find((a) => a[0] === guests[1].id)).x, 2, 'the latest position');
  assert.ok(!guests[3].c.inbox.some((m) => m.t === 's'), 'backed-up link skipped');
  room.close();
});
