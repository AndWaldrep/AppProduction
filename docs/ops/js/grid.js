// The map is a grid of 1 m columns, each with a height. That keeps collision,
// bullets, line of sight and bot pathfinding simple, exact and fast on phones.
// Nothing here touches Three.js, so the room (host) and the tests can use it too.

export const STEP = 0.55; // highest ledge you can walk up without jumping
export const JUMP_UP = 1.15; // highest ledge bots will jump onto
export const OUT = 99; // height outside the map

export class Grid {
  // def: { w, d, mats: { name: {...} }, build(api) }
  constructor(def) {
    this.def = def;
    this.w = def.w;
    this.d = def.d;
    const n = this.w * this.d;
    this.col = new Float32Array(n); // what you collide with
    this.ray = new Float32Array(n); // what stops bullets
    this.vis = new Float32Array(n); // what's drawn
    this.mat = new Uint16Array(n);
    this.tint = new Float32Array(n).fill(1);
    this.matNames = Object.keys(def.mats);
    this.matIndex = Object.fromEntries(this.matNames.map((m, i) => [m, i]));
    this.spawns = [];
    this.props = [];
    this.maxH = 0;
    const api = {
      box: (x, z, w, d, h, mat, o = {}) => this.box(x, z, w, d, h, mat, o),
      // Same box mirrored to the other half of the map (both teams get the same layout).
      mbox: (x, z, w, d, h, mat, o = {}) => {
        this.box(x, z, w, d, h, mat, o);
        this.box(x, this.d - z - d, w, d, h, mat, o);
      },
      stairs: (x, z, w, d, dir, from, to, mat, mirror = false) => this.stairs(x, z, w, d, dir, from, to, mat, mirror),
      spawn: (x, z, team, mirror = true) => {
        this.spawns.push({ x: x + 0.5, z: z + 0.5, team });
        if (mirror) this.spawns.push({ x: x + 0.5, z: this.d - z - 0.5, team: team === null ? null : 1 - team });
      },
      prop: (type, x, z, o = {}, mirror = false) => {
        this.props.push({ type, x, z, ...o });
        if (mirror) this.props.push({ type, x, z: this.d - z, ...o, flip: !o.flip });
      },
    };
    def.build(api);
    for (let i = 0; i < n; i++) if (this.vis[i] < 50) this.maxH = Math.max(this.maxH, this.ray[i], this.vis[i]);
    const cx = this.w / 2;
    const cz = this.d / 2;
    for (const s of this.spawns) {
      s.y = this.col[this.idx(Math.floor(s.x), Math.floor(s.z))];
      s.yaw = Math.atan2(-(cx - s.x), -(cz - s.z)); // face the middle of the map
    }
  }

  idx(cx, cz) {
    return cz * this.w + cx;
  }

  inside(cx, cz) {
    return cx >= 0 && cz >= 0 && cx < this.w && cz < this.d;
  }

  box(x, z, w, d, h, mat, o) {
    const m = this.matIndex[mat];
    if (m === undefined) throw new Error('unknown material ' + mat);
    const info = this.def.mats[mat];
    for (let cz = z; cz < z + d; cz++) {
      for (let cx = x; cx < x + w; cx++) {
        if (!this.inside(cx, cz)) continue;
        const i = this.idx(cx, cz);
        this.mat[i] = m;
        this.vis[i] = info.vis ?? h;
        this.col[i] = info.col ?? h;
        this.ray[i] = info.ray ?? h;
        this.tint[i] = o.tint ?? 1;
      }
    }
  }

  // A staircase rising in direction dir ('n','s','e','w' = -z,+z,+x,-x) from height `from` to `to`.
  stairs(x, z, w, d, dir, from, to, mat, mirror) {
    const len = dir === 'n' || dir === 's' ? d : w;
    for (let k = 0; k < len; k++) {
      const h = from + ((to - from) * (k + 1)) / len;
      let bx = x;
      let bz = z;
      let bw = w;
      let bd = d;
      if (dir === 'e') (bx = x + k), (bw = 1);
      if (dir === 'w') (bx = x + w - 1 - k), (bw = 1);
      if (dir === 's') (bz = z + k), (bd = 1);
      if (dir === 'n') (bz = z + d - 1 - k), (bd = 1);
      this.box(bx, bz, bw, bd, h, mat, {});
      if (mirror) this.box(bx, this.d - bz - bd, bw, bd, h, mat, {});
    }
  }

  colAt(cx, cz) {
    return this.inside(cx, cz) ? this.col[cz * this.w + cx] : OUT;
  }

  rayAt(cx, cz) {
    return this.inside(cx, cz) ? this.ray[cz * this.w + cx] : OUT;
  }

  visAt(cx, cz) {
    return this.inside(cx, cz) ? this.vis[cz * this.w + cx] : OUT;
  }

  // Highest collision height under a square of half-size r centered at (x, z).
  floorAt(x, z, r) {
    let h = -Infinity;
    const x0 = Math.floor(x - r);
    const x1 = Math.floor(x + r);
    const z0 = Math.floor(z - r);
    const z1 = Math.floor(z + r);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) h = Math.max(h, this.colAt(cx, cz));
    return h;
  }

  // Move a square body of half-size r along one axis, stopping at anything taller than maxH.
  // Returns the new coordinate and whether it was blocked.
  slide(x, z, r, axis, delta, maxH) {
    if (axis === 0) {
      const nx = x + delta;
      const edge = delta > 0 ? Math.floor(nx + r) : Math.floor(nx - r);
      const z0 = Math.floor(z - r);
      const z1 = Math.floor(z + r);
      const old = delta > 0 ? Math.floor(x + r) : Math.floor(x - r);
      if (edge !== old) {
        for (let cz = z0; cz <= z1; cz++) {
          if (this.colAt(edge, cz) > maxH) return [delta > 0 ? edge - r - 1e-3 : edge + 1 + r + 1e-3, true];
        }
      }
      return [nx, false];
    }
    const nz = z + delta;
    const edge = delta > 0 ? Math.floor(nz + r) : Math.floor(nz - r);
    const x0 = Math.floor(x - r);
    const x1 = Math.floor(x + r);
    const old = delta > 0 ? Math.floor(z + r) : Math.floor(z - r);
    if (edge !== old) {
      for (let cx = x0; cx <= x1; cx++) {
        if (this.colAt(cx, edge) > maxH) return [delta > 0 ? edge - r - 1e-3 : edge + 1 + r + 1e-3, true];
      }
    }
    return [nz, false];
  }

  // Ray against the map. (dx, dy, dz) must be normalized. Returns { t, x, y, z, nx, ny, nz } or null.
  raycast(ox, oy, oz, dx, dy, dz, maxT = 200) {
    let cx = Math.floor(ox);
    let cz = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? cx + 1 - ox : ox - cx) * tdx : Infinity;
    let tmz = dz !== 0 ? (dz > 0 ? cz + 1 - oz : oz - cz) * tdz : Infinity;
    let t = 0;
    let nx = 0;
    let nz = 0;
    for (let guard = 0; guard < 600; guard++) {
      if (!this.inside(cx, cz)) return null; // flew out of the map (over the sea, say)
      const H = this.ray[cz * this.w + cx];
      const tExit = Math.min(tmx, tmz, maxT);
      const yIn = oy + dy * t;
      if (yIn < H - 1e-6) {
        if (t <= 1e-6 && guard === 0) return { t: 0, x: ox, y: oy, z: oz, nx: 0, ny: 1, nz: 0 }; // started inside something
        return { t, x: ox + dx * t, y: yIn, z: oz + dz * t, nx, ny: 0, nz };
      }
      if (dy < 0) {
        const tTop = (H - oy) / dy;
        if (tTop >= t && tTop <= tExit) return { t: tTop, x: ox + dx * tTop, y: H, z: oz + dz * tTop, nx: 0, ny: 1, nz: 0 };
      }
      if (tExit >= maxT) return null;
      if (dy > 0 && oy + dy * t > this.maxH + 0.5) return null; // flying over everything
      if (tmx < tmz) {
        t = tmx;
        tmx += tdx;
        cx += stepX;
        nx = -stepX;
        nz = 0;
      } else {
        t = tmz;
        tmz += tdz;
        cz += stepZ;
        nx = 0;
        nz = -stepZ;
      }
    }
    return null;
  }

  // Can a bullet get from a to b?
  clear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len);
  }

  // ------------------------------------------------------------ bot pathfinding

  // Can you get from cell a to neighboring cell b on foot? (0 = no, 1 = walk, 2 = jump)
  link(ax, az, bx, bz) {
    const ha = this.colAt(ax, az);
    const hb = this.colAt(bx, bz);
    if (hb >= 50) return 0;
    if (hb - ha <= STEP) return 1;
    if (hb - ha <= JUMP_UP) return 2;
    return 0;
  }

  // A* over cells. Returns [[cx, cz], ...] (not including the start) or null.
  path(sx, sz, gx, gz, maxNodes = 4000) {
    const W = this.w;
    if (!this.inside(sx, sz) || !this.inside(gx, gz) || this.colAt(gx, gz) >= 50) return null;
    const start = sz * W + sx;
    const goal = gz * W + gx;
    if (start === goal) return [];
    const g = new Map([[start, 0]]);
    const from = new Map();
    const open = [[this.heur(sx, sz, gx, gz), start]];
    const closed = new Set();
    let visited = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (open.length) {
      // Small maps, so a sorted-insert queue is plenty fast.
      const [, cur] = open.shift();
      if (cur === goal) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (++visited > maxNodes) return null;
      const cx = cur % W;
      const cz = (cur - cx) / W;
      for (const [ddx, ddz] of dirs) {
        const nx = cx + ddx;
        const nz = cz + ddz;
        const l = this.link(cx, cz, nx, nz);
        if (!l) continue;
        if (ddx && ddz) {
          // No cutting corners past walls.
          if (l === 2 || this.link(cx, cz, nx, cz) !== 1 || this.link(cx, cz, cx, nz) !== 1) continue;
          if (this.link(nx, cz, nx, nz) !== 1 || this.link(cx, nz, nx, nz) !== 1) continue;
        }
        const ni = nz * W + nx;
        const cost = (g.get(cur) ?? 0) + (ddx && ddz ? 1.414 : 1) + (l === 2 ? 2.5 : 0);
        if (cost < (g.get(ni) ?? Infinity)) {
          g.set(ni, cost);
          from.set(ni, cur);
          const f = cost + this.heur(nx, nz, gx, gz);
          let lo = 0;
          let hi = open.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (open[mid][0] < f) lo = mid + 1;
            else hi = mid;
          }
          open.splice(lo, 0, [f, ni]);
        }
      }
    }
    if (!from.has(goal)) return null;
    const out = [];
    for (let c = goal; c !== start; c = from.get(c)) out.push([c % W, Math.floor(c / W)]);
    return out.reverse();
  }

  heur(ax, az, bx, bz) {
    const dx = Math.abs(ax - bx);
    const dz = Math.abs(az - bz);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  }

  // Can you walk straight from (ax,az) to (bx,bz) without jumping? (Used to smooth bot paths.)
  walkable(ax, az, bx, bz, r = 0.35) {
    const dist = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(dist / 0.25));
    let h = this.floorAt(ax, az, r);
    for (let i = 1; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const z = az + ((bz - az) * i) / n;
      const nh = this.floorAt(x, z, r);
      if (nh - h > STEP || nh >= 50) return false;
      if (h - nh > 0.6) return false; // don't plan to walk off ledges
      h = nh;
    }
    return true;
  }

  // Every cell you can stand in and reach from the first spawn. Used by the tests and bots.
  reachable() {
    const W = this.w;
    const s = this.spawns[0];
    const start = Math.floor(s.z) * W + Math.floor(s.x);
    const seen = new Uint8Array(this.w * this.d);
    seen[start] = 1;
    const q = [start];
    while (q.length) {
      const cur = q.pop();
      const cx = cur % W;
      const cz = (cur - cx) / W;
      for (const [ddx, ddz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ddx;
        const nz = cz + ddz;
        if (!this.inside(nx, nz)) continue;
        const ni = nz * W + nx;
        if (seen[ni] || !this.link(cx, cz, nx, nz)) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return seen;
  }
}
