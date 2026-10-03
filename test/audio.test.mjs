import test from 'node:test';
import assert from 'node:assert';
import { SONGS } from '../docs/js/audio.js';
import { TRACKS } from '../docs/js/tracks.js';

test('every song bar has 16 steps of valid notes', () => {
  for (const [id, song] of Object.entries(SONGS)) {
    song.bars.forEach((bar, i) => {
      assert.strictEqual(bar.length, 16, `${id} bar ${i + 1} has ${bar.length} steps`);
      for (const tok of bar) assert.ok(tok === '.' || tok === '-' || Number.isInteger(Number(tok)), `${id} bar ${i + 1}: bad note '${tok}'`);
      assert.notStrictEqual(bar[0], '-', `${id} bar ${i + 1} starts with a hold`);
    });
    for (const k of ['k', 's', 'h']) assert.strictEqual(song.drums[k].length, 16, `${id} drums.${k}`);
    assert.strictEqual(song.bass.length, 16, `${id} bass`);
  }
});

test('every track has music and keeps the start area flat', () => {
  for (const [id, t] of Object.entries(TRACKS)) {
    assert.ok(SONGS[t.music], `${id} music`);
    for (const [f, h] of t.heights) {
      if (f <= 0.04 || f >= 0.95) assert.strictEqual(h, 0, `${id} start area must be flat`);
    }
    for (const j of t.jumps) assert.ok(j.at > 0.05 && j.at < 0.93, `${id} jump away from the grid`);
  }
});
