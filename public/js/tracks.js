// Track layouts. Points are [x, z] control points of a closed loop, driven in order.
// `pads` are boost pads and `boxes` are item box rows, both as fractions of a lap.
export const TRACKS = {
  sunny: {
    name: 'Sunny Speedway',
    theme: 'grass',
    halfWidth: 9,
    points: [
      [0, 0], [0, -120], [30, -190], [100, -210], [160, -170], [170, -100], [130, -50],
      [150, 10], [220, 30], [250, 100], [210, 160], [130, 170], [60, 140], [20, 90],
    ],
    pads: [
      { at: 0.06, lat: 0 },
      { at: 0.47, lat: -3 },
      { at: 0.80, lat: 3 },
    ],
    boxes: [0.14, 0.42, 0.68, 0.9],
  },
  desert: {
    name: 'Cactus Canyon',
    theme: 'desert',
    halfWidth: 9,
    points: [
      [0, 0], [0, -150], [40, -200], [90, -180], [100, -120], [150, -95], [200, -125], [240, -105],
      [255, -55], [230, 0], [170, 30], [120, 80], [140, 150], [90, 200], [20, 180],
      [-20, 120], [-10, 60],
    ],
    pads: [
      { at: 0.05, lat: 0 },
      { at: 0.36, lat: 2 },
      { at: 0.62, lat: -2 },
    ],
    boxes: [0.15, 0.4, 0.66, 0.88],
  },
};
