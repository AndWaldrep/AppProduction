// Track layouts.
//   points   [x, z] control points of a closed loop, driven in order
//   heights  [lap fraction, height] keyframes; the road eases between them
//   jumps    ramp that launches you over a gap (river / canyon). `at` is the ramp
//            lip as a lap fraction, `gap` the width of the gap in metres
//   rollers  boulders / snowballs that roll back and forth across the road
//   pads     boost pads, `boxes` item box rows (lap fractions)
// The start/finish area (last ~5% and first ~4% of a lap) must stay flat at 0.
export const TRACKS = {
  sunny: {
    name: 'Sunny Speedway',
    short: '🌳 Sunny',
    theme: 'grass',
    music: 'sunny',
    halfWidth: 9,
    points: [
      [0, 0], [0, -120], [30, -190], [100, -210], [160, -170], [170, -100], [130, -50],
      [150, 10], [220, 30], [250, 100], [210, 160], [130, 170], [60, 140], [20, 90],
    ],
    heights: [
      [0, 0], [0.04, 0], [0.09, 5], [0.16, 5], [0.21, 0], [0.73, 0], [0.76, 2.5], [0.79, 0],
      [0.82, 2.5], [0.85, 0.5], [0.87, 4.5], [0.92, 4.5], [0.95, 0],
    ],
    jumps: [
      { at: 0.125, gap: 16 },
      { at: 0.895, gap: 14 },
    ],
    rollers: [],
    pads: [
      { at: 0.06, lat: 0 },
      { at: 0.47, lat: -3 },
      { at: 0.62, lat: 3 },
    ],
    boxes: [0.2, 0.42, 0.68, 0.84],
  },
  desert: {
    name: 'Cactus Canyon',
    short: '🌵 Canyon',
    theme: 'desert',
    music: 'desert',
    halfWidth: 9,
    points: [
      [0, 0], [0, -150], [40, -200], [90, -180], [100, -120], [150, -95], [200, -125], [240, -105],
      [255, -55], [230, 0], [170, 30], [120, 80], [140, 150], [90, 200], [20, 180],
      [-20, 120], [-10, 60],
    ],
    heights: [
      [0, 0], [0.04, 0], [0.08, 4], [0.11, 4], [0.14, 0], [0.48, 0], [0.5, 3], [0.53, 0],
      [0.56, 3], [0.59, 0], [0.61, 2.5], [0.64, 0], [0.77, 0], [0.8, 7], [0.88, 7], [0.92, 0],
    ],
    jumps: [
      { at: 0.095, gap: 14 },
      { at: 0.835, gap: 22 },
    ],
    rollers: [
      { at: 0.15, period: 3.2, phase: 0 },
      { at: 0.7, period: 2.6, phase: 1.5 },
      { at: 0.74, period: 3.6, phase: 3 },
    ],
    pads: [
      { at: 0.05, lat: 0 },
      { at: 0.36, lat: 2 },
      { at: 0.62, lat: -2 },
    ],
    boxes: [0.2, 0.4, 0.66, 0.92],
  },
  frosty: {
    name: 'Frosty Peaks',
    short: '❄️ Frosty',
    theme: 'snow',
    music: 'frosty',
    halfWidth: 9,
    points: [
      [0, 0], [0, -170], [-35, -230], [-115, -245], [-185, -205], [-195, -130], [-150, -85],
      [-160, -20], [-215, 30], [-215, 115], [-160, 165], [-85, 160], [-40, 200], [25, 180], [40, 110],
    ],
    heights: [
      [0, 0], [0.04, 0], [0.15, 9], [0.27, 9], [0.33, 0], [0.56, 0], [0.6, 5], [0.63, 5],
      [0.68, 0], [0.95, 0],
    ],
    jumps: [
      { at: 0.245, gap: 20 },
      { at: 0.612, gap: 16 },
    ],
    rollers: [
      { at: 0.47, period: 3, phase: 0 },
      { at: 0.52, period: 2.4, phase: 2 },
      { at: 0.88, period: 3.4, phase: 1 },
    ],
    pads: [
      { at: 0.03, lat: 0 },
      { at: 0.36, lat: 0 },
      { at: 0.72, lat: 2 },
    ],
    boxes: [0.18, 0.43, 0.7, 0.92],
  },
};
