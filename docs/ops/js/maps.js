// The two maps. Each one is built from boxes on a 1 m grid (see grid.js).
// Coordinates: x runs east (0..w), z runs south (0..d), heights are in meters.
// Team 0 spawns in the north, team 1 in the south. `mbox` places a box and its
// mirror image in the other half, so both sides of each map are fair.
//
// Material options: color, tex (texture pattern), and optional col/ray/vis to
// make a block that blocks movement but not bullets (like water) or vice versa.

import { Grid } from './grid.js';

export const MAPS = {
  dust: {
    id: 'dust',
    name: 'Dust Yard',
    blurb: 'Sun-baked market town. Rooftop sniping, a tight courtyard, and a fountain plaza in the middle.',
    w: 48,
    d: 44,
    theme: {
      skyTop: '#3d8fe0',
      skyBottom: '#f3d9a6',
      fog: '#eed8ae',
      fogNear: 40,
      fogFar: 170,
      hemiSky: '#fff6e6',
      hemiGround: '#b08850',
      hemi: 1.55,
      sun: '#fff1d6',
      sunI: 1.9,
      sunDir: [0.55, 1, 0.35],
      outside: '#d9b779',
      decor: 'dunes',
    },
    mats: {
      sand: { color: '#e2c48c', tex: 'sand' },
      path: { color: '#cdb08a', tex: 'tiles' },
      wall: { color: '#d8b58a', tex: 'plaster' },
      wall2: { color: '#e8d2ad', tex: 'plaster' },
      house: { color: '#c99a6b', tex: 'plaster' },
      block: { color: '#dcc29b', tex: 'plaster' },
      stone: { color: '#b9ab98', tex: 'stone' },
      cover: { color: '#c7a074', tex: 'brick' },
      crate: { color: '#b07a42', tex: 'wood' },
      crate2: { color: '#8f6236', tex: 'wood' },
      trunk: { color: '#7a5634', tex: 'wood', vis: 0, under: 'sand' },
      truck: { color: '#5d7a63', tex: 'metal' },
      cab: { color: '#4b6652', tex: 'metal' },
    },
    build({ box, mbox, stairs, spawn, prop }) {
      box(0, 0, 48, 44, 0, 'sand');
      box(1, 21, 46, 2, 0, 'path');
      box(23, 1, 2, 42, 0, 'path');
      // Outer walls
      box(0, 0, 48, 1, 4.5, 'wall');
      box(0, 43, 48, 1, 4.5, 'wall');
      box(0, 0, 1, 44, 4.5, 'wall');
      box(47, 0, 1, 44, 4.5, 'wall');

      // Spawn yards
      mbox(14, 5, 2, 1, 1, 'crate');
      mbox(32, 5, 2, 1, 1, 'crate');
      mbox(7, 6, 1, 2, 1, 'crate');
      mbox(22, 6, 4, 1, 1.1, 'cover');
      // A parked truck in each yard (bed is low enough to jump on).
      mbox(39, 3, 2, 2, 2.1, 'cab');
      mbox(41, 3, 3, 2, 1.0, 'truck');

      // Houses that split each spawn from the middle, with lanes between them.
      mbox(14, 9, 7, 3, 4.2, 'house');
      mbox(27, 9, 7, 3, 4.2, 'house');
      mbox(22, 11, 4, 1, 1.1, 'cover');

      // West: a long building with a walkable roof, stairs at both ends and a parapet to hide behind.
      box(4, 15, 10, 14, 3, 'block');
      mbox(4, 15, 10, 1, 4.1, 'wall2');
      box(4, 15, 1, 14, 4.1, 'wall2');
      box(13, 15, 1, 14, 4.1, 'wall2');
      mbox(10, 15, 2, 1, 3, 'block'); // gaps in the parapet for the stairs
      box(13, 18, 1, 2, 3.5, 'wall2'); // low firing windows on the plaza side
      box(13, 24, 1, 2, 3.5, 'wall2');
      box(7, 20, 2, 4, 4.4, 'wall2'); // shed on the roof
      stairs(10, 9, 2, 6, 's', 0, 3, 'stone', true);
      // West alley
      mbox(1, 12, 2, 1, 1, 'crate');
      box(2, 20, 1, 4, 1.1, 'cover');
      box(3, 21, 1, 2, 2, 'crate2');
      mbox(1, 17, 2, 1, 2, 'crate2');

      // Plaza: fountain, market crates, palms.
      box(21, 19, 6, 6, 0.9, 'stone');
      box(22, 21, 4, 2, 2.4, 'stone');
      mbox(21, 16, 1, 1, 2, 'crate2');
      mbox(26, 16, 1, 1, 2, 'crate2');
      mbox(17, 15, 2, 2, 1, 'crate');
      mbox(29, 15, 2, 2, 1, 'crate');
      mbox(18, 17, 1, 1, 2, 'crate2');
      mbox(28, 17, 1, 1, 2, 'crate2');
      box(16, 20, 1, 4, 1.1, 'cover');
      box(31, 20, 1, 4, 1.1, 'cover');
      mbox(15, 13, 1, 1, 6, 'trunk');
      mbox(32, 13, 1, 1, 6, 'trunk');
      prop('palm', 15.5, 13.5, {}, true);
      prop('palm', 32.5, 13.5, {}, true);
      mbox(20, 13, 1, 1, 1, 'crate');

      // East: walled courtyard with doors on every side.
      mbox(33, 13, 12, 1, 4, 'wall2');
      box(33, 13, 1, 18, 4, 'wall2');
      box(44, 13, 1, 18, 4, 'wall2');
      mbox(33, 16, 1, 2, 0, 'path');
      box(44, 21, 1, 2, 0, 'path');
      mbox(37, 13, 2, 1, 0, 'path');
      mbox(38, 17, 1, 3, 4, 'wall2');
      mbox(35, 15, 1, 1, 1, 'crate');
      mbox(41, 15, 2, 1, 1, 'crate');
      mbox(42, 18, 1, 1, 2, 'crate2');
      box(39, 21, 2, 2, 1, 'crate');
      box(37, 21, 1, 2, 2, 'crate2');
      box(35, 21, 1, 2, 1.1, 'cover');
      // Open ground east of the houses
      mbox(36, 8, 3, 1, 1.1, 'cover');
      mbox(45, 10, 1, 2, 1, 'crate');
      mbox(45, 16, 1, 1, 2, 'crate2');
      mbox(46, 18, 1, 1, 2, 'crate2');

      // Team spawns (mirrored for the other team) and free-for-all spawns.
      for (const [x, z] of [[4, 2], [10, 3], [17, 2], [30, 2], [36, 3], [44, 6]]) spawn(x, z, 0);
      for (const [x, z] of [[2, 9], [45, 14], [20, 14], [27, 14], [36, 19]]) spawn(x, z, null);
    },
  },

  docks: {
    id: 'docks',
    name: 'Dockyard',
    blurb: 'Shipping containers at sunset. A warehouse with a catwalk, container-top perches and a long open quay.',
    w: 50,
    d: 46,
    theme: {
      skyTop: '#2b2d6e',
      skyBottom: '#ff9d5c',
      fog: '#d98a6a',
      fogNear: 35,
      fogFar: 160,
      hemiSky: '#ffd2b0',
      hemiGround: '#4a4e6a',
      hemi: 1.45,
      sun: '#ffb27a',
      sunI: 2.0,
      sunDir: [1, 0.45, 0.15],
      outside: '#6b6f7a',
      decor: 'sea',
    },
    mats: {
      ground: { color: '#8d9096', tex: 'concrete' },
      lane: { color: '#5d6068', tex: 'asphalt' },
      quay: { color: '#a19d94', tex: 'concrete' },
      fence: { color: '#7b8590', tex: 'metal' },
      water: { color: '#2f5f7a', tex: 'water', col: 99, ray: -0.6, vis: -0.6 },
      brick: { color: '#a0573f', tex: 'brick' },
      floor: { color: '#7d7a76', tex: 'concrete' },
      steel: { color: '#6f7780', tex: 'metal' },
      rail: { color: '#e0b030', tex: 'metal' },
      shelf: { color: '#3f6fa0', tex: 'metal' },
      crate: { color: '#b07a42', tex: 'wood' },
      barrier: { color: '#c9c5bb', tex: 'concrete' },
      bollard: { color: '#e0b030', tex: 'metal' },
      leg: { color: '#e8a020', tex: 'metal' },
      contR: { color: '#b8392c', tex: 'container' },
      contB: { color: '#2d6db5', tex: 'container' },
      contG: { color: '#3c8d4f', tex: 'container' },
      contY: { color: '#d9a52b', tex: 'container' },
      contW: { color: '#d8d8d2', tex: 'container' },
    },
    build({ box, mbox, stairs, spawn, prop }) {
      box(0, 0, 50, 46, 0, 'ground');
      box(16, 1, 2, 44, 0, 'lane');
      box(39, 1, 5, 44, 0, 'quay');
      box(44, 0, 6, 46, 0, 'water');
      box(0, 0, 44, 1, 4.5, 'fence');
      box(0, 45, 44, 1, 4.5, 'fence');
      box(0, 0, 1, 46, 4.5, 'fence');

      // Warehouse (open roof) with a catwalk along the back wall.
      mbox(2, 13, 13, 1, 5, 'brick');
      box(2, 13, 1, 20, 5, 'brick');
      box(14, 13, 1, 20, 5, 'brick');
      box(3, 14, 11, 18, 0, 'floor');
      box(14, 17, 1, 3, 0, 'floor'); // big doors to the yard
      box(14, 26, 1, 3, 0, 'floor');
      mbox(7, 13, 3, 1, 0, 'floor'); // doors to the spawn lots
      box(3, 19, 3, 8, 2.5, 'steel');
      stairs(3, 14, 3, 5, 's', 0, 2.5, 'steel', true);
      box(6, 19, 1, 8, 3.6, 'rail');
      mbox(9, 17, 1, 4, 2.4, 'shelf');
      box(10, 21, 2, 4, 1, 'crate');
      mbox(12, 15, 1, 1, 1, 'crate');
      mbox(11, 29, 2, 1, 1, 'crate');

      // Spawn lots
      mbox(6, 6, 3, 1, 1.1, 'barrier');
      mbox(12, 3, 1, 2, 1, 'crate');
      mbox(2, 9, 2, 1, 1, 'crate');

      // Container yard
      mbox(19, 5, 6, 2, 2.6, 'contR');
      mbox(27, 3, 2, 6, 2.6, 'contB');
      mbox(32, 6, 6, 2, 2.6, 'contG');
      mbox(19, 11, 2, 6, 2.6, 'contY');
      mbox(23, 13, 1, 1, 1, 'crate');
      mbox(26, 11, 2, 2, 1, 'crate');
      // Climbable container with stairs on each side of the map.
      mbox(30, 13, 6, 2, 2.6, 'contW');
      stairs(36, 13, 5, 2, 'w', 0, 2.5, 'steel', true);
      mbox(34, 18, 2, 4, 2.6, 'contR');
      mbox(28, 18, 1, 2, 1.1, 'barrier');
      // Two-high stack in the middle, plus low cover around it.
      box(22, 22, 6, 2, 5.2, 'contB');
      box(20, 20, 2, 6, 2.6, 'contG');
      box(30, 21, 2, 4, 1.1, 'barrier');
      mbox(24, 19, 2, 1, 1, 'crate');
      box(15, 22, 2, 2, 2.6, 'contW');
      mbox(17, 9, 2, 1, 2, 'crate');
      mbox(28, 10, 2, 1, 2, 'crate');

      // Quay: crane legs, bollards, and a little cover.
      mbox(39, 9, 1, 1, 12, 'leg');
      mbox(42, 9, 1, 1, 12, 'leg');
      prop('crane', 40.5, 9.5, {});
      prop('crane', 40.5, 36.5, {});
      for (const z of [4, 16]) mbox(42, z, 1, 1, 0.7, 'bollard');
      mbox(40, 16, 2, 1, 1, 'crate');
      box(41, 21, 3, 4, 2.6, 'contW');
      mbox(38, 17, 3, 1, 2, 'crate');
      prop('ship', 52, 23, {});

      for (const [x, z] of [[4, 3], [10, 5], [21, 2], [30, 2], [36, 3], [41, 3]]) spawn(x, z, 0);
      for (const [x, z] of [[12, 21], [29, 21], [41, 19], [24, 15]]) spawn(x, z, null);
    },
  },
};

export const MAP_IDS = Object.keys(MAPS);

const cache = new Map();
export function getGrid(id) {
  if (!cache.has(id)) cache.set(id, new Grid(MAPS[id]));
  return cache.get(id);
}
