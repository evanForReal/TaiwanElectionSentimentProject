import type { Layout, LayoutLine, Vec2 } from "./types.ts";
import { FIXTURE_TYPES, OPENING_TYPES, WALL_TYPES } from "./types.ts";

// Plan coordinates: x to the right, y down the page, both in cm. In 3D, plan y becomes +z.
// A footprint rotation θ (radians) matches three.js rotation.y = θ: a local point (lx, lz)
// maps to (lx·cosθ + lz·sinθ, −lx·sinθ + lz·cosθ). Local +z is the front of a piece.

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const lineLength = (l: { a: Vec2; b: Vec2 }) => dist(l.a, l.b);

export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = add(a, scale(ab, t));
  return { point, t, distance: dist(p, point) };
}

export const isWall = (l: LayoutLine) => WALL_TYPES.includes(l.type);
export const isOpening = (l: LayoutLine) => OPENING_TYPES.includes(l.type);
export const isFixture = (l: LayoutLine) => FIXTURE_TYPES.includes(l.type);

export function wallThickness(l: LayoutLine, layout: Layout) {
  return l.thickness ?? (l.type === "wall-interior" ? Math.min(12, layout.wallThickness) : layout.wallThickness);
}

export function wallHeight(l: LayoutLine, layout: Layout) {
  return l.height ?? layout.ceilingHeight;
}

// ---------- Openings cut into walls ----------

export interface WallOpening {
  line: LayoutLine;
  from: number; // cm along the wall from wall.a
  to: number;
  bottom: number; // cm above floor
  top: number;
}

export function openingDefaults(l: LayoutLine): { bottom: number; top: number } {
  switch (l.type) {
    case "door":
      return { bottom: 0, top: l.height ?? 210 };
    case "window":
      return { bottom: l.sill ?? 90, top: l.height ?? 210 };
    default:
      return { bottom: 0, top: l.height ?? 225 };
  }
}

/** Openings whose segment lies along this wall, as cm intervals measured from wall.a. */
export function openingsOnWall(wall: LayoutLine, layout: Layout): WallOpening[] {
  const L = lineLength(wall);
  if (L < 1) return [];
  const tol = wallThickness(wall, layout) / 2 + 8;
  const dir = scale(sub(wall.b, wall.a), 1 / L);
  const result: WallOpening[] = [];
  for (const o of layout.lines) {
    if (!isOpening(o)) continue;
    const ca = closestOnSegment(o.a, wall.a, wall.b);
    const cb = closestOnSegment(o.b, wall.a, wall.b);
    if (ca.distance > tol || cb.distance > tol) continue;
    // Both endpoints must also be roughly parallel, not just near a corner
    const od = sub(o.b, o.a);
    if (len(od) < 1 || Math.abs(cross(scale(od, 1 / len(od)), dir)) > 0.25) continue;
    const t0 = dot(sub(o.a, wall.a), dir);
    const t1 = dot(sub(o.b, wall.a), dir);
    const from = Math.max(0, Math.min(t0, t1));
    const to = Math.min(L, Math.max(t0, t1));
    if (to - from < 5) continue;
    result.push({ line: o, from, to, ...openingDefaults(o) });
  }
  return result.sort((a, b) => a.from - b.from);
}

export interface WallPiece {
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/** Splits a wall into solid boxes around its openings. */
export function wallPieces(wall: LayoutLine, layout: Layout): WallPiece[] {
  const L = lineLength(wall);
  const H = wallHeight(wall, layout);
  const pieces: WallPiece[] = [];
  let cursor = 0;
  for (const o of openingsOnWall(wall, layout)) {
    const from = Math.max(cursor, o.from);
    if (from > cursor + 0.5) pieces.push({ from: cursor, to: from, bottom: 0, top: H });
    if (o.to > from) {
      if (o.bottom > 0.5) pieces.push({ from, to: o.to, bottom: 0, top: Math.min(o.bottom, H) });
      if (o.top < H - 0.5) pieces.push({ from, to: o.to, bottom: o.top, top: H });
    }
    cursor = Math.max(cursor, o.to);
  }
  if (L > cursor + 0.5) pieces.push({ from: cursor, to: L, bottom: 0, top: H });
  return pieces;
}

// ---------- Fixtures ----------

/** A fixture is drawn along its back edge and extends `depth` to one side. */
export function fixtureRect(l: LayoutLine): OBB {
  const L = lineLength(l);
  const dir = L > 0 ? scale(sub(l.b, l.a), 1 / L) : { x: 1, y: 0 };
  const normal = { x: -dir.y, y: dir.x };
  const depth = l.depth ?? fixtureDefaults(l.type).depth;
  const side = l.side ?? 1;
  const mid = scale(add(l.a, l.b), 0.5);
  const center = add(mid, scale(normal, (side * depth) / 2));
  if (l.type === "column") {
    return { center: mid, hw: L / 2, hd: depth / 2, angle: Math.atan2(-dir.y, dir.x) };
  }
  return { center, hw: L / 2, hd: depth / 2, angle: Math.atan2(-dir.y, dir.x) };
}

export function fixtureDefaults(type: LayoutLine["type"]): { depth: number; height: number } {
  switch (type) {
    case "cabinet":
      return { depth: 60, height: 90 };
    case "counter":
      return { depth: 62, height: 92 };
    case "fireplace":
      return { depth: 40, height: 110 };
    case "radiator":
      return { depth: 12, height: 60 };
    case "column":
      return { depth: 30, height: 260 };
    default:
      return { depth: 30, height: 90 };
  }
}

// ---------- Floor outline ----------

/**
 * Finds the room outline from the wall graph: endpoints within `tol` cm are merged, faces of
 * the planar graph are walked, and the face with the largest area is the outer boundary.
 * Falls back to the walls' bounding box when walls don't close.
 */
export function floorPolygon(layout: Layout, tol = 8): Vec2[] {
  const walls = layout.lines.filter(isWall);
  if (walls.length === 0) return [];
  const verts: Vec2[] = [];
  const vid = (p: Vec2) => {
    for (let i = 0; i < verts.length; i++) if (dist(verts[i], p) <= tol) return i;
    verts.push({ ...p });
    return verts.length - 1;
  };
  // Split walls at T-junctions so interior walls that end mid-wall join the graph
  const pts = walls.flatMap((w) => [w.a, w.b]);
  const edges = new Set<string>();
  for (const w of walls) {
    const L = lineLength(w);
    if (L < 1) continue;
    const ts = [0, 1];
    for (const p of pts) {
      const c = closestOnSegment(p, w.a, w.b);
      if (c.distance <= tol && c.t > 0.01 && c.t < 0.99) ts.push(c.t);
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i < ts.length - 1; i++) {
      const u = vid(add(w.a, scale(sub(w.b, w.a), ts[i])));
      const v = vid(add(w.a, scale(sub(w.b, w.a), ts[i + 1])));
      if (u !== v) edges.add(u < v ? `${u}-${v}` : `${v}-${u}`);
    }
  }
  const adj: number[][] = verts.map(() => []);
  for (const e of edges) {
    const [u, v] = e.split("-").map(Number);
    adj[u].push(v);
    adj[v].push(u);
  }
  // Sort neighbors by angle so we can take the next edge around each vertex
  for (let i = 0; i < verts.length; i++)
    adj[i].sort(
      (a, b) =>
        Math.atan2(verts[a].y - verts[i].y, verts[a].x - verts[i].x) -
        Math.atan2(verts[b].y - verts[i].y, verts[b].x - verts[i].x),
    );
  const used = new Set<string>();
  let best: Vec2[] = [];
  let bestArea = 0;
  for (let u = 0; u < verts.length; u++)
    for (const v of adj[u]) {
      if (used.has(`${u}>${v}`)) continue;
      const face: number[] = [];
      let [a, b] = [u, v];
      let guard = 0;
      while (!used.has(`${a}>${b}`) && guard++ < 10000) {
        used.add(`${a}>${b}`);
        face.push(a);
        const nbrs = adj[b];
        const idx = nbrs.indexOf(a);
        const next = nbrs[(idx - 1 + nbrs.length) % nbrs.length];
        [a, b] = [b, next];
      }
      const poly = face.map((i) => verts[i]);
      const area = Math.abs(polygonArea(poly));
      if (area > bestArea) {
        bestArea = area;
        best = poly;
      }
    }
  if (best.length >= 3 && bestArea > 1000) return dedupeCollinear(best);
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (x1 - x0 < 10 || y1 - y0 < 10) return [];
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function dedupeCollinear(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const next = poly[(i + 1) % poly.length];
    if (Math.abs(cross(sub(poly[i], prev), sub(next, poly[i]))) > 1e-3 * dist(prev, next) ** 2 || poly.length <= 3)
      out.push(poly[i]);
  }
  return out;
}

export function polygonArea(poly: Vec2[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += cross(poly[i], poly[(i + 1) % poly.length]);
  return a / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const n = poly.length || 1;
  return poly.reduce((acc, p) => ({ x: acc.x + p.x / n, y: acc.y + p.y / n }), { x: 0, y: 0 });
}

export function layoutBounds(layout: Layout): { min: Vec2; max: Vec2 } {
  const pts = [
    ...layout.lines.flatMap((l) => [l.a, l.b]),
    ...layout.zones.flatMap((z) => z.points),
    ...layout.points.map((p) => p.at),
  ];
  if (pts.length === 0) return { min: { x: 0, y: 0 }, max: { x: 400, y: 300 } };
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
  };
}

/** Rescales every coordinate so that `line` measures `realLength` cm. */
export function rescaleLayout(layout: Layout, factor: number): Layout {
  const s = (p: Vec2): Vec2 => ({ x: p.x * factor, y: p.y * factor });
  return {
    ...layout,
    lines: layout.lines.map((l) => ({ ...l, a: s(l.a), b: s(l.b) })),
    points: layout.points.map((p) => ({ ...p, at: s(p.at) })),
    zones: layout.zones.map((z) => ({ ...z, points: z.points.map(s) })),
    background: layout.background
      ? {
          ...layout.background,
          x: layout.background.x * factor,
          y: layout.background.y * factor,
          cmPerPx: layout.background.cmPerPx * factor,
        }
      : null,
  };
}

// ---------- Oriented boxes: footprints, collisions, clearances ----------

export interface OBB {
  center: Vec2;
  hw: number; // half width (local x)
  hd: number; // half depth (local z)
  angle: number; // radians, same sense as three.js rotation.y
}

export function obbAxes(o: OBB): { ax: Vec2; az: Vec2 } {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  return { ax: { x: c, y: -s }, az: { x: s, y: c } };
}

export function obbCorners(o: OBB): Vec2[] {
  const { ax, az } = obbAxes(o);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sz]) => add(o.center, add(scale(ax, sx * o.hw), scale(az, sz * o.hd))));
}

/** Separating-axis test. Returns penetration depth (> 0 means overlapping). */
export function obbOverlap(a: OBB, b: OBB): number {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  let minPen = Infinity;
  for (const o of [a, b]) {
    const { ax, az } = obbAxes(o);
    for (const axis of [ax, az]) {
      const pa = ca.map((p) => dot(p, axis));
      const pb = cb.map((p) => dot(p, axis));
      const pen = Math.min(Math.max(...pa) - Math.min(...pb), Math.max(...pb) - Math.min(...pa));
      if (pen <= 0) return 0;
      minPen = Math.min(minPen, pen);
    }
  }
  return minPen;
}

export function wallOBB(wall: LayoutLine, layout: Layout, from = 0, to?: number): OBB {
  const L = lineLength(wall);
  const end = to ?? L;
  const dir = L > 0 ? scale(sub(wall.b, wall.a), 1 / L) : { x: 1, y: 0 };
  const center = add(wall.a, scale(dir, (from + end) / 2));
  return { center, hw: (end - from) / 2, hd: wallThickness(wall, layout) / 2, angle: Math.atan2(-dir.y, dir.x) };
}

export interface Obstacle {
  id: string;
  kind: "wall" | "fixture" | "item";
  obb: OBB;
  bottom: number;
  top: number;
}

/** Walls (minus door and passage openings) and fixtures as collision obstacles. */
export function layoutObstacles(layout: Layout): Obstacle[] {
  const out: Obstacle[] = [];
  for (const l of layout.lines) {
    if (isWall(l)) {
      wallPieces(l, layout).forEach((p, i) => {
        out.push({ id: `${l.id}:${i}`, kind: "wall", obb: wallOBB(l, layout, p.from, p.to), bottom: p.bottom, top: p.top });
      });
    } else if (isFixture(l)) {
      out.push({
        id: l.id,
        kind: "fixture",
        obb: fixtureRect(l),
        bottom: 0,
        top: l.height ?? fixtureDefaults(l.type).height,
      });
    }
  }
  return out;
}

/** Distance from a ray to the nearest edge of any obstacle, or Infinity. */
export function rayCast(origin: Vec2, dir: Vec2, obstacles: OBB[], maxDist = 600): number {
  let best = Infinity;
  for (const o of obstacles) {
    const c = obbCorners(o);
    for (let i = 0; i < 4; i++) {
      const p = c[i];
      const q = c[(i + 1) % 4];
      const e = sub(q, p);
      const denom = cross(dir, e);
      if (Math.abs(denom) < 1e-9) continue;
      const w = sub(p, origin);
      const t = cross(w, e) / denom;
      const u = cross(w, dir) / denom;
      if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t;
    }
  }
  return best <= maxDist ? best : Infinity;
}

export interface Clearance {
  side: "front" | "back" | "left" | "right";
  from: Vec2;
  to: Vec2;
  distance: number;
}

/** Clear distance from each side of a footprint to the nearest obstacle. */
export function clearances(o: OBB, obstacles: OBB[], maxDist = 400): Clearance[] {
  const { ax, az } = obbAxes(o);
  const sides: [Clearance["side"], Vec2, Vec2, number][] = [
    ["front", az, ax, o.hd],
    ["back", scale(az, -1), ax, o.hd],
    ["right", ax, az, o.hw],
    ["left", scale(ax, -1), az, o.hw],
  ];
  const out: Clearance[] = [];
  for (const [side, normal, along, half] of sides) {
    const extent = side === "front" || side === "back" ? o.hw : o.hd;
    let best = Infinity;
    let bestFrom = o.center;
    for (const f of [-0.85, 0, 0.85]) {
      const from = add(add(o.center, scale(normal, half + 0.01)), scale(along, f * extent));
      const d = rayCast(from, normal, obstacles, maxDist);
      if (d < best) {
        best = d;
        bestFrom = from;
      }
    }
    if (Number.isFinite(best)) out.push({ side, from: bestFrom, to: add(bestFrom, scale(normal, best)), distance: best });
  }
  return out;
}

/**
 * Finds a wall near the footprint and returns the pose that sits the piece's back flush
 * against it, facing into the room. Returns null when no wall is within `reach` cm.
 */
export function snapToWall(o: OBB, layout: Layout, reach = 25, inside?: Vec2): { center: Vec2; angle: number } | null {
  let best: { center: Vec2; angle: number; gap: number } | null = null;
  for (const w of layout.lines) {
    if (!isWall(w)) continue;
    const L = lineLength(w);
    if (L < 20) continue;
    const c = closestOnSegment(o.center, w.a, w.b);
    if (c.t <= 0 || c.t >= 1) continue;
    const dir = scale(sub(w.b, w.a), 1 / L);
    let normal = { x: -dir.y, y: dir.x };
    // Exterior walls only have one usable side: the one facing the room interior
    const toward = w.type === "wall-exterior" && inside ? sub(inside, c.point) : sub(o.center, c.point);
    if (dot(toward, normal) < 0) normal = scale(normal, -1);
    const half = wallThickness(w, layout) / 2;
    // Treat whichever side of the piece faces the wall as its back
    const angle = Math.atan2(normal.x, normal.y);
    const signed = dot(sub(o.center, c.point), normal);
    const gap = signed - half - o.hd;
    if (gap > reach || signed < -(half + o.hd + reach)) continue;
    if (!best || Math.abs(gap) < Math.abs(best.gap)) {
      best = { center: add(c.point, scale(normal, half + o.hd + 0.5)), angle, gap };
    }
  }
  return best ? { center: best.center, angle: best.angle } : null;
}

export function snapAngle(deg: number, step = 15) {
  return Math.round(deg / step) * step;
}
