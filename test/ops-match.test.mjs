// Pocket Ops: whole matches played headless. A host phone and a guest phone
// (both driven by bot brains) plus CPU soldiers, talking through a real room.
import test, { mock } from 'node:test';
import assert from 'node:assert';
import { Room } from '../docs/ops/js/room.js';
import { Match } from '../docs/ops/js/match.js';
import { Bot } from '../docs/ops/js/bot.js';
import { MAP_IDS } from '../docs/ops/js/maps.js';

function phone(room, name) {
  const p = { inbox: [], match: null, id: null, results: null };
  p.conn = { send: (m) => p.inbox.push(JSON.parse(JSON.stringify(m))), close() {} };
  room.attach(p.conn);
  p.say = (m) => room.handle(p.conn, JSON.parse(JSON.stringify(m)));
  p.pump = (isHost) => {
    while (p.inbox.length) {
      const m = p.inbox.shift();
      if (m.t === 'welcome') p.id = m.id;
      else if (m.t === 'start') {
        p.match = new Match(m, { myId: p.id, isHost, send: p.say, now: () => Date.now() });
        p.match.me.ai = new Bot(p.match.grid, p.id, 2, name.length * 97);
      } else if (m.t === 'results') p.results = m;
      else if (p.match) p.match.handle(m);
    }
  };
  return p;
}

for (const map of MAP_IDS) {
  for (const mode of ['tdm', 'ffa']) {
    test(`${map} ${mode}: a two-phone match with bots plays out cleanly`, () => {
      mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 5_000_000 });
      try {
        const room = new Room('TEST');
        const host = phone(room, 'Host');
        const guest = phone(room, 'Guest');
        host.say({ t: 'create', name: 'Host', color: '#e53935', weapon: 'ar' });
        guest.say({ t: 'join', code: 'TEST', name: 'Guest', color: '#1e88e5', weapon: 'smg' });
        host.say({ t: 'settings', map, mode, bots: 6, time: 3 });
        host.say({ t: 'settings', limit: mode === 'tdm' ? 75 : 30 });
        host.say({ t: 'startMatch' });
        host.pump(true);
        guest.pump(false);
        const dt = 1 / 30;
        const travel = new Map();
        const lastPos = new Map();
        let kills = 0;
        let worstLag = 0;
        const g = host.match.grid;
        for (let f = 0; f < 30 * 100; f++) {
          mock.timers.tick(1000 / 30);
          for (const [p, isHost] of [[host, true], [guest, false]]) {
            p.pump(isHost);
            const m = p.match;
            const me = m.me;
            const ctl = me.alive ? me.ai.think(dt, me.sim, me.wpn, { ents: m.list(), mode: m.mode, team: me.team }) : {};
            m.update(dt, ctl);
            for (const ev of m.events) if (ev.type === 'kill' && isHost) kills++;
            m.events.length = 0;
            if (f % 30 === 0) p.say({ t: 'ping', c: Date.now() });
          }
          // Everything this phone moves stays inside the map, never inside a wall, and never NaN.
          for (const p of [host, guest]) {
            for (const e of p.match.list()) {
              if (!e.sim || !e.alive) continue;
              const s = e.sim;
              assert.ok(Number.isFinite(s.x + s.y + s.z + s.yaw + s.pitch), `${e.id} has a bad position`);
              assert.ok(s.x > 0 && s.z > 0 && s.x < g.w && s.z < g.d, `${e.id} left the map`);
              assert.ok(g.floorAt(s.x, s.z, 0.3) <= s.y + 0.02, `${e.id} is inside a wall at ${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}`);
              const lp = lastPos.get(e.id);
              if (lp && lp.life === e.life) travel.set(e.id, (travel.get(e.id) || 0) + Math.hypot(s.x - lp.x, s.z - lp.z));
              lastPos.set(e.id, { x: s.x, z: s.z, life: e.life });
            }
          }
          // The guest sees the host's bots close to where they really are.
          if (f > 200 && f % 15 === 0) {
            for (const e of host.match.list()) {
              const seen = guest.match.ents.get(e.id);
              if (!e.bot || !e.alive || !seen?.alive || seen.snaps.length < 2) continue;
              if (Date.now() - seen.spawnedAt < 1000) continue;
              worstLag = Math.max(worstLag, Math.hypot(seen.view.x - e.sim.x, seen.view.z - e.sim.z));
            }
          }
        }
        if (process.env.VERBOSE) console.log(map, mode, kills, [...travel.values()].map((t) => t.toFixed(0)).join(","), worstLag.toFixed(2));
        assert.ok(kills >= 12, `only ${kills} kills in 100 s`);
        for (const e of host.match.list()) {
          if (e.bot) assert.ok((travel.get(e.id) || 0) > 40, `${e.name} barely moved (${(travel.get(e.id) || 0).toFixed(1)} m)`);
        }
        assert.ok(worstLag < 2.2, `remote soldiers lag ${worstLag.toFixed(2)} m behind`);
        // Both phones agree on the score.
        const score = (p) => p.match.list().map((e) => `${e.id}:${e.kills}/${e.deaths}`).sort().join(' ');
        assert.strictEqual(score(guest), score(host));
        // Run out the clock: the match ends with results for both.
        mock.timers.tick(3 * 60 * 1000);
        host.pump(true);
        guest.pump(false);
        assert.ok(host.results && guest.results, 'results arrived');
        assert.strictEqual(host.results.board.reduce((a, b) => a + b.kills, 0) <= kills, true);
      } finally {
        mock.timers.reset();
      }
    });
  }
}
