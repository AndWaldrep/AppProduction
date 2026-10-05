// Kart positions go out ~15 times a second from every player, so they travel as a
// short array instead of an object with named fields (about half the size).
//
// [id, ts, x, z, h, y, s, p, pt, tr, hop, dd, dc, md, it, u, flags]
// flags: 1 spinning, 2 star, 4 boosting

const r = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * d) / d : 0);

export function packKart(k) {
  return [
    k.id, Math.round(k.ts || 0), r(k.x, 100), r(k.z, 100), r(k.h, 1000), r(k.y, 100), r(k.s, 10), r(k.p, 10),
    r(k.pt, 100), r(k.tr, 100), r(k.hop, 100), k.dd | 0, k.dc | 0, k.md | 0, k.it | 0, k.u | 0,
    (k.sp ? 1 : 0) | (k.st ? 2 : 0) | (k.b ? 4 : 0),
  ];
}

export function unpackKart(a) {
  if (!Array.isArray(a) || typeof a[0] !== 'string') return null;
  const n = (i) => (typeof a[i] === 'number' && Number.isFinite(a[i]) ? a[i] : 0);
  const f = n(16);
  return {
    id: a[0].slice(0, 24), ts: n(1), x: n(2), z: n(3), h: n(4), y: n(5), s: n(6), p: n(7),
    pt: n(8), tr: n(9), hop: n(10), dd: n(11), dc: n(12), md: n(13) & 7, it: n(14), u: n(15),
    sp: f & 1 ? 1 : 0, st: f & 2 ? 1 : 0, b: f & 4 ? 1 : 0,
  };
}

// True when a link already has a backlog: skip sending positions (newer ones are
// coming anyway) so the backlog can drain instead of growing until it breaks.
export function congested(conn) {
  if (!conn || conn.local) return false;
  const dc = conn.dataChannel;
  return (dc && dc.bufferedAmount > 48 * 1024) || (conn.bufferSize || 0) > 0;
}
