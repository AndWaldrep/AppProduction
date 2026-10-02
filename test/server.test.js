'use strict';
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createServer, rooms } = require('../server');

let server;
let url;

test.before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  url = `ws://localhost:${server.address().port}/ws`;
});

test.after(() => {
  for (const room of rooms.values()) clearTimeout(room.resultsTimer);
  for (const ws of server.wss.clients) ws.terminate();
  server.close();
});

// A client that records every message and lets tests wait for a specific one.
function client() {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const msg = JSON.parse(d);
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.match(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const c = {
    ws,
    inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    next(match, ms = 2000) {
      const found = inbox.find(match);
      if (found) {
        inbox.splice(inbox.indexOf(found), 1);
        return Promise.resolve(found);
      }
      return new Promise((resolve, reject) => {
        const w = {
          match,
          resolve: (m) => {
            inbox.splice(inbox.indexOf(m), 1);
            clearTimeout(timer);
            resolve(m);
          },
        };
        const timer = setTimeout(() => reject(new Error('timed out waiting for message')), ms);
        waiters.push(w);
      });
    },
    open: () => new Promise((r) => ws.once('open', r)),
    close: () => ws.close(),
  };
  return c;
}

const type = (t) => (m) => m.t === t;

test('create, invite, race, finish and results', async () => {
  const host = client();
  const guest = client();
  await Promise.all([host.open(), guest.open()]);

  host.send({ t: 'create', name: 'Andrew', color: '#1e88e5' });
  const hw = await host.next(type('welcome'));
  assert.match(hw.code, /^[A-Z]{4}$/);

  guest.send({ t: 'join', code: hw.code.toLowerCase(), name: '<b>Sam</b>', color: '#1e88e5' });
  const gw = await guest.next(type('welcome'));
  const room = await host.next((m) => m.t === 'room' && m.players.length === 2);
  const sam = room.players.find((p) => p.id === gw.id);
  assert.strictEqual(sam.name, 'bSamb', 'names are sanitized');
  assert.notStrictEqual(sam.color, '#1e88e5', 'duplicate colors are reassigned');
  assert.strictEqual(room.hostId, hw.id);

  // Only the host may change settings or start.
  guest.send({ t: 'settings', laps: 5 });
  guest.send({ t: 'startRace' });
  host.send({ t: 'settings', laps: 1, bots: 2, track: 'desert' });
  const updated = await guest.next((m) => m.t === 'room' && m.settings.laps === 1);
  assert.deepStrictEqual(updated.settings, { laps: 1, bots: 2, track: 'desert' });
  assert.strictEqual(updated.state, 'lobby');

  host.send({ t: 'startRace' });
  const start = await guest.next(type('start'));
  assert.strictEqual(start.karts.length, 4);
  assert.strictEqual(start.karts.filter((k) => k.bot).length, 2);
  assert.ok(start.startAt > Date.now());

  // State relay: host may send its own kart and bots, but not the guest's kart.
  host.send({ t: 's', k: [{ id: hw.id, ts: 1, x: 1, z: 2, h: 0, p: 5 }, { id: 'bot0', ts: 1, x: 3, z: 4, p: 7 }, { id: gw.id, x: 99 }] });
  const relayed = await guest.next(type('s'));
  assert.deepStrictEqual(relayed.k.map((k) => k.id), [hw.id, 'bot0']);

  // Item events are relayed to everyone else.
  guest.send({ t: 'e', type: 'box', i: 3 });
  const ev = await host.next(type('e'));
  assert.strictEqual(ev.i, 3);
  assert.strictEqual(ev.from, gw.id);

  host.send({ t: 'finish', id: 'bot1', time: 50 });
  await guest.next((m) => m.t === 'fin' && m.id === 'bot1');
  guest.send({ t: 'finish', id: gw.id, time: 61.5 });
  const fin = await host.next((m) => m.t === 'fin' && m.id === gw.id);
  assert.strictEqual(fin.place, 2);
  host.send({ t: 'finish', id: hw.id, time: 62 });
  const results = await guest.next(type('results'));
  assert.deepStrictEqual(results.standings.map((s) => s.id), ['bot1', gw.id, hw.id, 'bot0']);
  assert.strictEqual(results.standings[3].time, null);

  host.send({ t: 'toLobby' });
  await guest.next((m) => m.t === 'room' && m.state === 'lobby');
  host.close();
  guest.close();
});

test('a dropped phone can take its seat back', async () => {
  const a = client();
  await a.open();
  a.send({ t: 'create', name: 'A' });
  const w = await a.next(type('welcome'));
  a.close();
  await new Promise((r) => setTimeout(r, 100));

  const b = client();
  await b.open();
  b.send({ t: 'rejoin', code: w.code, id: w.id, token: 'wrong' });
  assert.strictEqual((await b.next(type('error'))).code, 'norejoin');
  b.close();

  const c = client();
  await c.open();
  c.send({ t: 'rejoin', code: w.code, id: w.id, token: w.token });
  const again = await c.next(type('welcome'));
  assert.strictEqual(again.id, w.id);
  const room = await c.next(type('room'));
  assert.strictEqual(room.players.length, 1);
  assert.ok(room.players[0].connected);
  c.send({ t: 'leave' });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!rooms.has(w.code), 'empty rooms are deleted');
  c.close();
});

test('joining a missing room gives a friendly error', async () => {
  const a = client();
  await a.open();
  a.send({ t: 'join', code: 'ZZZZ', name: 'A' });
  const err = await a.next(type('error'));
  assert.strictEqual(err.code, 'noroom');
  a.close();
});
